jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BASELINE_SCREENS } from './CockpitBaselines';
import { CockpitScreenshots, FAILED_SCREENSHOTS_FOLDER, IBrowser, IS_REQUIRING_SCREENSHOTS, IS_UPDATING_SCREENSHOTS, SCREENSHOTS_FOLDER } from './CockpitScreenshots';

/*
    #602: each of #580's key screens, drawn in real Chromium, must look like its checked-in PNG.
    UPDATE_COCKPIT_SCREENSHOTS=1 rewrites the PNGs.
*/
const missingChromium = CockpitScreenshots.findMissingChromium();

describe('the screenshot comparison says what it needs (#602)', () => {

    test('with no Chromium it is skipped with a message naming what is missing, unless REQUIRE_COCKPIT_SCREENSHOTS=1 requires it', () => {
        if ( missingChromium ) {
            if ( IS_REQUIRING_SCREENSHOTS ) { throw new Error(missingChromium); }
            console.warn(missingChromium);
        }
        expect(missingChromium === undefined || missingChromium.includes('skipped')).toBe(true);
    });

    test('a machine that is not Linux is named in the message', () => {
        expect(CockpitScreenshots.findMissingChromium('darwin')).toContain('this machine is darwin');
    });

    test('a machine without the font the PNGs were drawn with is named, with the font fontconfig offers instead', () => {
        const execFileSync = childProcess.execFileSync;
        jest.spyOn(childProcess, 'execFileSync').mockImplementation(((command: string, ...rest: unknown[]) => command === 'fc-match' ? 'Inter' : (execFileSync as Function)(command, ...rest)) as typeof childProcess.execFileSync);
        // ANY FILE THAT EXISTS PASSES THE CHROMIUM CHECK, WHICH RUNS FIRST: CI'S MAIN TEST STEP HAS NO CHROMIUM
        const executablePathBefore = process.env.CHROMIUM_EXECUTABLE_PATH;
        process.env.CHROMIUM_EXECUTABLE_PATH = process.execPath;
        try {
            expect(CockpitScreenshots.findMissingChromium('linux')).toContain('the PNGs are drawn with DejaVu Sans, and this machine has none (fontconfig offers Inter)');
        } finally {
            if ( executablePathBefore === undefined ) { delete process.env.CHROMIUM_EXECUTABLE_PATH; } else { process.env.CHROMIUM_EXECUTABLE_PATH = executablePathBefore; }
        }
    });

    test('a Chromium that is not there is named by its path', () => {
        const executablePathBefore = process.env.CHROMIUM_EXECUTABLE_PATH;
        process.env.CHROMIUM_EXECUTABLE_PATH = '/no/such/chromium';
        try {
            expect(CockpitScreenshots.findMissingChromium('linux')).toContain('there is no Chromium at /no/such/chromium');
        } finally {
            if ( executablePathBefore === undefined ) { delete process.env.CHROMIUM_EXECUTABLE_PATH; } else { process.env.CHROMIUM_EXECUTABLE_PATH = executablePathBefore; }
        }
    });

});

(missingChromium ? describe.skip : describe)('Recipe Cockpit screenshots in Chromium (#602)', () => {

    let browser: IBrowser;
    beforeAll(async () => { browser = await CockpitScreenshots.launchChromium(); }, 60000);
    afterAll(async () => { await browser?.close(); });

    test.each(BASELINE_SCREENS)('$name', async (baselineScreen) => {

        const actualPng = await CockpitScreenshots.renderScreen(browser, baselineScreen);

        if ( IS_UPDATING_SCREENSHOTS ) {
            fs.mkdirSync(SCREENSHOTS_FOLDER, { recursive: true });
            fs.writeFileSync(CockpitScreenshots.screenshotFilePath(baselineScreen.name), actualPng);
        }

        const mismatch = await CockpitScreenshots.describeScreenshotMismatch(browser, baselineScreen.name, actualPng);
        if ( mismatch ) { throw new Error(mismatch); }

    }, 60000);

    // A 1×1 WHITE PNG: SMALLER THAN ANY SCREEN, SO IT FAILS ON SIZE BEFORE A PIXEL IS COMPARED
    const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC', 'base64');

    test('a picture of another size fails naming both sizes, and leaves what Chromium drew for the reader', async () => {
        const actualFilePath = path.join(FAILED_SCREENSHOTS_FOLDER, 'empty-state.actual.png');
        fs.rmSync(actualFilePath, { force: true });

        const mismatch = await CockpitScreenshots.describeScreenshotMismatch(browser, 'empty-state', onePixelPng);

        expect(mismatch).toMatch(/^The empty-state screen does not look like screenshots\/empty-state\.png: the checked-in PNG is \d+×\d+ and Chromium drew 1×1\./);
        expect(mismatch).toContain('UPDATE_COCKPIT_SCREENSHOTS=1');
        expect(Buffer.compare(fs.readFileSync(actualFilePath), onePixelPng)).toBe(0);
        fs.rmSync(actualFilePath, { force: true });
    });

    test('a screen with no checked-in picture says how to write one', async () => {
        expect(await CockpitScreenshots.describeScreenshotMismatch(browser, 'no-such-screen', onePixelPng))
            .toBe('screenshots/no-such-screen.png does not exist. Run with UPDATE_COCKPIT_SCREENSHOTS=1 to write it.');
    });

    test('a picture compared with itself has no differing pixel', async () => {
        const drawn = await CockpitScreenshots.renderScreen(browser, BASELINE_SCREENS[0]);
        expect(await CockpitScreenshots.compare(browser, drawn, drawn)).toEqual({ differingPixelCount: 0, pixelCount: 0 });
    }, 60000);

    // NOTHING IN A PICTURE DEPENDS ON TIME, MACHINE OR TEMP FOLDER: THE SAME SCREEN DRAWN TWICE IS THE SAME BYTES
    test('a screen drawn twice in a row is the same picture', async () => {
        const baselineScreen = BASELINE_SCREENS.find(candidateScreen => candidateScreen.name === 'treecipe-tab');
        const firstPng = await CockpitScreenshots.renderScreen(browser, baselineScreen);
        const secondPng = await CockpitScreenshots.renderScreen(browser, baselineScreen);
        expect(Buffer.compare(firstPng, secondPng)).toBe(0);
    }, 60000);

});
