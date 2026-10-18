import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as path from 'path';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS,
    RECIPE_COCKPIT_MOTION_CONCEAL_MILLISECONDS,
    RECIPE_COCKPIT_MOTION_HOVER_MILLISECONDS,
    RECIPE_COCKPIT_SPINNER_ROTATION_MILLISECONDS,
    RECIPE_COCKPIT_PALETTE
} from '../RecipeCockpitService';
import { runPanelScript, IPanelScriptOptions } from './RecipeCockpitPanelHarness';

/*
    Motion (#227): what the stylesheet animates, and what the panel script marks for animation. The
    harness has no layout and runs no CSS, so the panel half asserts the CLASSES and ATTRIBUTES an
    animation is driven by -- and that "hidden", aria-expanded and aria-hidden say the truth while
    one runs.
*/

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const LEAD_TREE_KEY = 'Lead-ONLY';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';

const styleSheetOf = (shellHtml: string): string =>
    shellHtml.substring(shellHtml.indexOf('<style nonce="testNonce">'), shellHtml.indexOf('</style>'));

const reducedMotionBlockOf = (styleSheet: string): string => {
    const blockStart = styleSheet.indexOf('@media (prefers-reduced-motion: reduce) {');
    return blockStart === -1 ? '' : styleSheet.substring(blockStart);
};

const loadHistoryRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT
).recipeViewModel;

describe('RecipeCockpitService, motion (#227)', () => {

    describe('the stylesheet', () => {

        const styleSheet = styleSheetOf(RecipeCockpitService.buildWebviewShellHtml('testNonce'));
        // EVERYTHING BEFORE THE REDUCED-MOTION BLOCK, WHICH IS LAST, SO A RULE AFTER IT COULD NOT OUTVOTE IT
        const motionStyleSheet = styleSheet.substring(0, styleSheet.indexOf('@media (prefers-reduced-motion: reduce) {'));

        it('keeps every duration between 120 and 180 ms', () => {

            [RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS, RECIPE_COCKPIT_MOTION_CONCEAL_MILLISECONDS, RECIPE_COCKPIT_MOTION_HOVER_MILLISECONDS]
                .forEach(milliseconds => expect(milliseconds).toBeWithin(120, 181));
            const declaredDurations = (motionStyleSheet.match(/\b(\d+)ms\b/g) ?? []).map(duration => parseInt(duration, 10));
            expect(declaredDurations).not.toBeEmpty();
            // THE PRESS NUDGE IS THE ONE SHORTER TRANSITION: A BUTTON GOING DOWN SHOULD FEEL IMMEDIATE; THE ORG CHECK'S SPINNER IS A LOOP, NOT A TRANSITION (#305)
            declaredDurations.filter(duration => duration !== 80 && duration !== RECIPE_COCKPIT_SPINNER_ROTATION_MILLISECONDS).forEach(duration => expect(duration).toBeWithin(120, 181));

        });

        it('turns every transition and animation off under prefers-reduced-motion, in a block that comes last', () => {

            const reducedMotionBlock = reducedMotionBlockOf(styleSheet);

            expect(reducedMotionBlock).not.toBe('');
            // THE UNIVERSAL SELECTOR AND !important REACH EVERY ELEMENT AND PSEUDO-ELEMENT WHATEVER A RULE'S SPECIFICITY
            expect(reducedMotionBlock).toMatch(/\*, \*::before, \*::after \{\s*transition: none !important;\s*animation: none !important;\s*\}/);
            expect(reducedMotionBlock.match(/\{/g)).toHaveLength(2);
            // AND THERE IS SOMETHING FOR IT TO TURN OFF
            expect(motionStyleSheet.match(/\btransition:/g)?.length).toBeGreaterThan(3);
            // REVEAL, CONCEAL, AN EXCLUDED ROW'S REVEAL TURNED OFF, AND THE ORG CHECK'S SPINNER (#305)
            expect(motionStyleSheet.match(/\banimation:/g)?.length).toBe(4);

        });

        it('fades a body in when it opens and out when it closes, keeping a closing body drawn only while it fades', () => {

            expect(motionStyleSheet).toContain(`.motionReveal { animation: sdtReveal ${RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS}ms ease-out; }`);
            expect(motionStyleSheet).toMatch(/\.hidden\.motionConceal \{\s*display: block !important;\s*animation: sdtConceal \d+ms ease-in forwards;\s*pointer-events: none;\s*\}/);
            expect(motionStyleSheet).toMatch(/@keyframes sdtReveal \{\s*from \{ opacity: 0;/);
            expect(motionStyleSheet).toMatch(/@keyframes sdtConceal \{[^@]*to \{ opacity: 0;[^}]*visibility: hidden; \}/);

        });

        it('rotates the one ▸ on aria-expanded rather than swapping it, and not for a toggle marked noMotion', () => {

            expect(motionStyleSheet).toContain('[aria-expanded="true"] > .toggleGlyph { transform: rotate(90deg); }');
            expect(motionStyleSheet).toMatch(/\.toggleGlyph \{[^}]*transition: transform \d+ms ease;/);
            expect(motionStyleSheet).toContain('.noMotion > .toggleGlyph { transition: none; }');

        });

        // AN ANIMATING BODY IS A STACKING CONTEXT: ITS z-index 2 CONTROLS WOULD DRAW UNDER THE EXCLUDED OBJECT'S z-index 1 OVERLAY
        it('does not fade the body of an excluded object, so its overlay never flickers over the controls', () => {

            expect(motionStyleSheet).toContain('.treeObject.excluded .motionReveal { animation: none; }');
            expect(motionStyleSheet).toContain('.treeObject.excluded .hidden.motionConceal { display: none !important; }');

        });

        it('draws the selected tab\'s underline as a scaled bar whose origin follows the direction of the move', () => {

            expect(motionStyleSheet).toMatch(/\.treeTab::after \{[^}]*background-color: var\(--sdt-accent\);[^}]*transform: scaleX\(0\);[^}]*transition: transform \d+ms ease;/);
            expect(motionStyleSheet).toContain('.treeTab.selected::after { transform: scaleX(1); }');
            expect(motionStyleSheet).toContain('.treeTabs.movingRight .treeTab::after, .treeTabs.movingLeft .treeTab.selected::after { transform-origin: right; }');
            expect(motionStyleSheet).toContain('.treeTabs.movingLeft .treeTab::after, .treeTabs.movingRight .treeTab.selected::after { transform-origin: left; }');
            expect(motionStyleSheet).toContain('.treeTabs.noMotion .treeTab::after { transition: none; }');
            // THE BAR IS THE UNDERLINE NOW; A BORDER UNDER IT WOULD STAY PUT WHILE THE BAR MOVED
            expect(motionStyleSheet).toContain('.treeTab.selected { color: var(--sdt-text); font-weight: 600; }');

        });

        it('gives buttons and rows hover, focus and pressed states with a short transition', () => {

            expect(motionStyleSheet).toMatch(/\n\s*button, select, input \{\s*transition: color \d+ms ease, background-color \d+ms ease, border-color \d+ms ease, box-shadow \d+ms ease, filter \d+ms ease, transform 80ms ease;/);
            expect(motionStyleSheet).toContain('button:active:not(:disabled) { transform: translateY(1px); }');
            expect(motionStyleSheet).toMatch(/\.treeHeader, \.treeObjectHeader, \.treeField, \.treeDataset \{ transition: background-color \d+ms ease, box-shadow \d+ms ease; \}/);
            expect(motionStyleSheet).toContain('.treeObjectHeader:focus-within, .treeField:focus-within { background-color: var(--sdt-row-hover); }');
            expect(motionStyleSheet).toContain('.treeHeader:active { background-color: var(--sdt-row-hover); }');
            expect(motionStyleSheet).toMatch(/\.sdtButton-primary:hover:not\(:disabled\) \{ filter: brightness\(0\.92\); \}/);
            expect(motionStyleSheet).toMatch(/\.sdtButton-primary:active:not\(:disabled\) \{ filter: brightness\(0\.84\); \}/);

        });

        // brightness() MULTIPLIES BOTH THE TEXT AND THE BACKGROUND, SO THE PRESSED STATE IS THE LOWEST CONTRAST A FILLED BUTTON DRAWS
        it('keeps --sdt-on-accent on the accent at 4.5:1 or more under the hover and pressed brightness filters', () => {

            const channelsOf = (hexColour: string) => [1, 3, 5].map(offset => parseInt(hexColour.substring(offset, offset + 2), 16) / 255);
            const luminanceOf = (channels: number[]) => {
                const [red, green, blue] = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
                return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
            };
            const filteredContrastOf = (brightness: number) => {
                const [lighter, darker] = [RECIPE_COCKPIT_PALETTE.onAccent, RECIPE_COCKPIT_PALETTE.accent]
                    .map(hexColour => luminanceOf(channelsOf(hexColour).map(channel => Math.min(1, channel * brightness))))
                    .sort((first, second) => second - first);
                return (lighter + 0.05) / (darker + 0.05);
            };
            const filterBrightnesses = (motionStyleSheet.match(/filter: brightness\((0\.\d+)\)/g) ?? [])
                .map(filterDeclaration => parseFloat((filterDeclaration.match(/0\.\d+/) as RegExpMatchArray)[0]));

            expect(filterBrightnesses).toEqual([0.92, 0.84]);
            filterBrightnesses.forEach(brightness => expect(filteredContrastOf(brightness)).toBeGreaterThanOrEqual(4.5));

        });

        it('adds no colour outside the palette', () => {

            const outsideRoot = styleSheet.replace(/:root \{[^}]*\}/, '').replace(/\/\*[\s\S]*?\*\//g, '');

            expect(outsideRoot).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
            (outsideRoot.match(/rgba?\([^)]*\)/g) ?? []).forEach(colour => expect(colour).toMatch(/^rgba\(15, 23, 42, 0\.0[68]\)$/));
            expect(Object.values(RECIPE_COCKPIT_PALETTE)).not.toBeEmpty();

        });

    });

    describe('the panel script', () => {

        type Panel = ReturnType<typeof runPanelScript>;

        const treeCardOf = (panel: Panel, treeKey: string) => panel.treeCards()
            .find((treeCard: any) => panel.findAll(treeCard, 'treeFolder')[0]?.textContent === treeKey);
        const treeBodyOf = (panel: Panel, treeKey: string) => panel.findAll(treeCardOf(panel, treeKey), 'treeBody')[0];
        const clickCard = (panel: Panel, treeKey: string) => panel.findAll(treeCardOf(panel, treeKey), 'treeToggle')[0].dispatch('click');
        const objectNamed = (panel: Panel, treeKey: string, objectApiName: string) => panel.findAll(treeCardOf(panel, treeKey), 'treeObject')
            .find((objectElement: any) => panel.objectNameOf(objectElement) === objectApiName);
        const tabListOf = (panel: Panel, treeKey: string) => panel.findAll(treeCardOf(panel, treeKey), 'treeTabs')[0];
        const isMoving = (element: any) => element.classList.contains('motionReveal') || element.classList.contains('motionConceal');

        const renderPanel = (panelScriptOptions: IPanelScriptOptions = {}, focusTree?: any) => {
            const panel = runPanelScript(panelScriptOptions);
            panel.postToPanel({ command: 'recipeData', recipe: loadHistoryRecipe(), renderSequence: 1, ...( focusTree ? { focusTree } : {} ) });
            return panel;
        };

        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('shows a card\'s body at once and fades it in, then drops the animation class once it has run', () => {

            const panel = renderPanel();
            const treeBody = treeBodyOf(panel, ACCOUNT_TREE_KEY);

            clickCard(panel, ACCOUNT_TREE_KEY);

            expect(panel.isHidden(treeBody)).toBe(false);
            expect(treeBody.classList.contains('motionReveal')).toBe(true);
            expect(panel.findAll(treeCardOf(panel, ACCOUNT_TREE_KEY), 'treeToggle')[0].attributes['aria-expanded']).toBe('true');

            jest.advanceTimersByTime(RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS);
            expect(isMoving(treeBody)).toBe(false);
            expect(panel.isHidden(treeBody)).toBe(false);

        });

        it('hides a closing body from assistive technology for the whole fade, and leaves it hidden after', () => {

            const panel = renderPanel();
            clickCard(panel, ACCOUNT_TREE_KEY);
            jest.advanceTimersByTime(RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS);
            const treeBody = treeBodyOf(panel, ACCOUNT_TREE_KEY);

            clickCard(panel, ACCOUNT_TREE_KEY);

            expect(panel.isHidden(treeBody)).toBe(true);
            expect(treeBody.classList.contains('motionConceal')).toBe(true);
            expect(treeBody.attributes['aria-hidden']).toBe('true');
            expect(treeBody.attributes).toHaveProperty('inert');
            expect(panel.findAll(treeCardOf(panel, ACCOUNT_TREE_KEY), 'treeToggle')[0].attributes['aria-expanded']).toBe('false');

            jest.advanceTimersByTime(RECIPE_COCKPIT_MOTION_CONCEAL_MILLISECONDS);
            expect(panel.isHidden(treeBody)).toBe(true);
            expect(isMoving(treeBody)).toBe(false);
            expect(treeBody.attributes).not.toHaveProperty('aria-hidden');
            expect(treeBody.attributes).not.toHaveProperty('inert');

        });

        it('given a body is reopened while it fades out, shows it again at once with nothing left hiding it', () => {

            const panel = renderPanel();
            clickCard(panel, ACCOUNT_TREE_KEY);
            const accountElement = objectNamed(panel, ACCOUNT_TREE_KEY, 'Account');
            const objectBody = panel.objectBodyOf(accountElement);

            panel.expandObject(accountElement);
            jest.advanceTimersByTime(RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS);
            panel.expandObject(accountElement);
            expect(objectBody.classList.contains('motionConceal')).toBe(true);

            panel.expandObject(accountElement);
            expect(panel.isHidden(objectBody)).toBe(false);
            expect(objectBody.classList.contains('motionConceal')).toBe(false);
            expect(objectBody.classList.contains('motionReveal')).toBe(true);
            expect(objectBody.attributes).not.toHaveProperty('aria-hidden');
            expect(objectBody.attributes).not.toHaveProperty('inert');

            // THE CONCEAL'S TIMER WAS CANCELLED: IT DOES NOT STRIP THE REVEAL HALF WAY
            jest.advanceTimersByTime(RECIPE_COCKPIT_MOTION_CONCEAL_MILLISECONDS - 1);
            expect(objectBody.classList.contains('motionReveal')).toBe(true);

        });

        it('builds an object\'s rows on its first expand only, before the fade, and never on a collapse', () => {

            const panel = renderPanel();
            clickCard(panel, ACCOUNT_TREE_KEY);
            const accountElement = objectNamed(panel, ACCOUNT_TREE_KEY, 'Account');
            const objectBody = panel.objectBodyOf(accountElement);

            expect(objectBody.children).toEqual([]);

            panel.expandObject(accountElement);
            const builtRows = [...objectBody.children];
            expect(builtRows).not.toBeEmpty();
            expect(objectBody.classList.contains('motionReveal')).toBe(true);

            panel.expandObject(accountElement);
            jest.advanceTimersByTime(RECIPE_COCKPIT_MOTION_CONCEAL_MILLISECONDS);
            panel.expandObject(accountElement);
            expect(objectBody.children).toEqual(builtRows);
            objectBody.children.forEach((rowElement: any, rowIndex: number) => expect(rowElement).toBe(builtRows[rowIndex]));

            // A COLLAPSED OBJECT NEXT TO IT WAS NEVER BUILT
            expect(panel.objectBodyOf(objectNamed(panel, ACCOUNT_TREE_KEY, 'Contact')).children).toEqual([]);

        });

        it('fades a picklist\'s values in and out on its ▸', () => {

            const panel = renderPanel();
            clickCard(panel, ACCOUNT_TREE_KEY);
            const accountElement = objectNamed(panel, ACCOUNT_TREE_KEY, 'Account');
            panel.expandObject(accountElement);
            const ratingRow = panel.fieldRowNamed(accountElement, 'Rating__c');
            const picklistToggle = panel.findAll(ratingRow, 'picklistToggle')[0];

            picklistToggle.dispatch('click');
            // THE FIRST OPEN BUILDS THE CONTAINER HIDDEN AND REVEALS IT, LIKE EVERY LATER OPEN
            const picklistValues = panel.findAll(ratingRow, 'picklistValues')[0];
            expect(panel.isHidden(picklistValues)).toBe(false);
            expect(picklistValues.classList.contains('motionReveal')).toBe(true);
            jest.advanceTimersByTime(RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS);

            picklistToggle.dispatch('click');
            expect(panel.isHidden(picklistValues)).toBe(true);
            expect(picklistValues.classList.contains('motionConceal')).toBe(true);
            expect(picklistToggle.attributes['aria-expanded']).toBe('false');

            jest.advanceTimersByTime(RECIPE_COCKPIT_MOTION_CONCEAL_MILLISECONDS);
            picklistToggle.dispatch('click');
            expect(panel.isHidden(picklistValues)).toBe(false);
            expect(picklistValues.classList.contains('motionReveal')).toBe(true);
            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'loadPicklistValues')).toHaveLength(1);

        });

        it('fades only the incoming tab panel in, and names which way the underline moves', () => {

            const panel = renderPanel();
            clickCard(panel, LEAD_TREE_KEY);
            jest.advanceTimersByTime(RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS);
            const leadCard = treeCardOf(panel, LEAD_TREE_KEY);
            const structurePanel = panel.tabPanelOf(leadCard, 'treeStructure');

            panel.openTab(leadCard, 'Previously Used Data Sets');
            const datasetsPanel = panel.tabPanelOf(leadCard, 'treeDatasets');

            expect(panel.isHidden(datasetsPanel)).toBe(false);
            expect(datasetsPanel.classList.contains('motionReveal')).toBe(true);
            expect(panel.isHidden(structurePanel)).toBe(true);
            expect(isMoving(structurePanel)).toBe(false);
            expect(tabListOf(panel, LEAD_TREE_KEY).classList.contains('movingRight')).toBe(true);

            panel.openTab(leadCard, 'Treecipe');
            expect(structurePanel.classList.contains('motionReveal')).toBe(true);
            expect(isMoving(datasetsPanel)).toBe(false);
            expect(tabListOf(panel, LEAD_TREE_KEY).classList.contains('movingLeft')).toBe(true);
            expect(tabListOf(panel, LEAD_TREE_KEY).classList.contains('movingRight')).toBe(false);

            // CLICKING THE TAB ALREADY SELECTED MOVES NOTHING
            jest.advanceTimersByTime(RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS);
            panel.openTab(leadCard, 'Treecipe');
            expect(isMoving(structurePanel)).toBe(false);
            expect(tabListOf(panel, LEAD_TREE_KEY).classList.contains('movingLeft')).toBe(false);

        });

        it('does not animate a card or tab the host opens with focusTree', () => {

            const panel = renderPanel({}, { treeKey: LEAD_TREE_KEY, tab: 'datasets' });
            const leadCard = treeCardOf(panel, LEAD_TREE_KEY);

            expect(panel.isHidden(treeBodyOf(panel, LEAD_TREE_KEY))).toBe(false);
            expect(isMoving(treeBodyOf(panel, LEAD_TREE_KEY))).toBe(false);
            expect(isMoving(panel.tabPanelOf(leadCard, 'treeDatasets'))).toBe(false);
            expect(tabListOf(panel, LEAD_TREE_KEY).classList.contains('noMotion')).toBe(true);

        });

        it('turns the ▸ with motion only on the reader\'s click', () => {

            const panel = renderPanel({}, { treeKey: LEAD_TREE_KEY, tab: 'treecipe' });
            const leadToggle = panel.findAll(treeCardOf(panel, LEAD_TREE_KEY), 'treeToggle')[0];
            const accountToggle = panel.findAll(treeCardOf(panel, ACCOUNT_TREE_KEY), 'treeToggle')[0];

            expect(leadToggle.attributes['aria-expanded']).toBe('true');
            expect(leadToggle.classList.contains('noMotion')).toBe(true);

            clickCard(panel, ACCOUNT_TREE_KEY);
            expect(accountToggle.classList.contains('noMotion')).toBe(false);

            panel.typeIntoFilter('Rating__c', treeCardOf(panel, ACCOUNT_TREE_KEY));
            const objectToggle = panel.findAll(objectNamed(panel, ACCOUNT_TREE_KEY, 'Account'), 'treeObjectToggle')[0];
            expect(objectToggle.attributes['aria-expanded']).toBe('true');
            expect(objectToggle.classList.contains('noMotion')).toBe(true);

        });

        it('keeps a search instant: an object it opens is not animated', () => {

            const panel = renderPanel();
            clickCard(panel, ACCOUNT_TREE_KEY);
            jest.advanceTimersByTime(RECIPE_COCKPIT_MOTION_REVEAL_MILLISECONDS);

            panel.typeIntoFilter('Rating__c', treeCardOf(panel, ACCOUNT_TREE_KEY));
            const accountBody = panel.objectBodyOf(objectNamed(panel, ACCOUNT_TREE_KEY, 'Account'));

            expect(panel.isHidden(accountBody)).toBe(false);
            expect(isMoving(accountBody)).toBe(false);

        });

        it('given the reader prefers reduced motion, shows and hides everything at once with no animation class', () => {

            const panel = renderPanel({ prefersReducedMotion: true });
            const treeBody = treeBodyOf(panel, LEAD_TREE_KEY);

            clickCard(panel, LEAD_TREE_KEY);
            expect(panel.isHidden(treeBody)).toBe(false);
            expect(isMoving(treeBody)).toBe(false);

            panel.openTab(treeCardOf(panel, LEAD_TREE_KEY), 'Previously Used Data Sets');
            expect(isMoving(panel.tabPanelOf(treeCardOf(panel, LEAD_TREE_KEY), 'treeDatasets'))).toBe(false);

            clickCard(panel, LEAD_TREE_KEY);
            expect(panel.isHidden(treeBody)).toBe(true);
            expect(isMoving(treeBody)).toBe(false);
            expect(treeBody.attributes).not.toHaveProperty('aria-hidden');

        });

        it('animates when the window has no matchMedia, and when the reader does not prefer reduced motion', () => {

            const panel = renderPanel({ prefersReducedMotion: false });
            clickCard(panel, LEAD_TREE_KEY);

            expect(treeBodyOf(panel, LEAD_TREE_KEY).classList.contains('motionReveal')).toBe(true);

        });

    });

});
