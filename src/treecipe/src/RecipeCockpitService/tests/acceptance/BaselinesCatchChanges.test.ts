import * as matchers from 'jest-extended';
expect.extend(matchers);

jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import { RecipeCockpitService } from '../../RecipeCockpitService';
import { BASELINE_SCREENS, describeBaselineMismatch, readBaseline, renderBaselineScreen } from './CockpitBaselines';

/*
    A baseline is worth the change it catches (#580): each test changes the shell the cockpit draws the
    way a markup refactor could, renders every baseline screen, and expects EXACTLY the baselines that
    show the change to differ. Which ones those are is read off the checked-in files, so adding a
    baseline cannot leave this suite wrong.
*/
describe('the rendered baselines catch a changed label and a changed order (#580)', () => {

    // THE SHELL WITH ONE EDIT MADE: A SHELL THAT NO LONGER HOLDS THE TEXT TO EDIT NEEDS THIS SUITE UPDATED, NOT A PASS
    const editShell = (textToReplace: string, replacement: string) => {
        const buildShellHtml = RecipeCockpitService.buildWebviewShellHtml.bind(RecipeCockpitService);
        jest.spyOn(RecipeCockpitService, 'buildWebviewShellHtml').mockImplementation((nonce: string) => {
            const shellHtml = buildShellHtml(nonce);
            expect(shellHtml).toContain(textToReplace);
            return shellHtml.replace(textToReplace, replacement);
        });
    };

    const screensThatDiffer = async () => {
        const differing: string[] = [];
        for ( const baselineScreen of BASELINE_SCREENS ) {
            if ( describeBaselineMismatch(baselineScreen.name, await renderBaselineScreen(baselineScreen)) ) { differing.push(baselineScreen.name); }
        }
        return differing;
    };

    const screensWhoseBaseline = (isShown: (baselineText: string) => boolean) => BASELINE_SCREENS
        .filter(baselineScreen => isShown(readBaseline(baselineScreen.name) ?? ''))
        .map(baselineScreen => baselineScreen.name);

    test('the cockpit as it is matches every baseline', async () => {
        expect(await screensThatDiffer()).toEqual([]);
    }, 120000);

    test('renaming the Treecipe Adapter\'s Next button fails exactly the baselines that show it', async () => {

        editShell('const UPDATER_NEXT_LABEL = "Next";', 'const UPDATER_NEXT_LABEL = "Continue";');

        const expected = screensWhoseBaseline(baselineText => baselineText.includes('button "Next"'));
        expect(expected).not.toBeEmpty();
        expect(expected.length).toBeLessThan(BASELINE_SCREENS.length);
        expect(await screensThatDiffer()).toEqual(expected);

    }, 120000);

    test('swapping an in-panel confirmation\'s own button and its Cancel fails exactly the baselines with a confirmation open', async () => {

        editShell(
            'buttonElements.forEach(function (buttonElement) { actionsElement.appendChild(buttonElement); });\n        actionsElement.appendChild(cancelElement);',
            'actionsElement.appendChild(cancelElement);\n        buttonElements.forEach(function (buttonElement) { actionsElement.appendChild(buttonElement); });'
        );

        const expected = screensWhoseBaseline(baselineText => /^(alert)?dialog "/m.test(baselineText));
        expect(expected).not.toBeEmpty();
        expect(expected.length).toBeLessThan(BASELINE_SCREENS.length);
        expect(await screensThatDiffer()).toEqual(expected);

    }, 120000);

});
