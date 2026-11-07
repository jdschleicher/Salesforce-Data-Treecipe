import * as matchers from 'jest-extended';
expect.extend(matchers);

jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import { RecipeCockpitService } from '../../RecipeCockpitService';
import { BASELINE_SCREENS, readBaseline } from './CockpitBaselines';
import { CockpitScreenshots, IBrowser } from './CockpitScreenshots';

/*
    The screenshots are worth the CSS-only change they catch (#602), which the text baselines cannot:
    each test changes only the shell's stylesheet and expects EXACTLY the screens that show the change
    to differ. Which screens those are is read off the text baselines, so adding a screen cannot leave
    this suite wrong.
*/
const missingChromium = CockpitScreenshots.findMissingChromium();

(missingChromium ? describe.skip : describe)('the screenshots catch a change only CSS makes (#602)', () => {

    let browser: IBrowser;
    beforeAll(async () => { browser = await CockpitScreenshots.launchChromium(); }, 60000);
    afterAll(async () => { await browser?.close(); });

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
            const actualPng = await CockpitScreenshots.renderScreen(browser, baselineScreen);
            if ( await CockpitScreenshots.describeScreenshotMismatch(browser, baselineScreen.name, actualPng, { keepFailedImages: false }) ) { differing.push(baselineScreen.name); }
        }
        return differing;
    };

    const screensWhoseBaseline = (isShown: (baselineText: string) => boolean) => BASELINE_SCREENS
        .filter(baselineScreen => isShown(readBaseline(baselineScreen.name) ?? ''))
        .map(baselineScreen => baselineScreen.name);

    test('the cockpit as it is matches every screenshot', async () => {
        expect(await screensThatDiffer()).toEqual([]);
    }, 120000);

    // "button.updaterNext", NOT ".updaterNext": THE PANEL HARNESS READS A ONE-CLASS display: none RULE AS HIDDEN, AND THIS CHANGE MUST BE ONE ONLY A BROWSER SEES
    test('display: none on the Treecipe Adapter\'s Next button fails exactly the screenshots that show it', async () => {

        editShell('</style>', 'button.updaterNext { display: none; }\n</style>');

        const expected = screensWhoseBaseline(baselineText => baselineText.includes('button "Next"'));
        expect(expected).not.toBeEmpty();
        expect(expected.length).toBeLessThan(BASELINE_SCREENS.length);
        expect(await screensThatDiffer()).toEqual(expected);

    }, 120000);

    test('changing the palette\'s dialog backdrop fails exactly the screenshots with a confirmation open', async () => {

        editShell('--sdt-dialog-backdrop: rgba(51, 51, 51, 0.55);', '--sdt-dialog-backdrop: rgba(180, 30, 30, 0.55);');

        const expected = screensWhoseBaseline(baselineText => /^(alert)?dialog "/m.test(baselineText));
        expect(expected).not.toBeEmpty();
        expect(expected.length).toBeLessThan(BASELINE_SCREENS.length);
        expect(await screensThatDiffer()).toEqual(expected);

    }, 120000);

    test('changing the palette\'s page colour fails every screenshot', async () => {

        editShell('--sdt-page: #F4F7F6;', '--sdt-page: #FFF4E0;');

        expect(await screensThatDiffer()).toEqual(BASELINE_SCREENS.map(baselineScreen => baselineScreen.name));

    }, 120000);

});
