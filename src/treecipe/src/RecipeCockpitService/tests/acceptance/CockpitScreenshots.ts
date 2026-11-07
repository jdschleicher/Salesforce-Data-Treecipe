import * as fs from 'fs';
import * as path from 'path';
import { IBaselineScreen } from './CockpitBaselines';
import { RecipeCockpitPageDocument, IFakePageElement } from '../RecipeCockpitPageDocument';

/*
    The few Playwright calls this makes, typed here: Playwright's own types need the DOM library, which
    this project does not compile with.
*/
export interface IBrowserPage {
    evaluate<TResult, TArgument>(pageFunction: (argument: TArgument) => TResult | Promise<TResult>, argument?: TArgument): Promise<TResult>;
    screenshot(options: { fullPage: boolean; animations: 'disabled'; caret: 'hide' }): Promise<Buffer>;
    close(): Promise<void>;
}
export interface IBrowser {
    newPage(): Promise<IBrowserPage>;
    close(): Promise<void>;
}
interface IPlaywright {
    chromium: { executablePath(): string; launch(options: { executablePath?: string }): Promise<IBrowser> };
}

/*
    The key screens of #580, compared as pictures in real Chromium (#602), so a change only CSS makes
    -- a rule that hides a control, a colour, a layout -- fails a run. Each screen is reached by the
    same journey as its text baseline; the page that journey's panel drew is written out as HTML into
    the document the host assigned, and drawn on the page captureRecipeCockpitScreenshots.js takes the
    guide's pictures on, at deviceScaleFactor 1.

    UPDATE_COCKPIT_SCREENSHOTS=1 rewrites the PNGs, and the PR then says what a reader now sees
    differently. With no Chromium, or not on Linux, the comparison is skipped with a message naming
    what is missing; REQUIRE_COCKPIT_SCREENSHOTS=1 (the CI step) turns that into a failure.
*/

export const SCREENSHOTS_FOLDER = path.join(__dirname, 'screenshots');
export const IS_UPDATING_SCREENSHOTS = process.env.UPDATE_COCKPIT_SCREENSHOTS === '1';
export const IS_REQUIRING_SCREENSHOTS = process.env.REQUIRE_COCKPIT_SCREENSHOTS === '1';

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
// WHERE A FAILED RUN LEAVES WHAT IT DREW AND WHERE IT DIFFERS; CI UPLOADS THIS FOLDER
export const FAILED_SCREENSHOTS_FOLDER = path.join(REPOSITORY_ROOT, 'node_modules', '.cache', 'cockpit-screenshots');

/*
    The tolerance (#602): a pixel differs when any channel is more than CHANNEL_TOLERANCE out of 255
    away, and a screen fails when more than MAXIMUM_DIFFERING_PIXEL_RATIO of its pixels differ. The
    ratio absorbs antialiasing, which moves few pixels a long way; the channel tolerance stays low
    because a palette token nudged a shade moves every pixel a little (--sdt-page #F4F7F6 to #FFF4E0
    is 22 at most, and passed a tolerance of 24).
*/
export const CHANNEL_TOLERANCE = 8;
export const MAXIMUM_DIFFERING_PIXEL_RATIO = 0.002;

interface ICaptureScript {
    RecipeCockpitScreenshots: {
        loadPlaywright(): IPlaywright;
        openShellDocument(browser: IBrowser, documentHtml: string): Promise<IBrowserPage>;
    };
}

const captureScript: ICaptureScript = require(path.join(REPOSITORY_ROOT, 'developmentSupportScripts', 'recipe-cockpit-screenshots', 'captureRecipeCockpitScreenshots.js'));

export interface IScreenshotComparison {
    differingPixelCount: number;
    pixelCount: number;
    sizeMismatch?: string;
    diffPng?: Buffer;
}

export class CockpitScreenshots {

    // undefined WHEN CHROMIUM CAN DRAW THE SCREENS HERE; OTHERWISE WHAT IS MISSING AND HOW TO GET IT
    static findMissingChromium(platform: string = process.platform): string | undefined {

        if ( platform !== 'linux' ) {
            return `The Recipe Cockpit screenshot comparison (#602) is skipped: its PNGs are Chromium renders on Linux, and this machine is ${platform}. CI compares them on ubuntu-latest.`;
        }

        let playwright: IPlaywright;
        try {
            playwright = captureScript.RecipeCockpitScreenshots.loadPlaywright();
        } catch (loadError) {
            return 'The Recipe Cockpit screenshot comparison (#602) is skipped: Playwright was not found. Run "npm ci --ignore-scripts".';
        }

        const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || playwright.chromium.executablePath();
        if ( !executablePath || !fs.existsSync(executablePath) ) {
            return `The Recipe Cockpit screenshot comparison (#602) is skipped: there is no Chromium at ${executablePath || '(no path)'}. Run "npx playwright install chromium", or set CHROMIUM_EXECUTABLE_PATH.`;
        }

        return undefined;

    }

    static async launchChromium(): Promise<IBrowser> {
        const playwright = captureScript.RecipeCockpitScreenshots.loadPlaywright();
        return playwright.chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {});
    }

    static screenshotFilePath(screenName: string): string {
        return path.join(SCREENSHOTS_FOLDER, `${screenName}.png`);
    }

    // THE WHOLE PAGE THE SCREEN'S JOURNEY REACHED, AS CHROMIUM DRAWS IT
    static async renderScreen(browser: IBrowser, baselineScreen: IBaselineScreen): Promise<Buffer> {

        const journey = await baselineScreen.show();
        let documentHtml: string;
        try {
            const panelDocument = journey.panelDocument();
            documentHtml = RecipeCockpitPageDocument.buildDocumentHtml(panelDocument.shellHtml, panelDocument.rootsById as unknown as Record<string, IFakePageElement>);
        } finally {
            await journey.close();
        }

        const browserPage = await captureScript.RecipeCockpitScreenshots.openShellDocument(browser, documentHtml);
        try {
            // THE PROJECT COMPILES WITHOUT THE DOM LIBRARY, SO WHAT RUNS IN CHROMIUM REACHES ITS GLOBALS THROUGH globalThis; NO COVERAGE COUNTERS IN IT
            await browserPage.evaluate(/* istanbul ignore next */ () => (globalThis as any).document.fonts.ready.then(() => undefined));
            return await browserPage.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
        } finally {
            await browserPage.close();
        }

    }

    // COMPARED ON A CANVAS IN THE SAME CHROMIUM, SO THE ONLY DEPENDENCY THIS NEEDS IS PLAYWRIGHT
    static async compare(browser: IBrowser, expectedPng: Buffer, actualPng: Buffer): Promise<IScreenshotComparison> {

        if ( Buffer.compare(expectedPng, actualPng) === 0 ) {
            return { differingPixelCount: 0, pixelCount: 0 };
        }

        const browserPage = await browser.newPage();
        try {
            // THIS FUNCTION RUNS IN CHROMIUM AS ITS SOURCE TEXT, SO NOTHING THE BUILD ADDS MAY REACH IT: NO async (THE ES6 BUILD
            // TURNS await INTO AN __awaiter HELPER) AND NO COVERAGE COUNTERS (istanbul ignore)
            const comparison = await browserPage.evaluate(/* istanbul ignore next */ ({ expectedBase64, actualBase64, channelTolerance }) => {
                const browserGlobals = globalThis as any;
                const decode = (base64: string) => browserGlobals.fetch('data:image/png;base64,' + base64)
                    .then((response: any) => response.blob())
                    .then((blob: any) => browserGlobals.createImageBitmap(blob))
                    .then((image: any) => {
                        const context = new browserGlobals.OffscreenCanvas(image.width, image.height).getContext('2d');
                        context.drawImage(image, 0, 0);
                        return { width: image.width as number, height: image.height as number, pixels: context.getImageData(0, 0, image.width, image.height).data };
                    });
                return Promise.all([decode(expectedBase64), decode(actualBase64)]).then(([expected, actual]) => {
                    if ( expected.width !== actual.width || expected.height !== actual.height ) {
                        return { sizeMismatch: `the checked-in PNG is ${expected.width}×${expected.height} and Chromium drew ${actual.width}×${actual.height}`, differingPixelCount: 0, pixelCount: 0, diffBase64: '' };
                    }
                    // THE ACTUAL PICTURE FADED, EVERY DIFFERING PIXEL IN RED
                    const diffCanvas = new browserGlobals.OffscreenCanvas(actual.width, actual.height);
                    const diffContext = diffCanvas.getContext('2d');
                    const diffImage = diffContext.createImageData(actual.width, actual.height);
                    let differingPixelCount = 0;
                    for ( let byteIndex = 0; byteIndex < actual.pixels.length; byteIndex += 4 ) {
                        const isDifferent = [0, 1, 2, 3].some(channel => Math.abs(expected.pixels[byteIndex + channel] - actual.pixels[byteIndex + channel]) > channelTolerance);
                        if ( isDifferent ) {
                            differingPixelCount++;
                            diffImage.data.set([255, 0, 0, 255], byteIndex);
                        } else {
                            const gray = (actual.pixels[byteIndex] + actual.pixels[byteIndex + 1] + actual.pixels[byteIndex + 2]) / 3;
                            diffImage.data.set([gray, gray, gray, 64], byteIndex);
                        }
                    }
                    diffContext.putImageData(diffImage, 0, 0);
                    return diffCanvas.convertToBlob({ type: 'image/png' })
                        .then((diffBlob: any) => diffBlob.arrayBuffer())
                        .then((diffBuffer: ArrayBuffer) => {
                            let diffBinary = '';
                            new Uint8Array(diffBuffer).forEach(diffByte => { diffBinary += String.fromCharCode(diffByte); });
                            return { sizeMismatch: undefined as string | undefined, differingPixelCount, pixelCount: actual.width * actual.height, diffBase64: browserGlobals.btoa(diffBinary) as string };
                        });
                });
            }, { expectedBase64: expectedPng.toString('base64'), actualBase64: actualPng.toString('base64'), channelTolerance: CHANNEL_TOLERANCE });

            return {
                differingPixelCount: comparison.differingPixelCount,
                pixelCount: comparison.pixelCount,
                sizeMismatch: comparison.sizeMismatch,
                diffPng: comparison.diffBase64 ? Buffer.from(comparison.diffBase64, 'base64') : undefined
            };
        } finally {
            await browserPage.close();
        }

    }

    static isWithinTolerance(comparison: IScreenshotComparison): boolean {
        return !comparison.sizeMismatch && comparison.differingPixelCount <= comparison.pixelCount * MAXIMUM_DIFFERING_PIXEL_RATIO;
    }

    // undefined WHEN THE SCREEN LOOKS AS CHECKED IN; OTHERWISE WHAT TO SAY. WRITES THE ACTUAL AND DIFF PNGs WHEN asked TO KEEP THEM
    static async describeScreenshotMismatch(browser: IBrowser, screenName: string, actualPng: Buffer, options: { keepFailedImages: boolean } = { keepFailedImages: true }): Promise<string | undefined> {

        const checkedInFilePath = this.screenshotFilePath(screenName);
        if ( !fs.existsSync(checkedInFilePath) ) {
            return `screenshots/${screenName}.png does not exist. Run with UPDATE_COCKPIT_SCREENSHOTS=1 to write it.`;
        }

        const comparison = await this.compare(browser, fs.readFileSync(checkedInFilePath), actualPng);
        if ( this.isWithinTolerance(comparison) ) {
            return undefined;
        }

        let keptImagesNote = '';
        if ( options.keepFailedImages ) {
            fs.mkdirSync(FAILED_SCREENSHOTS_FOLDER, { recursive: true });
            fs.writeFileSync(path.join(FAILED_SCREENSHOTS_FOLDER, `${screenName}.actual.png`), actualPng);
            if ( comparison.diffPng ) { fs.writeFileSync(path.join(FAILED_SCREENSHOTS_FOLDER, `${screenName}.diff.png`), comparison.diffPng); }
            keptImagesNote = ` What Chromium drew, and where it differs in red, are in ${path.relative(REPOSITORY_ROOT, FAILED_SCREENSHOTS_FOLDER)}/${screenName}.actual.png and .diff.png.`;
        }

        const howItDiffers = comparison.sizeMismatch
            ?? `${comparison.differingPixelCount} of ${comparison.pixelCount} pixels differ, over the ${MAXIMUM_DIFFERING_PIXEL_RATIO * 100}% tolerance`;
        return `The ${screenName} screen does not look like screenshots/${screenName}.png: ${howItDiffers}.${keptImagesNote} If the change is intended, run with UPDATE_COCKPIT_SCREENSHOTS=1 and say in the PR what a reader now sees differently.`;

    }

}
