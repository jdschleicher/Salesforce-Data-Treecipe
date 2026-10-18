import * as matchers from 'jest-extended';
expect.extend(matchers);
import * as path from 'path';
jest.mock('vscode', () => ({
    workspace: { workspaceFolders: undefined, getConfiguration: jest.fn().mockReturnValue({ get: jest.fn(), update: jest.fn(), inspect: jest.fn() }) },
    env: { openExternal: jest.fn() },
    window: { createWebviewPanel: jest.fn(), showWarningMessage: jest.fn(), showInformationMessage: jest.fn(), showErrorMessage: jest.fn() },
    commands: { registerCommand: jest.fn(), executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15, Window: 10 },
    ConfigurationTarget: { Workspace: 2 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }), parse: (uriValue: string) => ({ toString: () => uriValue }) }
}), { virtual: true });
import {
    RecipeCockpitService,
    RECIPE_COCKPIT_BUTTON_KINDS,
    RECIPE_COCKPIT_NO_RUN_MESSAGE
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    #363: the Troubleshooting tab's deploy buttons shipped as browser defaults, because a button was
    styled only when its class had been added to each of several selector lists. Every button is now
    made by createButton and styled by its KIND. These tests fail on a button made any other way,
    on a button that carries no kind or two, and on a state rule that lists button classes again.
*/
const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const KIND_CLASSES = RECIPE_COCKPIT_BUTTON_KINDS.map(kind => 'sdtButton-' + kind);

type Panel = ReturnType<typeof runPanelScript>;

const shellHtml = () => RecipeCockpitService.buildWebviewShellHtml('testNonce');
const styleSheetOf = (html: string) => html.substring(html.indexOf('<style nonce="testNonce">'), html.indexOf('</style>'));
const panelScriptOf = (html: string) => html.substring(html.lastIndexOf('<script nonce="testNonce">'), html.lastIndexOf('</script>'));

const loadTreeRecipe = () => {
    const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
    return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, 'recipe-2026-09-20T10-00-00').recipeViewModel;
};

const collectButtons = (rootElements: any[]): any[] => {
    const buttonElements: any[] = [];
    const visit = (element: any) => {
        if ( element.tagName === 'button' ) { buttonElements.push(element); }
        element.children.forEach(visit);
    };
    rootElements.forEach(visit);
    return buttonElements;
};

const describeButton = (buttonElement: any) => `<button class="${buttonElement.className}">${buttonElement.textContent}`;

const findButtonsWithoutOneKind = (buttonElements: any[]) => buttonElements
    .filter(buttonElement => {
        const classNames = buttonElement.className.split(' ');
        return !classNames.includes('sdtButton') || classNames.filter((className: string) => KIND_CLASSES.includes(className)).length !== 1;
    })
    .map(describeButton);

// EVERY PLACE THE PANEL DRAWS A BUTTON: EACH CARD OPEN, EACH TAB BUILT, EACH OBJECT EXPANDED, AND THE OPENABLE SECTIONS AND EDITOR
const renderEverything = (): Panel => {

    const panel = runPanelScript();
    panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 });
    panel.postToPanel({ command: 'rendered' });
    panel.expandAllTrees();
    panel.treeCards().forEach(treeCard => panel.findAll(treeCard, 'treeTab').forEach((tabElement: any) => tabElement.dispatch('click')));
    panel.treeCards().forEach(treeCard => panel.openTab(treeCard, 'Treecipe'));
    panel.objectElements().forEach(objectElement => panel.expandObject(objectElement));
    panel.findAll(panel.cockpitBodyElement, 'recordTypesSectionHeader').forEach((headerElement: any) => headerElement.dispatch('click'));
    panel.findAll(panel.cockpitBodyElement, 'helpToggle').forEach((toggleElement: any) => toggleElement.dispatch('click'));
    const editButton = panel.findAll(panel.cockpitBodyElement, 'treeFieldFixedValue').find((buttonElement: any) => !buttonElement.disabled);
    editButton.dispatch('click');
    return panel;

};

describe('RecipeCockpitService, button kinds (#363)', () => {

    it('makes every button through createButton, so no button can skip its kind', () => {

        const panelScript = panelScriptOf(shellHtml());

        expect(panelScript).toContain('function createButton(kind, className, textContent, size)');
        // ONE createElement('button', …) IS LEFT: THE ONE INSIDE createButton
        expect(panelScript.match(/createElement\(\s*['"]button['"]/g)).toHaveLength(1);
        expect(panelScript).toMatch(/function createButton[\s\S]{0,400}?createElement\('button', buttonClassName, textContent\)/);
        expect(panelScript).not.toMatch(/innerHTML|<button/);

    });

    it('names a kind the stylesheet styles at every call, and only those kinds', () => {

        const html = shellHtml();
        const calledKinds = Array.from(new Set(Array.from(panelScriptOf(html).matchAll(/createButton\('([^']*)'/g), match => match[1])));

        expect(calledKinds.sort()).toEqual([...RECIPE_COCKPIT_BUTTON_KINDS].sort());
        KIND_CLASSES.forEach(kindClass => expect(styleSheetOf(html)).toMatch(new RegExp('\\n\\s*[^{}\\n]*\\.' + kindClass + '[ ,][^{}\\n]*\\{')));
        expect(panelScriptOf(html)).toContain(`const BUTTON_KINDS = ${JSON.stringify(RECIPE_COCKPIT_BUTTON_KINDS)};`);

    });

    it('gives every button it draws sdtButton and exactly one kind, across every tab, section and the field editor', () => {

        const panel = renderEverything();
        const buttonElements = collectButtons([panel.cockpitBodyElement, panel.cockpitMetaElement]);

        expect(findButtonsWithoutOneKind(buttonElements)).toEqual([]);
        // THE WALK REALLY REACHED THEM: EVERY KIND, AND THE BUTTONS #363 WAS OPENED FOR
        KIND_CLASSES.forEach(kindClass => expect(buttonElements.some(buttonElement => buttonElement.classList.contains(kindClass))).toBe(true));
        ['troubleshootingDeploy', 'treePermissionSets', 'treeGeneratePermissionSet', 'treeRetrieveValidationRules', 'treeInsert',
            'fieldEditorSave', 'fieldEditorClear', 'fieldEditorCancel', 'cockpitChangelog', 'helpGuideOpen', 'dataOrgNewScratch']
            .forEach(className => expect(buttonElements.some(buttonElement => buttonElement.classList.contains(className))).toBe(true));
        expect(buttonElements.length).toBeGreaterThan(40);

    });

    it('gives the empty state\'s Generate Treecipe button the primary kind', () => {

        const panel = runPanelScript();
        panel.postToPanel({ command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: RECIPE_COCKPIT_NO_RUN_MESSAGE }, renderSequence: 1 });
        const buttonElements = collectButtons([panel.cockpitBodyElement, panel.cockpitMetaElement]);

        expect(findButtonsWithoutOneKind(buttonElements)).toEqual([]);
        expect(panel.findAll(panel.cockpitBodyElement, 'generateTreecipe')[0].className).toBe('sdtButton sdtButton-primary generateTreecipe');

    });

    it('draws the four Troubleshooting deploys as secondary buttons beside Assign and Retrieve, in the shared disabled style while they cannot run', () => {

        const panel = renderEverything();
        const deployButtons = panel.findAll(panel.cockpitBodyElement, 'troubleshootingDeploy');

        expect(deployButtons.length).toBeGreaterThanOrEqual(4);
        deployButtons.forEach((buttonElement: any) => {
            expect(buttonElement.classList.contains('sdtButton')).toBe(true);
            expect(buttonElement.classList.contains('sdtButton-secondary')).toBe(true);
        });
        ['treePermissionSets', 'treeRetrieveValidationRules'].forEach(className =>
            expect(panel.findAll(panel.cockpitBodyElement, className)[0].classList.contains('sdtButton-secondary')).toBe(true));
        // NO COUNTS HAVE COME BACK, SO EVERY DEPLOY IS DISABLED, AND THE KIND'S :disabled RULE IS WHAT DRAWS IT
        expect(deployButtons.every((buttonElement: any) => buttonElement.disabled)).toBe(true);
        expect(styleSheetOf(shellHtml())).toMatch(/\.sdtButton-secondary:disabled[^{]*\{[^}]*color: var\(--sdt-disabled-text\);[^}]*background-color: var\(--sdt-disabled-bg\);[^}]*cursor: not-allowed;/);

    });

    it('styles a button\'s states only through its kind: no hover, active or disabled rule lists two button classes', () => {

        const html = shellHtml();
        // THE LITERAL CLASSES AT EACH CALL, AND EVERY CLASS A DRAWN BUTTON CARRIES: A CLASS HANDED IN THROUGH A VARIABLE (treeToggle) COUNTS TOO
        const drawnClassNames = collectButtons([renderEverything().cockpitBodyElement])
            .flatMap(buttonElement => buttonElement.className.split(' '))
            .filter((className: string) => className !== 'sdtButton' && !className.startsWith('sdtButton-') && className !== 'hidden' && className !== 'selected');
        const buttonClassNames = new Set([
            ...Array.from(panelScriptOf(html).matchAll(/createButton\('[^']*', (?:isSelected \? )?'([A-Za-z]+)/g), match => match[1]),
            ...drawnClassNames
        ]);
        const stateRules = Array.from(styleSheetOf(html).matchAll(/\n\s*([^{}\n]*:(?:hover|active|disabled)[^{}\n]*) \{/g), match => match[1]);
        const namedButtonClasses = (selector: string) => Array.from(selector.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g), match => match[1]).filter(className => buttonClassNames.has(className));

        expect(buttonClassNames.size).toBeGreaterThan(30);
        const listedRules = stateRules.filter(selectorList => new Set(namedButtonClasses(selectorList)).size > 1);
        expect(listedRules).toEqual([]);

    });

    it('defines a hover, a disabled and a focus state for every kind a reader can press', () => {

        const styleSheet = styleSheetOf(shellHtml());

        expect(styleSheet).toContain(':focus-visible { outline: 2px solid var(--sdt-accent);');
        ['sdtButton-primary', 'sdtButton-secondary', 'sdtButton-icon'].forEach(kindClass => {
            expect(styleSheet).toMatch(new RegExp('\\.' + kindClass + ':hover:not\\(:disabled\\)'));
            expect(styleSheet).toMatch(new RegExp('\\.' + kindClass + ':disabled'));
        });
        expect(styleSheet).toMatch(/\.sdtButton-check:disabled \{[^}]*cursor: not-allowed;/);
        expect(styleSheet).toMatch(/\.sdtButton-link:hover \{ text-decoration: underline; \}/);
        // compact IS A SIZE THAT GOES WITH A KIND, AND SETS NO COLOUR OF ITS OWN
        expect(styleSheet).toMatch(/\.sdtButton-compact \{ min-height: 0; min-width: 0; padding: 0\.15rem 0\.6rem; font-size: inherit; \}/);

    });

    it('keeps the field editor\'s buttons in the kinds: Save filled, Clear and Cancel outlined, all three compact', () => {

        const panel = renderEverything();

        expect(panel.findAll(panel.cockpitBodyElement, 'fieldEditorSave')[0].className).toBe('sdtButton sdtButton-primary sdtButton-compact fieldEditorSave');
        expect(panel.findAll(panel.cockpitBodyElement, 'fieldEditorClear')[0].className).toBe('sdtButton sdtButton-secondary sdtButton-compact fieldEditorClear');
        expect(panel.findAll(panel.cockpitBodyElement, 'fieldEditorCancel')[0].className).toBe('sdtButton sdtButton-secondary sdtButton-compact fieldEditorCancel');
        expect(styleSheetOf(shellHtml())).not.toMatch(/\.fieldEditorActions button/);

    });

});
