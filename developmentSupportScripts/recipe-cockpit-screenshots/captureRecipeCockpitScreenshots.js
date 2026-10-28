// Takes the pictures docs/RECIPE-COCKPIT-GUIDE.md shows (#332).
//
// It renders the REAL cockpit: the shell RecipeCockpitService.buildWebviewShellHtml builds, with its
// own script, fed a model RecipeCockpitService.loadRecipeRunByRuns builds from the test fixture
// workspace (tests/mocks/historyWorkspace). So a picture shows what the panel draws today, and every
// name in it is a fixture's -- no org, username, alias or path from anyone's machine.
//
// Run from the repository root after `npm ci`:
//
//     node developmentSupportScripts/recipe-cockpit-screenshots/captureRecipeCockpitScreenshots.js
//
// It needs Playwright, which is NOT a dependency of this project: it loads `playwright-core` or
// `playwright` from wherever Node finds one (this project, or the global npm folder), and never
// downloads a browser. Chromium comes from PLAYWRIGHT_BROWSERS_PATH as Playwright resolves it, or
// from CHROMIUM_EXECUTABLE_PATH when set. A picture is written only when its bytes changed, so a
// second run on unchanged code leaves git clean.

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIRECTORY = path.join(REPOSITORY_ROOT, 'docs', 'images', 'recipe-cockpit');
const BUNDLE_DIRECTORY = path.join(REPOSITORY_ROOT, 'node_modules', '.cache', 'recipe-cockpit-screenshots');
const FIXTURE_WORKSPACE_ROOT = path.join(REPOSITORY_ROOT, 'src', 'treecipe', 'src', 'RecipeCockpitService', 'tests', 'mocks', 'historyWorkspace');
const FIXTURE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const FIXTURE_TREE_FOLDER_NAME = 'Account-thru-OtherChildObject__c';
const VIEWPORT = { width: 900, height: 640 };
const NONCE = 'screenshotNonce';
const PAGE_URL = 'http://recipe-cockpit.test/';
const MAXIMUM_IMAGE_BYTES = 200 * 1024;
const EXTENSION_VERSION = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8')).version;

// THE FONT VARIABLES ARE THE ONLY ONES THE COCKPIT READS FROM VS CODE; ANYTHING ELSE IS ITS OWN PALETTE
const VS_CODE_FONT_STYLE = ':root { --vscode-font-family: "DejaVu Sans", "Segoe UI", Arial, sans-serif; --vscode-editor-font-family: "DejaVu Sans Mono", Consolas, monospace; --vscode-font-size: 13px; }';

class RecipeCockpitScreenshots {

    static loadPlaywright() {

        const searchPaths = [REPOSITORY_ROOT];
        try {
            searchPaths.push(childProcess.execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim());
        } catch (npmRootError) {
            // NO GLOBAL FOLDER TO LOOK IN; THE PROJECT'S OWN node_modules IS STILL SEARCHED
        }

        for (const moduleName of ['playwright-core', 'playwright']) {
            try {
                return require(require.resolve(moduleName, { paths: searchPaths }));
            } catch (resolveError) {
                // TRY THE NEXT ONE
            }
        }

        throw new Error('Playwright was not found. Install it outside this project (npm install -g playwright-core) and run again; this script never downloads a browser.');

    }

    // RecipeCockpitService IS TYPESCRIPT THAT IMPORTS vscode; esbuild (ALREADY A DEV DEPENDENCY) BUNDLES IT WITH vscode STUBBED
    static async loadRecipeCockpitService() {

        const esbuild = require(require.resolve('esbuild', { paths: [REPOSITORY_ROOT] }));
        const bundleResult = await esbuild.build({
            stdin: {
                contents: "export { RecipeCockpitService } from './src/treecipe/src/RecipeCockpitService/RecipeCockpitService';",
                resolveDir: REPOSITORY_ROOT,
                loader: 'ts'
            },
            bundle: true,
            platform: 'node',
            format: 'cjs',
            write: false,
            external: ['@salesforce/core'],
            logLevel: 'error',
            plugins: [{
                name: 'vscode-stub',
                setup(pluginBuild) {
                    pluginBuild.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'vscode-stub' }));
                    pluginBuild.onLoad({ filter: /.*/, namespace: 'vscode-stub' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
                }
            }]
        });

        fs.mkdirSync(BUNDLE_DIRECTORY, { recursive: true });
        const bundleFilePath = path.join(BUNDLE_DIRECTORY, 'RecipeCockpitService.js');
        fs.writeFileSync(bundleFilePath, bundleResult.outputFiles[0].text);

        return require(bundleFilePath).RecipeCockpitService;

    }

    static loadFixtureRecipe(RecipeCockpitService) {

        const generatedRecipesPath = path.join(FIXTURE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
        const recipe = RecipeCockpitService.loadRecipeRunByRuns(
            RecipeCockpitService.findGeneratedRecipeRuns(generatedRecipesPath),
            FIXTURE_WORKSPACE_ROOT,
            FIXTURE_RUN_FOLDER_NAME
        ).recipeViewModel;

        // THE FIXTURE'S UNMATCHED DATA SETS ARE A TEST CASE, NOT SOMETHING A READER OF THE GUIDE NEEDS TO SEE
        recipe.notices = [];
        return recipe;

    }

    // ONE OF EACH KIND OF SELECTION KEPT OUTSIDE THE RECIPE FILE (A FIXED VALUE IS WRITTEN INTO IT SINCE #342), DERIVED BY THE HOST'S OWN RULE RATHER THAN WRITTEN INTO THE MODEL BY HAND
    static applyFixtureSelection(RecipeCockpitService, recipe) {

        RecipeCockpitService.applyObjectSelections(
            recipe,
            new Map([[FIXTURE_TREE_FOLDER_NAME, new Set(['OtherChildObject__c'])]]),
            new Map([[FIXTURE_TREE_FOLDER_NAME, new Map([['Account', new Set(['Legacy_Code__c'])]])]]),
            undefined,
            new Map([[FIXTURE_TREE_FOLDER_NAME, new Map([['Account', 5]])]])
        );

        return recipe;

    }

    static async openCockpit(browser, recipe) {

        const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: 'reduce', bypassCSP: true });

        await page.addInitScript(() => {
            window.acquireVsCodeApi = () => ({ postMessage: () => undefined, getState: () => undefined, setState: () => undefined });
        });
        // A REAL ORIGIN RATHER THAN setContent'S about:blank, WHERE THE SHELL'S NONCED SCRIPT DID NOT RUN
        await page.route(PAGE_URL, (route) => route.fulfill({ contentType: 'text/html', body: this.shellHtml }));
        await page.goto(PAGE_URL, { waitUntil: 'load' });
        await page.addStyleTag({ content: VS_CODE_FONT_STYLE });

        await page.evaluate((hostMessages) => {
            hostMessages.forEach((hostMessage) => window.postMessage(hostMessage, '*'));
        // THE VERSION SITS INSIDE THE CHANGELOG BUTTON AT THE TOP RIGHT (#487), SO THE PICTURES SHOW IT AS THE HOST SENDS IT
        }, [{ command: 'extensionInfo', version: EXTENSION_VERSION }, { command: 'recipeData', recipe: recipe, renderSequence: 1 }, { command: 'loadPhase', message: '' }]);
        await page.waitForSelector('.toolbar');

        return page;

    }

    static async clickNth(page, selector, index) {
        await page.locator(selector).nth(index).click();
    }

    // THE FIRST CARD IS DRAWN WITH THE MODEL (#374); CLICKING ITS TREECIPE TAB ASKS THE HOST FOR ITS ORGS; ONE MADE-UP SANDBOX, NOT SELECTED, IS THE PICKER AT REST
    static async openFirstCard(page) {
        await this.clickNth(page, '.treeCard:not(.hidden) .treeTab', 0);
        await page.evaluate((hostMessage) => window.postMessage(hostMessage, '*'), {
            command: 'dataOrgList', orgLabels: ['example-sandbox'], selectedOrgIndex: null,
            noOrgsMessage: '', hiddenOrgNote: '', forgottenOrgNotice: '', renderSequence: 1
        });
        await page.waitForSelector('.dataOrgSpinner', { state: 'hidden' }).catch(() => undefined);
    }

    // THE CONTAINER'S FULL WIDTH, FROM THE TOP OF ITS index-th startSelector MATCH TO THE CONTAINER'S BOTTOM
    static async screenshotFrom(page, containerSelector, startSelector, index) {

        const containerBox = await page.locator(containerSelector).boundingBox();
        const startBox = await page.locator(startSelector).nth(index).boundingBox();

        if (!containerBox || !startBox) {
            throw new Error(`${containerSelector} or ${startSelector} #${index} is not on the page.`);
        }

        return page.screenshot({
            fullPage: true,
            clip: { x: containerBox.x, y: startBox.y, width: containerBox.width, height: containerBox.y + containerBox.height - startBox.y }
        });

    }

    static async writeIfChanged(fileName, imageBytes) {

        if (imageBytes.length > MAXIMUM_IMAGE_BYTES) {
            throw new Error(`${fileName} is ${imageBytes.length} bytes, over the guide's ${MAXIMUM_IMAGE_BYTES}-byte limit. Shoot a smaller element.`);
        }

        const imageFilePath = path.join(OUTPUT_DIRECTORY, fileName);
        const isUnchanged = fs.existsSync(imageFilePath) && Buffer.compare(fs.readFileSync(imageFilePath), imageBytes) === 0;

        if (!isUnchanged) { fs.writeFileSync(imageFilePath, imageBytes); }
        console.log(`${isUnchanged ? 'unchanged' : 'written  '} docs/images/recipe-cockpit/${fileName} (${imageBytes.length} bytes)`);

    }

    static async run() {

        const playwright = this.loadPlaywright();
        const RecipeCockpitService = await this.loadRecipeCockpitService();
        this.shellHtml = RecipeCockpitService.buildWebviewShellHtml(NONCE);

        fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

        const browser = await playwright.chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {});

        try {

            // THE TOOLBAR AND THE CARDS, AS THE COCKPIT OPENS
            let page = await this.openCockpit(browser, this.loadFixtureRecipe(RecipeCockpitService));
            await this.writeIfChanged('where-recipes-come-from.png', await page.screenshot({ fullPage: true }));
            await page.close();

            // A CARD THAT LEAVES THINGS OUT: AN EXCLUDED OBJECT, AN UNTICKED FIELD, A COUNT AND A FIXED VALUE
            page = await this.openCockpit(browser, this.applyFixtureSelection(RecipeCockpitService, this.loadFixtureRecipe(RecipeCockpitService)));
            await this.openFirstCard(page);
            await this.clickNth(page, '.treeCard .treeObject .treeObjectToggle', 0);
            await this.writeIfChanged('changes-without-editing-the-yaml.png', await page.locator('.treeCard').first().screenshot());
            await page.close();

            // THE SAME CARD UNTOUCHED, Contact OPENED ON ITS LOOKUP THE WIRE BUTTONS FILL
            page = await this.openCockpit(browser, this.loadFixtureRecipe(RecipeCockpitService));
            await this.openFirstCard(page);
            await this.clickNth(page, '.treeCard .treeObject .treeObjectToggle', 1);
            await this.writeIfChanged('what-edits-the-yaml.png', await page.locator('.treeCard').first().screenshot());
            await page.close();

            // THE HELP FROM "Where your changes are stored" DOWN: ITS SUMMARY NAMING THE CARD THAT DIFFERS. THE WHOLE SECTION
            // PASSED THE GUIDE'S SIZE LIMIT ONCE THE HELP GREW (#355), AND ITS OTHER PARTS HAVE PICTURES OF THEIR OWN
            page = await this.openCockpit(browser, this.applyFixtureSelection(RecipeCockpitService, this.loadFixtureRecipe(RecipeCockpitService)));
            await page.locator('.helpToggle').click();
            await this.writeIfChanged('where-changes-are-stored.png', await this.screenshotFrom(page, '.helpSection', '.helpSection .helpPart', 3));
            await page.close();

        } finally {
            await browser.close();
        }

    }

}

RecipeCockpitScreenshots.run().catch((runError) => {
    console.error(runError && runError.message ? runError.message : runError);
    process.exitCode = 1;
});
