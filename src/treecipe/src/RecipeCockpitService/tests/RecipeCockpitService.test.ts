import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitLoadedRecipe,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_VIEW_TYPE,
    RECIPE_COCKPIT_PANEL_TITLE,
    RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT,
    RECIPE_COCKPIT_TREE_DATA_MISSING_NOTICE,
    RECIPE_COCKPIT_UNGROUPED_TREE_TITLE,
    RECIPE_COCKPIT_ISSUES_URL,
    RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL,
    RECIPE_COCKPIT_NO_RUN_MESSAGE,
    RECIPE_COCKPIT_GENERATE_TREECIPE_ACTION_LABEL,
    RECIPE_COCKPIT_GENERATE_TREECIPE_RUNNING_LABEL,
    RECIPE_COCKPIT_LOAD_PHASES,
    RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT,
    RECIPE_COCKPIT_TREE_TABS,
    RECIPE_COCKPIT_AUTO_EXPAND_ROW_BUDGET,
    RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND,
    RECIPE_COCKPIT_REFRESH_ORGS_LABEL,
    RECIPE_COCKPIT_PALETTE,
    RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH,
    RECIPE_COCKPIT_TOGGLE_EXPANDED_GLYPH_PATH,
    RECIPE_COCKPIT_INSERT_DATASET_COMMAND,
    RECIPE_COCKPIT_RUN_FAKER_COMMAND,
    RECIPE_COCKPIT_RUN_FAKER_ACTION_LABEL,
    RECIPE_COCKPIT_RUN_FAKER_RUNNING_LABEL,
    RecipeCockpitPaletteToken
} from '../RecipeCockpitService';
import { RecipeCockpitTreeHistory } from '../RecipeCockpitTreeHistory';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { DatasetSourceService, DATASET_COLLECTIONS_API_FOLDER_NAME, IDatasetListing, IDatasetSourceReadResult } from '../../DatasetSourceService/DatasetSourceService';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { INormalizedOrgField, INormalizedOrgObjectDescribe } from '../../SalesforceOrgService/SalesforceOrgService';
import { SalesforceOrgService, ORG_DESCRIBE_CANCELLED_MESSAGE } from '../../SalesforceOrgService/SalesforceOrgService';
import { SfdxProjectService } from '../../SfdxProjectService/SfdxProjectService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';

const MOCK_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'workspace');
const MOCK_GENERATED_RECIPES_PATH = path.join(MOCK_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const LATEST_RUN_FOLDER_NAME = 'recipe-2026-09-04T11-22-07';
const FAKER_JS_RUN_FOLDER_NAME = 'recipe-fakerjs-2026-09-01T08-00-00';
// A WORKSPACE OF ITS OWN, SO ITS RUNS DO NOT CHANGE WHICH RUN IS LATEST IN THE ONE ABOVE
const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const LEGACY_TREE_RUN_FOLDER_NAME = 'recipe-2026-09-01T00-00-00';
// THE TREE WORKSPACE'S RUNS, PLUS A FAKER-JS RUN WHOSE WRAPPER IS UNREADABLE AND A FakeDataSets FOLDER OF EVERY KIND OF DATA SET
const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const HISTORY_CURRENT_RUN = 'recipe-2026-09-20T10-00-00';
const LATEST_RECIPE_FILE_PATH = path.join(
    MOCK_GENERATED_RECIPES_PATH,
    LATEST_RUN_FOLDER_NAME,
    'Account-thru-Contact',
    'recipe--Account-thru-Contact-2026-09-04T11-22-07.yml'
);

function buildOrgField(fieldApiName: string, fieldType: string, overrides: Partial<INormalizedOrgField> = {}): INormalizedOrgField {

    return {
        fieldApiName: fieldApiName,
        fieldLabel: fieldApiName,
        fieldType: fieldType,
        length: 0,
        precision: 0,
        scale: 0,
        picklistValues: [],
        controllingField: '',
        referenceTo: [],
        isNillable: true,
        isCreateable: true,
        isCalculated: false,
        isDefaultedOnCreate: false,
        isNameField: false,
        ...overrides
    };

}

const buildOrgPicklistValue = (value: string, isActive = true) => ({ value: value, label: value, isActive: isActive, isDefault: false });

/*
    The fixture run's Account as an org would describe it, with one of every status against the
    recipe: Name matches, Industry has gained Retail and lost Banking, Number_of_Contacts__c is text
    in the org, Legacy_Code__c is gone, Rating__c is new, and Id is a field no recipe can write.
*/
const ACCOUNT_ORG_DESCRIBE: INormalizedOrgObjectDescribe = {
    objectApiName: 'Account',
    objectLabel: 'Account',
    isCreateable: true,
    fields: [
        buildOrgField('Id', 'id', { isCreateable: false }),
        buildOrgField('Name', 'string'),
        buildOrgField('Industry', 'picklist', { picklistValues: [buildOrgPicklistValue('Agriculture'), buildOrgPicklistValue('Retail'), buildOrgPicklistValue('Mining', false)] }),
        buildOrgField('Industry_Group__c', 'picklist', { controllingField: 'Industry' }),
        buildOrgField('Number_of_Contacts__c', 'string'),
        buildOrgField('Rating__c', 'picklist')
    ]
};

const RECIPE_PICKLIST_VALUES = new Map([['Account', new Map([['Industry', ['Agriculture', 'Banking']]])]]);

function buildRecipeViewModel(overrides: Partial<IRecipeCockpitRecipeViewModel> = {}): IRecipeCockpitRecipeViewModel {

    return {
        runs: [{ runFolderName: LATEST_RUN_FOLDER_NAME, label: 'latest run' }],
        selectedRunFolderName: LATEST_RUN_FOLDER_NAME,
        objects: [],
        trees: [],
        notices: [],
        emptyStateMessage: '',
        ...overrides
    };

}

describe('RecipeCockpitService', () => {

    describe('buildContentSecurityPolicy', () => {

        it('allows only the nonced inline style and script and no remote content at all', () => {

            const actualContentSecurityPolicy = RecipeCockpitService.buildContentSecurityPolicy('testNonce');

            expect(actualContentSecurityPolicy).toContain(`default-src 'none'`);
            expect(actualContentSecurityPolicy).toContain(`style-src 'nonce-testNonce'`);
            expect(actualContentSecurityPolicy).toContain(`script-src 'nonce-testNonce'`);
            // NEITHER FALLS BACK TO default-src, SO BOTH ARE NAMED EXPLICITLY
            expect(actualContentSecurityPolicy).toContain(`form-action 'none'`);
            expect(actualContentSecurityPolicy).toContain(`base-uri 'none'`);
            expect(actualContentSecurityPolicy).not.toContain('http');

        });

    });

    describe('buildNonce', () => {

        it('builds a distinct alphanumeric nonce on each call', () => {

            const firstNonce = RecipeCockpitService.buildNonce();
            const secondNonce = RecipeCockpitService.buildNonce();

            expect(firstNonce).toMatch(/^[A-Za-z0-9]{32}$/);
            expect(firstNonce).not.toBe(secondNonce);

        });

    });

    describe('buildWebviewShellHtml', () => {

        it('carries the content security policy meta and nonces every inline block it emits', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(actualShellHtml).toContain(
                `<meta http-equiv="Content-Security-Policy" content="${RecipeCockpitService.buildContentSecurityPolicy('testNonce')}">`
            );
            expect(actualShellHtml).toContain('<style nonce="testNonce">');
            expect(actualShellHtml).toContain('<script nonce="testNonce">');

        });

        // AN UN-NONCED INLINE BLOCK IS SILENTLY DEAD UNDER THE CSP, SO EVERY ONE IS COUNTED RATHER THAN SPOT CHECKED
        it('emits no inline style or script block without a nonce', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            const inlineBlockOpenings = actualShellHtml.match(/<(style|script)\b[^>]*>/g) ?? [];

            expect(inlineBlockOpenings).not.toBeEmpty();
            inlineBlockOpenings.forEach(inlineBlockOpening => {
                expect(inlineBlockOpening).toContain('nonce="testNonce"');
            });

        });

        it('references no external asset of any kind', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(actualShellHtml).not.toMatch(/\ssrc="/);
            expect(actualShellHtml).not.toMatch(/<link\b/);
            // THE ONE URL IS THE SVG NAMESPACE createElementNS NAMES THE TREE GLYPH BY (#219) -- AN IDENTIFIER, NEVER FETCHED
            expect(actualShellHtml.match(/https?:\/\/[^'"\s]*/g)).toEqual(['http://www.w3.org/2000/svg']);
            expect(actualShellHtml).toContain("const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';");

        });

        /*
            The builder takes a nonce and nothing else, and that signature is the guarantee: a
            recipe value can only reach the template through a parameter.
        */
        it('takes the nonce as its only parameter', () => {

            expect(RecipeCockpitService.buildWebviewShellHtml.length).toBe(1);

        });

        // WRITING THROUGH innerHTML ANYWHERE IS WHAT WOULD RE-OPEN A MARKUP CONTEXT FOR A RECIPE VALUE
        it('writes nothing through innerHTML or outerHTML', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(actualShellHtml).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);

        });

        // PINS THE MARKUP THE FAKE DOM BELOW ANSWERS getElementById WITH
        it('declares the status line and the body the panel script addresses', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(actualShellHtml).toContain(`<title>${RECIPE_COCKPIT_PANEL_TITLE}</title>`);
            expect(actualShellHtml).toContain(`<div id="loadStatus" class="loadStatus">${RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT}</div>`);
            expect(actualShellHtml).toContain('<div id="cockpitBody"></div>');

        });

    });

    describe('the cockpit palette', () => {

        const FONT_VARIABLES_FOLLOWING_THE_EDITOR = ['--vscode-font-family', '--vscode-editor-font-family', '--vscode-font-size'];

        const TEXT_TOKENS: RecipeCockpitPaletteToken[] = ['text', 'muted', 'accent', 'added', 'removed', 'changed'];
        const BACKGROUND_TOKENS: RecipeCockpitPaletteToken[] = ['page', 'surface', 'header', 'rowHover'];

        const TEXT_ON_BACKGROUND_PAIRS: [RecipeCockpitPaletteToken, RecipeCockpitPaletteToken][] = [
            ...TEXT_TOKENS.flatMap(textToken => BACKGROUND_TOKENS.map(backgroundToken =>
                [textToken, backgroundToken] as [RecipeCockpitPaletteToken, RecipeCockpitPaletteToken])),
            ['chipText', 'chipBg'],
            ['onAccent', 'accent'],
            ['disabledText', 'disabledBg']
        ];

        const MINIMUM_TEXT_CONTRAST_RATIO = 4.5;

        // WCAG 2.x RELATIVE LUMINANCE OF AN sRGB #RRGGBB COLOUR
        const relativeLuminanceOf = (hexColour: string): number => {
            const [red, green, blue] = [1, 3, 5]
                .map(offset => parseInt(hexColour.substring(offset, offset + 2), 16) / 255)
                .map(channel => channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
            return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        };

        const contrastRatioOf = (firstHexColour: string, secondHexColour: string): number => {
            const [lighter, darker] = [relativeLuminanceOf(firstHexColour), relativeLuminanceOf(secondHexColour)].sort((a, b) => b - a);
            return (lighter + 0.05) / (darker + 0.05);
        };

        const findContrastFailures = (palette: Readonly<Record<RecipeCockpitPaletteToken, string>>): string[] =>
            TEXT_ON_BACKGROUND_PAIRS
                .map(([textToken, backgroundToken]) => ({ textToken, backgroundToken, ratio: contrastRatioOf(palette[textToken], palette[backgroundToken]) }))
                .filter(pair => pair.ratio < MINIMUM_TEXT_CONTRAST_RATIO)
                .map(pair => `${pair.textToken} on ${pair.backgroundToken} (${pair.ratio.toFixed(2)}:1)`);

        const styleSheetOf = (shellHtml: string): string =>
            shellHtml.substring(shellHtml.indexOf('<style nonce="testNonce">'), shellHtml.indexOf('</style>'));

        const findThemeColourReads = (shellHtml: string): string[] =>
            (shellHtml.match(/var\(--vscode-[A-Za-z0-9-]+/g) ?? [])
                .map(variableRead => variableRead.substring('var('.length))
                .filter(variableName => !FONT_VARIABLES_FOLLOWING_THE_EDITOR.includes(variableName));

        it('defines every palette token as an --sdt- custom property on :root, valued from RECIPE_COCKPIT_PALETTE', () => {

            const rootBlock = styleSheetOf(RecipeCockpitService.buildWebviewShellHtml('testNonce')).match(/:root \{[^}]*\}/)?.[0] ?? '';

            expect(RECIPE_COCKPIT_PALETTE).toEqual({
                page: '#F4F6F9', surface: '#FFFFFF', border: '#DDE3EA', header: '#EEF3FB',
                text: '#1F2937', muted: '#5B6472', accent: '#2563EB', onAccent: '#FFFFFF',
                rowHover: '#F1F5FF', chipBg: '#EEF2FF', chipText: '#3730A3',
                added: '#15803D', removed: '#B91C1C', changed: '#B45309',
                disabledBg: '#E5E7EB', disabledText: '#4B5563',
                excludedOverlay: 'rgba(148, 163, 184, 0.40)'
            });
            expect(rootBlock).toContain('--sdt-page: #F4F6F9;');
            expect(rootBlock).toContain('--sdt-on-accent: #FFFFFF;');
            expect(rootBlock).toContain('--sdt-row-hover: #F1F5FF;');
            expect(rootBlock).toContain('--sdt-chip-bg: #EEF2FF;');
            expect(rootBlock).toContain('--sdt-chip-text: #3730A3;');
            (Object.keys(RECIPE_COCKPIT_PALETTE) as RecipeCockpitPaletteToken[]).forEach(paletteToken => {
                expect(rootBlock).toContain(`${RecipeCockpitService.buildPaletteCustomPropertyName(paletteToken)}: ${RECIPE_COCKPIT_PALETTE[paletteToken]};`);
            });

        });

        // THE PALETTE IS WRITTEN INTO THE NONCED STYLE BLOCK AS IS, SO A RUNTIME WRITE TO IT WOULD BE ONE INTO THE DOCUMENT
        it('is frozen, so nothing can change a value the shell writes into its stylesheet', () => {

            expect(Object.isFrozen(RECIPE_COCKPIT_PALETTE)).toBeTrue();

        });

        // A TYPO IN A var() READ FALLS BACK TO THE INHERITED VALUE SILENTLY, SO EVERY READ IS CHECKED AGAINST WHAT IS DEFINED
        it('reads no --sdt- property the palette does not define', () => {

            const definedPropertyNames = (Object.keys(RECIPE_COCKPIT_PALETTE) as RecipeCockpitPaletteToken[])
                .map(paletteToken => RecipeCockpitService.buildPaletteCustomPropertyName(paletteToken));
            const readPropertyNames = (styleSheetOf(RecipeCockpitService.buildWebviewShellHtml('testNonce')).match(/var\(--sdt-[a-z-]+/g) ?? [])
                .map(variableRead => variableRead.substring('var('.length));

            expect(readPropertyNames).not.toBeEmpty();
            readPropertyNames.forEach(readPropertyName => expect(definedPropertyNames).toContain(readPropertyName));

        });

        it('reads no VS Code theme colour, only the three editor font variables', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(findThemeColourReads(actualShellHtml)).toEqual([]);
            FONT_VARIABLES_FOLLOWING_THE_EDITOR.forEach(fontVariable => expect(actualShellHtml).toContain(`var(${fontVariable})`));

        });

        it('fails the theme check when a VS Code colour variable is read', () => {

            const shellHtmlReadingTheTheme = RecipeCockpitService.buildWebviewShellHtml('testNonce')
                .replace('</style>', '    .object { background-color: var(--vscode-editor-background); }\n</style>');

            expect(findThemeColourReads(shellHtmlReadingTheTheme)).toEqual(['--vscode-editor-background']);

        });

        it('styles the page, native controls and scrollbars from the palette rather than the theme', () => {

            const styleSheet = styleSheetOf(RecipeCockpitService.buildWebviewShellHtml('testNonce'));

            expect(styleSheet).toContain('color-scheme: light;');
            expect(styleSheet).toMatch(/html, body \{[^}]*color: var\(--sdt-text\);[^}]*background-color: var\(--sdt-page\);/);
            expect(styleSheet).toMatch(/::-webkit-scrollbar-thumb \{[^}]*var\(--sdt-border\)/);
            expect(styleSheet).toContain('scrollbar-color: var(--sdt-border) var(--sdt-page);');

        });

        it('draws each tree as a card, highlights rows and rings keyboard focus in the accent', () => {

            const styleSheet = styleSheetOf(RecipeCockpitService.buildWebviewShellHtml('testNonce'));
            const treeCardRule = styleSheet.match(/\.treeCard \{[^}]*\}/)?.[0] ?? '';

            expect(treeCardRule).toContain('background-color: var(--sdt-surface);');
            expect(treeCardRule).toContain('border: 1px solid var(--sdt-border);');
            expect(treeCardRule).toContain('border-radius: 8px;');
            expect(treeCardRule).toContain('box-shadow:');
            expect(styleSheet).toMatch(/\.treeObjectHeader:hover, \.treeField:hover \{ background-color: var\(--sdt-row-hover\); \}/);
            // THE CLASSIC LIST'S RULES WENT WITH IT
            expect(styleSheet).not.toMatch(/\.object \{|\.field \{|\.classicControls/);
            expect(styleSheet).toContain(':focus-visible { outline: 2px solid var(--sdt-accent);');

        });

        it('restyles the buttons with the accent and the insert result with the added and changed tokens', () => {

            const styleSheet = styleSheetOf(RecipeCockpitService.buildWebviewShellHtml('testNonce'));

            expect(styleSheet).toMatch(/\.treeRunFaker, \.toolbar button, \.emptyStateActions button, \.treeInsert, \.dataOrgLoad, \.dataOrgNewScratch \{[^}]*color: var\(--sdt-on-accent\);[^}]*background-color: var\(--sdt-accent\);/);
            expect(styleSheet).toContain('.treeInsertResult.succeeded { color: var(--sdt-added); }');
            expect(styleSheet).toContain('.treeInsertResult.partial { color: var(--sdt-changed); }');
            // #266: THE COMPARE TAB'S DIFF BADGES, ROWS AND CONTROLS ARE GONE, WITH THEIR RULES
            expect(styleSheet).not.toMatch(/\.diff|\.dataObject|\.dataField|\.treeCompare|\.orgStatus|\.orgProgress|\.orgDescribe|\.statusFilter|\.dataTreeCount|\.describeIn/);
            expect(styleSheet).toMatch(/\.sourceLink \{[^}]*color: var\(--sdt-accent\);/);

        });

        const COCKPIT_BUTTON_SELECTORS = [
            '.treeToggle', '.treeObjectToggle', '.picklistToggle', '.treeRunFaker',
            '.treeTab', '.historyAction', '.treeAddFriend', '.treeAddFriendChoice',
            '.toolbar button', '.emptyStateActions button', '.dataOrgRefresh',
            '.treeInsert', '.treeInsertErrors', '.scratchOrgViewOutput', '.dataOrgLoad', '.dataOrgNewScratch'
        ];

        const ruleFor = (styleSheet: string, selectorPattern: string): string =>
            styleSheet.match(new RegExp('(^|\\n)\\s*' + selectorPattern + ' \\{[^}]*\\}'))?.[0] ?? '';

        // #209: EVERY BUTTON USED TO BE A BARE LINK ONE GLYPH TALL -- ONE SHARED RULE GIVES EACH A REAL, TWICE-AS-TALL TARGET
        it('sizes every cockpit button from one shared rule with a minimum height, padding and a visible border', () => {

            const styleSheet = styleSheetOf(RecipeCockpitService.buildWebviewShellHtml('testNonce'));
            const sharedButtonRule = styleSheet.match(/\n\s*([^{}\n]*\.treeToggle[^{}\n]*) \{([^}]*)\}/);

            expect(sharedButtonRule).not.toBeNull();
            const sharedSelectors = (sharedButtonRule as RegExpMatchArray)[1].split(',').map(selector => selector.trim());
            COCKPIT_BUTTON_SELECTORS.forEach(selector => expect(sharedSelectors).toContain(selector));
            expect((sharedButtonRule as RegExpMatchArray)[2]).toContain('min-height: 2.25rem;');
            expect((sharedButtonRule as RegExpMatchArray)[2]).toMatch(/padding: 0\.4rem 0\.8rem;/);
            expect((sharedButtonRule as RegExpMatchArray)[2]).toContain('border: 1px solid var(--sdt-border);');
            // #263: THE FAVORITE (☆) BUTTON'S SIZE IS EVERY BUTTON'S DEFAULT, SET AFTER font: inherit SO IT IS NOT RESET
            expect((sharedButtonRule as RegExpMatchArray)[2]).toMatch(/font: inherit;\s*font-size: 1\.1em;/);
            expect(ruleFor(styleSheet, '\\.treeFieldBulk button, \\.treeResetSelection')).toMatch(/font: inherit;\s*font-size: 1\.1em;/);
            expect(ruleFor(styleSheet, '\\.treeFavorite, \\.treeRename')).toContain('font-size: 1.1em;');
            // #263: THE ⟳ GLYPH DRAWS SMALL IN MOST FONTS, SO IT IS SIZED ABOVE THE BUTTON'S OWN 1.1em
            expect(ruleFor(styleSheet, '\\.dataOrgRefreshIcon')).toContain('font-size: 1.5em;');
            // #263: REGENERATE RECIPE AND ITS NOTE ARE GONE, WITH THEIR RULES
            expect(styleSheet).not.toMatch(/\.regenerate/);
            expect(styleSheet).not.toMatch(/\.treeRunFaker \{ padding: 0 /);
            // #217: 🔍, ITS CLEAR BUTTON, THE VIEW SWITCH AND THE DATA-BY-ORG VIEW'S CARDS ARE GONE, WITH THEIR RULES
            expect(styleSheet).not.toMatch(/\.treeScope|\.viewButton|\.dataTreeCard|\.dataTreeToggle|\.filterInput/);

        });

        it('draws a tree header as a tall clickable row tile with its actions at the end', () => {

            const styleSheet = styleSheetOf(RecipeCockpitService.buildWebviewShellHtml('testNonce'));
            const treeHeaderRule = ruleFor(styleSheet, '\\.treeHeader');

            expect(treeHeaderRule).toContain('min-height: 4rem;');
            expect(treeHeaderRule).toContain('cursor: pointer;');
            expect(treeHeaderRule).toContain('align-items: center;');
            expect(ruleFor(styleSheet, '\\.treeHeaderActions')).toContain('margin-left: auto;');

        });

        // #244 MADE THE ▸/▾ BIG ENOUGH TO READ AT A GLANCE; #277 GAVE THE PICKLIST'S THE SAME SIZE AND CENTRED ALL THREE
        it('draws the tree card, Treecipe object and picklist toggles as one centred 2.6rem box, and the field rows centred on it', () => {

            const styleSheet = styleSheetOf(RecipeCockpitService.buildWebviewShellHtml('testNonce'));
            const toggleBoxRule = ruleFor(styleSheet, '\\.treeToggle, \\.treeObjectToggle, \\.picklistToggle, \\.picklistToggleSpacer');
            const toggleCentringRule = ruleFor(styleSheet, '\\.treeToggle, \\.treeObjectToggle, \\.picklistToggle');

            expect(toggleBoxRule).toContain('width: 2.6rem;');
            expect(toggleBoxRule).toContain('height: 2.6rem;');
            expect(toggleCentringRule).toContain('display: inline-flex;');
            expect(toggleCentringRule).toContain('align-items: center;');
            expect(toggleCentringRule).toContain('justify-content: center;');
            expect(toggleCentringRule).toContain('padding: 0;');
            expect(ruleFor(styleSheet, '\\.toggleGlyph path')).toContain('fill: var(--sdt-accent);');
            // THE FONT TRIANGLE AT 3.3em IS GONE: IT SAT ON THE BASELINE, OFF CENTRE IN ITS BUTTON
            expect(styleSheet).not.toMatch(/font-size: 3\.3em;/);
            expect(ruleFor(styleSheet, '\\.treeObjectHeader, \\.treeFieldHeader')).toContain('align-items: center;');
            expect(ruleFor(styleSheet, '\\.treeObjectHeader')).toContain('align-items: center;');
            expect(ruleFor(styleSheet, '\\.treeHeader')).toContain('align-items: center;');

        });

        // A DISABLED BUTTON USED TO BE THE SAME BUTTON AT 60% OPACITY, WHICH READ AS NEARLY ENABLED WHILE FAKER RAN
        it('draws every disabled cockpit button in the disabled tokens with a not-allowed cursor', () => {

            const styleSheet = styleSheetOf(RecipeCockpitService.buildWebviewShellHtml('testNonce'));
            const disabledRule = styleSheet.match(/\n\s*([^{}\n]*\.treeRunFaker:disabled[^{}\n]*) \{([^}]*)\}/);

            expect(disabledRule).not.toBeNull();
            const disabledSelectors = (disabledRule as RegExpMatchArray)[1].split(',').map(selector => selector.trim());
            ['.treeRunFaker:disabled', '.treeAddFriend:disabled', '.treeAddFriendChoice:disabled', '.toolbar button:disabled',
                '.emptyStateActions button:disabled', '.treeInsert:disabled', '.dataOrgRefresh:disabled',
                '.dataOrgLoad:disabled', '.dataOrgNewScratch:disabled', '.treeRecordCountInput:disabled'].forEach(selector => expect(disabledSelectors).toContain(selector));
            expect((disabledRule as RegExpMatchArray)[2]).toContain('color: var(--sdt-disabled-text);');
            expect((disabledRule as RegExpMatchArray)[2]).toContain('background-color: var(--sdt-disabled-bg);');
            expect((disabledRule as RegExpMatchArray)[2]).toContain('cursor: not-allowed;');
            expect((disabledRule as RegExpMatchArray)[2]).toContain('opacity: 1;');
            expect(styleSheet).not.toMatch(/:disabled \{ opacity: 0\.6/);
            // THE SELECTED TAB KEEPS ITS ACCENT UNDERLINE UNDER THE POINTER
            expect(styleSheet).toContain('.treeTab:hover:not(:disabled):not(.selected) {');

        });

        // THE CHIP ALSO CARRIES .muted, SO ITS COLOUR MUST NOT DEPEND ON WHICH OF THE TWO RULES COMES LAST
        it('draws a field type as a chip whose rule outranks .muted', () => {

            const styleSheet = styleSheetOf(RecipeCockpitService.buildWebviewShellHtml('testNonce'));

            expect(styleSheet).toMatch(/\.treeFieldHeader \.fieldType \{[^}]*color: var\(--sdt-chip-text\);[^}]*background-color: var\(--sdt-chip-bg\);/);

        });

        it(`holds every text/background pair the stylesheet draws to at least ${MINIMUM_TEXT_CONTRAST_RATIO}:1`, () => {

            expect(TEXT_ON_BACKGROUND_PAIRS).toHaveLength(27);
            expect(findContrastFailures(RECIPE_COCKPIT_PALETTE)).toEqual([]);

        });

        /*
            #219: the tree icon is drawn in --sdt-accent (included) or --sdt-muted (excluded) on the
            row's surface or its hover; a graphic needs 3:1 (WCAG 1.4.11), and these hold text's 4.5.
            An excluded row's overlay is composited over both backgrounds, and its names in
            --sdt-text must still read at 4.5:1 through it.
        */
        describe('the excluded-object overlay and the tree icon (#219)', () => {

            const parseRgba = (rgbaColour: string): [number, number, number, number] => {
                const [red, green, blue, alpha] = (rgbaColour.match(/^rgba\((\d+), (\d+), (\d+), (0?\.\d+|1|0)\)$/) ?? []).slice(1).map(Number);
                return [red, green, blue, alpha];
            };

            const compositeOver = (overlayColour: string, backgroundHexColour: string): string => {
                const [red, green, blue, alpha] = parseRgba(overlayColour);
                const background = [1, 3, 5].map(offset => parseInt(backgroundHexColour.substring(offset, offset + 2), 16));
                return '#' + [red, green, blue]
                    .map((channel, index) => Math.round(channel * alpha + background[index] * (1 - alpha)).toString(16).padStart(2, '0'))
                    .join('');
            };

            it('is slate gray at 40%, an rgba the parser reads', () => {

                expect(RECIPE_COCKPIT_PALETTE.excludedOverlay).toBe('rgba(148, 163, 184, 0.40)');
                expect(parseRgba(RECIPE_COCKPIT_PALETTE.excludedOverlay)).toEqual([148, 163, 184, 0.4]);

            });

            it.each(['surface', 'rowHover'] as RecipeCockpitPaletteToken[])('keeps --sdt-text at 4.5:1 or more under the overlay on --sdt-%s', (backgroundToken) => {

                const overlaidBackground = compositeOver(RECIPE_COCKPIT_PALETTE.excludedOverlay, RECIPE_COCKPIT_PALETTE[backgroundToken]);

                expect(contrastRatioOf(RECIPE_COCKPIT_PALETTE.text, overlaidBackground)).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST_RATIO);

            });

            // MEASURED, NOT ESTIMATED: THE ISSUE'S 5.01:1 WAS A LOWER BOUND; THIS PALETTE GIVES 10.44:1 AND 9.85:1
            it('measures --sdt-text at 10.44:1 on the overlaid surface and 9.85:1 on the overlaid hover', () => {

                expect(compositeOver(RECIPE_COCKPIT_PALETTE.excludedOverlay, RECIPE_COCKPIT_PALETTE.surface)).toBe('#d4dae3');
                expect(contrastRatioOf(RECIPE_COCKPIT_PALETTE.text, compositeOver(RECIPE_COCKPIT_PALETTE.excludedOverlay, RECIPE_COCKPIT_PALETTE.surface)).toFixed(2)).toBe('10.44');
                expect(contrastRatioOf(RECIPE_COCKPIT_PALETTE.text, compositeOver(RECIPE_COCKPIT_PALETTE.excludedOverlay, RECIPE_COCKPIT_PALETTE.rowHover)).toFixed(2)).toBe('9.85');

            });

            const ICON_ON_BACKGROUND_PAIRS: [RecipeCockpitPaletteToken, RecipeCockpitPaletteToken][] = [
                ['accent', 'surface'], ['accent', 'rowHover'], ['muted', 'surface'], ['muted', 'rowHover']
            ];

            it.each(ICON_ON_BACKGROUND_PAIRS)('draws the icon in --sdt-%s on --sdt-%s at 3:1 or more', (iconToken, backgroundToken) => {

                expect(contrastRatioOf(RECIPE_COCKPIT_PALETTE[iconToken], RECIPE_COCKPIT_PALETTE[backgroundToken])).toBeGreaterThanOrEqual(3);

            });

            it('colours the icon only from those two tokens, and lays the overlay with a class rather than inline style', () => {

                const shellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');
                const styleSheet = styleSheetOf(shellHtml);

                expect(styleSheet).toContain('.treeGlyph path { fill: none; stroke: var(--sdt-accent);');
                expect(styleSheet).toContain('.treeGlyph.excluded path, .treeGlyph.autoExcluded path { stroke: var(--sdt-muted); }');
                expect(styleSheet).toMatch(/\.treeGlyph\.autoExcluded path \{ stroke-dasharray: [^;]+; \}/);
                expect(styleSheet).toMatch(/\.treeObject\.excluded::after \{[^}]*background-color: var\(--sdt-excluded-overlay\);[^}]*pointer-events: none;[^}]*z-index: 1;/);
                // THE ICON SITS ABOVE THE OVERLAY, SO IT STAYS CRISP AND CLICKABLE
                expect(styleSheet).toMatch(/\.treeObjectInclude \{[^}]*position: relative;[^}]*z-index: 2;/);
                expect(shellHtml).not.toMatch(/\.style\.|setAttribute\('style'/);
                expect(findThemeColourReads(shellHtml)).toEqual([]);

            });

        });

        it('names the pair that drops below the minimum when a palette value is changed', () => {

            const paletteWithTheOldMuted = { ...RECIPE_COCKPIT_PALETTE, muted: '#6B7280' };

            expect(findContrastFailures(paletteWithTheOldMuted)).toEqual([
                'muted on page (4.47:1)',
                'muted on header (4.34:1)',
                'muted on rowHover (4.43:1)'
            ]);

        });

    });

    describe('findGeneratedRecipeRuns', () => {

        /*
            A faker-js run is prefixed "recipe-fakerjs-" and a snowfakery run "recipe-", so sorting
            the folder names would rank the older faker-js run first. The fixture is shaped to
            catch exactly that: the newer run is the snowfakery one.
        */
        it('lists every run carrying an objects wrapper, newest first by its timestamp rather than its name', () => {

            const actualRuns = RecipeCockpitService.findGeneratedRecipeRuns(MOCK_GENERATED_RECIPES_PATH);

            expect(actualRuns.map(run => run.runFolderName)).toEqual([LATEST_RUN_FOLDER_NAME, FAKER_JS_RUN_FOLDER_NAME]);
            expect(actualRuns[0].generatedAtTimestamp).toBe('2026-09-04T11:22:07Z');
            expect(actualRuns[0].objectsWrapperFilePath).toBe(
                path.join(MOCK_GENERATED_RECIPES_PATH, LATEST_RUN_FOLDER_NAME, 'treecipeObjectsWrapper-2026-09-04T11-22-07.json')
            );

        });

        // THE 2026-09-10 FOLDER IS THE NEWEST ON DISK AND HAS NO WRAPPER; "notARun" HAS NO TIMESTAMP
        it('skips a folder with no objects wrapper and a folder that is not a run', () => {

            const actualRunFolderNames = RecipeCockpitService.findGeneratedRecipeRuns(MOCK_GENERATED_RECIPES_PATH).map(run => run.runFolderName);

            expect(actualRunFolderNames).not.toContain('recipe-2026-09-10T00-00-00');
            expect(actualRunFolderNames).not.toContain('notARun');

        });

        it('given no GeneratedRecipes folder, lists no runs', () => {

            expect(RecipeCockpitService.findGeneratedRecipeRuns(path.join(MOCK_WORKSPACE_ROOT, 'doesNotExist'))).toEqual([]);

        });

    });

    describe('buildRunLabel', () => {

        it('names when the run was generated, in UTC, and which faker backend wrote it', () => {

            const [latestRun, fakerJsRun] = RecipeCockpitService.findGeneratedRecipeRuns(MOCK_GENERATED_RECIPES_PATH);

            expect(RecipeCockpitService.buildRunLabel(latestRun, true)).toBe('2026-09-04 11:22:07 UTC · snowfakery · latest');
            expect(RecipeCockpitService.buildRunLabel(fakerJsRun, false)).toBe('2026-09-01 08:00:00 UTC · faker-js');

        });

    });

    describe('buildRecipeViewModel', () => {

        it('given a generated run exists, loads the latest one and lists its objects in recipe order', () => {

            const actualRecipe = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT);

            expect(actualRecipe.selectedRunFolderName).toBe(LATEST_RUN_FOLDER_NAME);
            expect(actualRecipe.runs.map(run => run.runFolderName)).toEqual([LATEST_RUN_FOLDER_NAME, FAKER_JS_RUN_FOLDER_NAME]);
            /*
                User is a key the wrapper holds for a lookup, and RelationshipService lists it in the
                tree's RecipeFiles objects -- the fixture is that shape -- but no recipe was written
                for it, so it is not a recipe object.
            */
            expect(actualRecipe.objects.map(objectViewModel => objectViewModel.objectApiName)).toEqual(['Account', 'Contact']);
            expect(actualRecipe.emptyStateMessage).toBe('');

        });

        it('gives each object the recipe file and line it is written at', () => {

            const [accountObject, contactObject] = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT).objects;

            expect(accountObject.recipeFilePath).toBe(LATEST_RECIPE_FILE_PATH);
            expect(accountObject.lineNumber).toBe(7);
            expect(contactObject.lineNumber).toBe(24);

        });

        /*
            Name is a standard-field mapping written straight into the recipe, so it never becomes a
            FieldInfo in the wrapper. Legacy_Code__c is in the wrapper but not in the file.
        */
        it('orders fields as the file does, adds the ones only the file carries, and keeps the unlocated ones last', () => {

            const [accountObject] = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT).objects;

            expect(accountObject.fields.map(field => [field.fieldApiName, field.lineNumber])).toEqual([
                ['Name', 11],
                ['Industry', 12],
                ['Industry_Group__c', 13],
                ['Number_of_Contacts__c', 18],
                ['Legacy_Code__c', undefined]
            ]);

            const nameField = accountObject.fields[0];
            expect(nameField.isOnlyInRecipeFile).toBe(true);
            expect(nameField.recipeValue).toBe('${{fake.Company}}');
            expect(nameField.fieldType).toBe('');

        });

        it('carries each wrapper field\'s type, label, controlling field and faker expression', () => {

            const [accountObject] = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT).objects;
            const industryGroupField = accountObject.fields.find(field => field.fieldApiName === 'Industry_Group__c');
            const numberOfContactsField = accountObject.fields.find(field => field.fieldApiName === 'Number_of_Contacts__c');

            expect(industryGroupField).toEqual({
                fieldApiName: 'Industry_Group__c',
                fieldLabel: 'Industry Group',
                fieldType: 'Picklist',
                fieldTypeWithSize: 'Picklist',
                recipeValue: "if:\n    - choice:\n        when: ${{ Industry == 'Agriculture' }}\n        pick: Ag Co-op",
                controllingField: 'Industry',
                isOnlyInRecipeFile: false,
                lineNumber: 13,
                isPicklist: true
            });
            // THE BLOCK SCALAR INDICATOR AND ITS FILE INDENTATION ARE NOT PART OF THE EXPRESSION
            expect(numberOfContactsField.recipeValue).toBe('${{ random_number(min=0, max=999999) }}');

        });

        it('counts a wrapper field entry with no api name in a notice rather than rendering it', () => {

            const actualRecipe = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT);
            const contactObject = actualRecipe.objects[1];

            expect(contactObject.fields.map(field => field.fieldApiName)).toEqual(['LastName', 'AccountId']);
            expect(actualRecipe.notices).toEqual(['1 field entry in the objects wrapper had no field api name and is not shown.']);

        });

        it('given a run is requested, loads that run instead of the latest', () => {

            const actualRecipe = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT, FAKER_JS_RUN_FOLDER_NAME);

            expect(actualRecipe.selectedRunFolderName).toBe(FAKER_JS_RUN_FOLDER_NAME);
            expect(actualRecipe.objects.map(objectViewModel => objectViewModel.objectApiName)).toEqual(['Lead']);
            expect(actualRecipe.objects[0].fields[0]).toMatchObject({ fieldApiName: 'Company', lineNumber: 11 });

        });

        // A RUN DELETED BETWEEN THE RENDER AND THE CHOICE IS NOT A REASON TO SHOW NOTHING
        it('given a requested run is no longer on disk, loads the latest', () => {

            const actualRecipe = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT, 'recipe-1999-01-01T00-00-00');

            expect(actualRecipe.selectedRunFolderName).toBe(LATEST_RUN_FOLDER_NAME);
            expect(actualRecipe.notices[0]).toBe('The run "recipe-1999-01-01T00-00-00" is no longer on disk, so the latest run is shown instead.');

        });

        it('given no generated run exists, answers with the empty state that names Generate Treecipe', () => {

            const actualRecipe = RecipeCockpitService.buildRecipeViewModel(path.join(MOCK_WORKSPACE_ROOT, 'doesNotExist'));

            expect(actualRecipe).toEqual({ runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: RECIPE_COCKPIT_NO_RUN_MESSAGE });
            expect(RECIPE_COCKPIT_NO_RUN_MESSAGE).toContain('Generate Treecipe');

        });

        describe('given a run whose files are damaged', () => {

            let temporaryWorkspaceRoot: string;
            let runFolderPath: string;

            beforeEach(() => {
                temporaryWorkspaceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'recipeCockpit-')));
                runFolderPath = path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes', 'recipe-2026-01-01T00-00-00');
                fs.mkdirSync(runFolderPath, { recursive: true });
            });

            afterEach(() => {
                fs.rmSync(temporaryWorkspaceRoot, { recursive: true, force: true });
            });

            const writeObjectsWrapper = (objectsWrapperContent: string) => {
                fs.writeFileSync(path.join(runFolderPath, 'treecipeObjectsWrapper-2026-01-01T00-00-00.json'), objectsWrapperContent);
            };

            it('given a wrapper that is not json, keeps the run selector and says the wrapper could not be read', () => {

                writeObjectsWrapper('{ not json');

                const actualRecipe = RecipeCockpitService.buildRecipeViewModel(temporaryWorkspaceRoot);

                expect(actualRecipe.runs).toHaveLength(1);
                expect(actualRecipe.objects).toEqual([]);
                expect(actualRecipe.emptyStateMessage).toContain('could not be read');

            });

            it('given json that is not an objects wrapper, says so', () => {

                writeObjectsWrapper('[1, 2, 3]');

                expect(RecipeCockpitService.buildRecipeViewModel(temporaryWorkspaceRoot).emptyStateMessage).toContain('is not a Treecipe objects wrapper');

            });

            it('given a wrapper listing no objects, says so', () => {

                writeObjectsWrapper('{ "ObjectToObjectInfoMap": {} }');

                expect(RecipeCockpitService.buildRecipeViewModel(temporaryWorkspaceRoot).emptyStateMessage).toContain('lists no objects');

            });

            // A WRAPPER IS ON DISK AND A HAND EDIT CONTROLS IT, SO NO VALUE IS RENDERED WITHOUT ITS TYPE BEING CHECKED
            it('given values of the wrong type, renders them as empty rather than as whatever they were', () => {

                writeObjectsWrapper(JSON.stringify({
                    ObjectToObjectInfoMap: {
                        Account: { Fields: [{ fieldName: 'Industry', type: { nested: true }, recipeValue: 42, controllingField: ['Region'] }] }
                    }
                }));

                const [accountObject] = RecipeCockpitService.buildRecipeViewModel(temporaryWorkspaceRoot).objects;

                expect(accountObject.fields[0]).toMatchObject({ fieldApiName: 'Industry', fieldType: '', recipeValue: '', controllingField: '' });

            });

            it('given damaged RecipeFiles and object entries, reads what it can and counts every unreadable field', () => {

                writeObjectsWrapper(JSON.stringify({
                    ObjectToObjectInfoMap: {
                        Account: { Fields: [null, 'Industry', { fieldName: '' }, { fieldName: 'Industry' }] },
                        Contact: null,
                        Lead: 'not an object'
                    },
                    RecipeFiles: [null, { objects: 'Account' }, { objects: [42, 'Contact', 'Account', 'Account'] }]
                }));

                const actualRecipe = RecipeCockpitService.buildRecipeViewModel(temporaryWorkspaceRoot);

                // Contact HAS NO Fields AND NO RECIPE FILE CARRIES IT, SO IT IS A LOOKUP TARGET; Lead IS IN NEITHER LIST
                expect(actualRecipe.objects.map(objectViewModel => [objectViewModel.objectApiName, objectViewModel.fields.length])).toEqual([
                    ['Account', 1]
                ]);
                expect(actualRecipe.notices).toEqual(['3 field entries in the objects wrapper had no field api name and are not shown.']);

            });

            it('given an object with no Fields that a recipe file does carry, lists it with the fields the file has', () => {

                fs.writeFileSync(path.join(runFolderPath, 'recipe.yml'), '- object: Contact\n  fields:\n    LastName: x\n');
                writeObjectsWrapper(JSON.stringify({ ObjectToObjectInfoMap: { Contact: {} }, RecipeFiles: [{ objects: ['Contact'] }] }));

                const actualRecipe = RecipeCockpitService.buildRecipeViewModel(temporaryWorkspaceRoot);

                expect(actualRecipe.objects.map(objectViewModel => objectViewModel.objectApiName)).toEqual(['Contact']);
                expect(actualRecipe.objects[0].fields[0]).toMatchObject({ fieldApiName: 'LastName', isOnlyInRecipeFile: true });

            });

            it('given a wrapper not named for its run\'s timestamp, still reads it', () => {

                fs.writeFileSync(path.join(runFolderPath, 'treecipeObjectsWrapper-renamed.json'), JSON.stringify({
                    ObjectToObjectInfoMap: { Account: { Fields: [{ fieldName: 'Industry' }] } }
                }));

                const [actualRun] = RecipeCockpitService.findGeneratedRecipeRuns(path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes'));

                expect(path.basename(actualRun.objectsWrapperFilePath)).toBe('treecipeObjectsWrapper-renamed.json');

            });

            // A FAKER-JS AND A SNOWFAKERY RUN IN THE SAME SECOND STILL COME BACK IN ONE ORDER, EVERY TIME
            it('given two runs with the same timestamp, orders them by folder name', () => {

                const fakerJsRunFolderPath = path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes', 'recipe-fakerjs-2026-01-01T00-00-00');
                fs.mkdirSync(fakerJsRunFolderPath);
                fs.writeFileSync(path.join(fakerJsRunFolderPath, 'treecipeObjectsWrapper-2026-01-01T00-00-00.json'), '{}');
                writeObjectsWrapper('{}');

                const actualRunFolderNames = RecipeCockpitService.findGeneratedRecipeRuns(path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes'))
                    .map(run => run.runFolderName);

                expect(actualRunFolderNames).toEqual(['recipe-2026-01-01T00-00-00', 'recipe-fakerjs-2026-01-01T00-00-00']);

            });

            it('given a recipe file written directly in the run folder, locates its objects too', () => {

                fs.writeFileSync(path.join(runFolderPath, 'recipe.yml'), '- object: Account\n  fields:\n    Industry: x\n');
                writeObjectsWrapper(JSON.stringify({ ObjectToObjectInfoMap: { Account: { Fields: [{ fieldName: 'Industry' }] } } }));

                const [accountObject] = RecipeCockpitService.buildRecipeViewModel(temporaryWorkspaceRoot).objects;

                expect(accountObject.recipeFilePath).toBe(path.join(runFolderPath, 'recipe.yml'));
                expect(accountObject.fields[0].lineNumber).toBe(3);

            });

            // ONE UNREADABLE FILE COSTS THAT FILE'S SOURCE LINKS AND A NOTICE, NOT THE PANEL
            it('given a recipe file that cannot be read, lists its objects with a notice and nothing to open', () => {

                const recipeFilePath = path.join(runFolderPath, 'recipe.yml');
                fs.writeFileSync(recipeFilePath, '- object: Account\n');
                writeObjectsWrapper(JSON.stringify({ ObjectToObjectInfoMap: { Account: { Fields: [] } } }));

                // NOT AN Error, SO THE NOTICE HAS TO SAY WHAT IT WAS WITHOUT A .message TO READ
                const nonErrorThrowable: unknown = 'EACCES';
                const readFileSync = fs.readFileSync;
                jest.spyOn(fs, 'readFileSync').mockImplementation(((filePath: fs.PathOrFileDescriptor, options?: any) => {
                    if ( filePath === recipeFilePath ) {
                        throw nonErrorThrowable;
                    }
                    return readFileSync(filePath, options);
                }) as typeof fs.readFileSync);

                const actualRecipe = RecipeCockpitService.buildRecipeViewModel(temporaryWorkspaceRoot);

                expect(actualRecipe.objects[0].recipeFilePath).toBe('');
                expect(actualRecipe.notices).toEqual([
                    'The recipe file "recipe.yml" could not be read (EACCES), so its objects and fields cannot be opened from here.',
                    RECIPE_COCKPIT_TREE_DATA_MISSING_NOTICE
                ]);

            });

            /*
                Every recipe path the model carries is something the host can be asked to open, so
                one that resolves outside the workspace is not offered: the object is listed, with
                nothing to open. The treecipe folder itself is the link here, because a symlinked
                FILE or subfolder is already skipped by the Dirent checks and would not reach the
                containment check at all.
            */
            it('given a treecipe folder that links outside the workspace, lists the objects without a file to open', () => {

                const outsideDirectoryPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'recipeCockpitOutside-')));
                const linkedWorkspaceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'recipeCockpitLinked-')));

                try {

                    const outsideRunFolderPath = path.join(outsideDirectoryPath, 'GeneratedRecipes', 'recipe-2026-01-01T00-00-00');
                    fs.mkdirSync(path.join(outsideRunFolderPath, 'Account-ONLY'), { recursive: true });
                    fs.writeFileSync(path.join(outsideRunFolderPath, 'Account-ONLY', 'recipe--Account-ONLY.yml'), '- object: Account\n  fields:\n    Industry: x\n');
                    fs.writeFileSync(
                        path.join(outsideRunFolderPath, 'treecipeObjectsWrapper-2026-01-01T00-00-00.json'),
                        JSON.stringify({ ObjectToObjectInfoMap: { Account: { Fields: [{ fieldName: 'Industry' }] } } })
                    );
                    fs.symlinkSync(outsideDirectoryPath, path.join(linkedWorkspaceRoot, 'treecipe'));

                    const actualRecipe = RecipeCockpitService.buildRecipeViewModel(linkedWorkspaceRoot);

                    expect(actualRecipe.objects.map(objectViewModel => objectViewModel.objectApiName)).toEqual(['Account']);
                    expect(actualRecipe.objects[0].recipeFilePath).toBe('');
                    expect(RecipeCockpitService.collectOpenableSourceKeys(actualRecipe)).toEqual([]);

                } finally {
                    fs.rmSync(linkedWorkspaceRoot, { recursive: true, force: true });
                    fs.rmSync(outsideDirectoryPath, { recursive: true, force: true });
                }

            });

        });

    });

    describe('parseRecipeSource', () => {

        it('locates each object header and each field line, and collects a field\'s continuation lines', () => {

            const actualEntries = RecipeCockpitService.parseRecipeSource(fs.readFileSync(LATEST_RECIPE_FILE_PATH, 'utf-8'));

            expect(Array.from(actualEntries.keys())).toEqual(['Account', 'Contact']);

            const accountEntry = actualEntries.get('Account');
            expect(accountEntry.lineNumber).toBe(7);
            expect(Array.from(accountEntry.fieldEntries.keys())).toEqual(['Name', 'Industry', 'Industry_Group__c', 'Number_of_Contacts__c']);
            expect(accountEntry.fieldEntries.get('Industry_Group__c').valueText).toBe("if:\n    - choice:\n        when: ${{ Industry == 'Agriculture' }}\n        pick: Ag Co-op");

            // nickname AND count SIT AT TWO SPACES, OUTSIDE THE FIELDS BLOCK
            expect(accountEntry.fieldEntries.has('nickname')).toBe(false);

        });

        // A COMMENT AT COLUMN ZERO BETWEEN TWO OBJECTS IS NOT PART OF THE FIELD ABOVE IT
        it('ends an object at a column-zero line that is not an object header', () => {

            const recipeContent = [
                '- object: Account',
                '  fields:',
                '    Industry: x',
                '# Level 1 - Contact',
                '    Stray: y'
            ].join('\n');

            const accountEntry = RecipeCockpitService.parseRecipeSource(recipeContent).get('Account');

            expect(Array.from(accountEntry.fieldEntries.keys())).toEqual(['Industry']);
            expect(accountEntry.fieldEntries.get('Industry').valueText).toBe('x');

        });

        // A COMMENT IS NOT YAML STRUCTURE: READING ONE AS THE END OF THE BLOCK HID EVERY FIELD WRITTEN AFTER IT
        it('ends the field above a comment at field depth or shallower, and keeps reading the fields block', () => {

            const recipeContent = [
                '- object: Account',
                '  fields:',
                '    Industry: x',
                '    ### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- Rating -- 1 line -- removed',
                '    # Rating: y',
                '  # a note of the reader\'s own',
                '    Phone: |',
                '        ${{ z }}',
                '    # a trailing note',
                '        stray deeper line'
            ].join('\n');

            const accountEntry = RecipeCockpitService.parseRecipeSource(recipeContent).get('Account');

            expect(Array.from(accountEntry.fieldEntries.keys())).toEqual(['Industry', 'Phone']);
            expect(accountEntry.fieldEntries.get('Industry').valueText).toBe('x');
            expect(accountEntry.fieldEntries.get('Phone')).toEqual({ lineNumber: 7, valueText: '${{ z }}' });

        });

        it('keeps the first occurrence of an object and of a field, and reads CRLF files', () => {

            const recipeContent = [
                '- object: Account',
                '  fields:',
                '    Industry: first',
                '    Industry: second',
                '        continuation of the ignored duplicate',
                '- object: Account',
                '  fields:',
                '    Rating: ignored'
            ].join('\r\n');

            const actualEntries = RecipeCockpitService.parseRecipeSource(recipeContent);
            const accountEntry = actualEntries.get('Account');

            expect(accountEntry.lineNumber).toBe(1);
            expect(accountEntry.fieldEntries.get('Industry')).toEqual({ lineNumber: 3, valueText: 'first' });
            expect(accountEntry.fieldEntries.has('Rating')).toBe(false);

        });

    });

    describe('an object written twice, told apart by nickname (#188)', () => {

        const selfLookupRecipeText = fs.readFileSync(path.join(__dirname, 'mocks', 'recipeWriter', 'recipe-fakerjs-selfLookup--RelationshipTree_1.yml'), 'utf-8');
        const selfLookupLines = selfLookupRecipeText.split('\n');
        const recipeFilePath = path.join('run', 'Account-thru-Contact', 'recipe.yml');

        const buildField = (fieldApiName: string) => ({
            fieldApiName: fieldApiName, fieldLabel: '', fieldType: 'Text', fieldTypeWithSize: 'Text', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false
        });
        const buildObject = (objectApiName: string, fieldApiNames: string[]) => ({
            objectApiName: objectApiName, recipeFilePath: '', fields: fieldApiNames.map(buildField)
        });
        const attachSelfLookupRecipe = () => RecipeCockpitService.attachRecipeSources(
            [buildObject('Account', ['Name', 'ParentId']), buildObject('Contact', ['Name', 'AccountId'])],
            [{ filePath: recipeFilePath, objectEntries: RecipeCockpitService.parseRecipeSource(selfLookupRecipeText) }]
        );

        it('the reader keeps the first occurrence under the api name and the nested one as an iteration, with its own lines', () => {

            const objectEntries = RecipeCockpitService.parseRecipeSource(selfLookupRecipeText);
            const accountEntry = objectEntries.get('Account');

            expect(Array.from(objectEntries.keys())).toEqual(['Account', 'Contact']);
            expect(accountEntry.nickname).toBe('Account_NickName');
            expect(selfLookupLines[accountEntry.fieldEntries.get('ParentId').lineNumber - 1]).toBe('    ParentId: ### TODO -- REFERENCE ID REQUIRED -- Account');
            expect(accountEntry.iterations).toHaveLength(1);

            const [iteration] = accountEntry.iterations;
            expect([iteration.nickname, iteration.parentObjectApiName, iteration.parentNickname]).toEqual(['Account_child_NickName', 'Account', 'Account_NickName']);
            expect(selfLookupLines[iteration.lineNumber - 1]).toBe('    - object: Account');
            expect(selfLookupLines[iteration.lineNumber]).toBe('      nickname: Account_child_NickName');
            expect(selfLookupLines[iteration.fieldEntries.get('ParentId').lineNumber - 1]).toBe('        ParentId: Account_NickName');
            expect(iteration.fieldEntries.get('ParentId').valueText).toBe('Account_NickName');
            expect(objectEntries.get('Contact').iterations).toBeUndefined();

        });

        it.each([
            ['the occurrences share a nickname', (recipeText: string) => recipeText.replace('nickname: Account_child_NickName', 'nickname: Account_NickName')],
            ['the later occurrence has no nickname', (recipeText: string) => recipeText.replace('      nickname: Account_child_NickName\n', '')],
            ['the first occurrence has no nickname', (recipeText: string) => recipeText.replace('  nickname: Account_NickName\n', '')]
        ])('given %s, the reader cannot tell them apart and the first occurrence wins, as before', (_caseName, editRecipe) => {

            const accountEntry = RecipeCockpitService.parseRecipeSource(editRecipe(selfLookupRecipeText)).get('Account');

            expect(accountEntry.iterations).toBeUndefined();
            expect(selfLookupLines[accountEntry.lineNumber - 1]).toBe('- object: Account');

        });

        it('a nested occurrence whose parent has no nickname is kept, without naming one', () => {

            const recipeText = [
                '- object: Account',
                '  nickname: Account_NickName',
                '  fields:',
                '    Name: x',
                '- object: Holder__c',
                '  fields:',
                '    Name: x',
                '  friends:',
                '    - object: Account',
                '      nickname: Account_Held_NickName',
                '      fields:',
                '        Name: y'
            ].join('\n');

            const [iteration] = RecipeCockpitService.parseRecipeSource(recipeText).get('Account').iterations;

            expect(iteration).toEqual({ nickname: 'Account_Held_NickName', lineNumber: 9, parentObjectApiName: 'Holder__c', fieldEntries: new Map([['Name', { lineNumber: 12, valueText: 'y' }]]) });

        });

        it('an object written three times at the top level by hand keeps two iterations, naming no parent, in file order', () => {

            const recipeText = ['First', 'Second', 'Third'].map(label => [
                '- object: Account',
                `  nickname: Account_${label}_NickName`,
                '  fields:',
                `    Name: ${label}`
            ].join('\n')).join('\n');

            const [accountObject] = RecipeCockpitService.attachRecipeSources([buildObject('Account', ['Name'])], [{ filePath: recipeFilePath, objectEntries: RecipeCockpitService.parseRecipeSource(recipeText) }]);

            expect(accountObject.nickname).toBe('Account_First_NickName');
            expect(accountObject.iterations).toEqual([
                { nickname: 'Account_Second_NickName', lineNumber: 5, fields: [{ fieldApiName: 'Name', lineNumber: 8, recipeValue: 'Second' }] },
                { nickname: 'Account_Third_NickName', lineNumber: 9, fields: [{ fieldApiName: 'Name', lineNumber: 12, recipeValue: 'Third' }] }
            ]);

        });

        it('the object view model carries its nickname and each iteration\'s lines and values; an object written once carries neither', () => {

            const [accountObject, contactObject] = attachSelfLookupRecipe();

            // indexOf THE LINE AFTER A LINE IS THAT LINE'S 1-BASED NUMBER
            expect(accountObject.nickname).toBe('Account_NickName');
            expect(accountObject.iterations).toEqual([{
                nickname: 'Account_child_NickName',
                lineNumber: selfLookupLines.indexOf('      nickname: Account_child_NickName'),
                parentObjectApiName: 'Account',
                parentNickname: 'Account_NickName',
                fields: [
                    { fieldApiName: 'Name', lineNumber: selfLookupLines.indexOf('        ParentId: Account_NickName'), recipeValue: '${{ faker.company.name() }}' },
                    { fieldApiName: 'ParentId', lineNumber: selfLookupLines.indexOf('        ParentId: Account_NickName') + 1, recipeValue: 'Account_NickName' }
                ],
                // THE FRIENDS OF THE Account ABOVE IT THAT IT DOES NOT CARRY -- WHAT ITS "+" OFFERS (#197)
                insertableFriendObjectApiNames: ['Contact']
            }]);
            expect(contactObject).not.toHaveProperty('nickname');
            expect(contactObject).not.toHaveProperty('iterations');

        });

        it('a card lists each iteration right after its object, and counts the object\'s fields once', () => {

            const objects = attachSelfLookupRecipe();
            const parentLookupsByObjectApiName = new Map([
                ['Account', [{ fieldApiName: 'ParentId', parentObjectApiName: 'Account' }]],
                ['Contact', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]]
            ]);

            const treeBuild = RecipeCockpitService.buildRecipeTreeViewModels(
                { recipeTrees: [{ objectApiNames: ['Account', 'Contact'] }], parentLookupsByObjectApiName: parentLookupsByObjectApiName }, objects, [], 'run'
            );

            expect(treeBuild.trees[0].objects).toEqual([
                { objectApiName: 'Account', parentLookups: [{ fieldApiName: 'ParentId', parentObjectApiName: 'Account' }] },
                { objectApiName: 'Account', parentLookups: [{ fieldApiName: 'ParentId', parentObjectApiName: 'Account' }], iterationNickname: 'Account_child_NickName' },
                { objectApiName: 'Contact', parentLookups: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }] }
            ]);
            expect(treeBuild.trees[0].fieldCount).toBe(4);

            const fallbackBuild = RecipeCockpitService.buildRecipeTreeViewModels(
                { recipeTrees: [], parentLookupsByObjectApiName: new Map() }, objects, [{ filePath: recipeFilePath, objectEntries: RecipeCockpitService.parseRecipeSource(selfLookupRecipeText) }], 'run'
            );
            expect(fallbackBuild.trees[0].objects.map(treeObject => [treeObject.objectApiName, treeObject.iterationNickname])).toEqual([
                ['Account', undefined], ['Account', 'Account_child_NickName'], ['Contact', undefined]
            ]);

        });

        it('the open allow-list names every iteration line, and the router opens one', () => {

            const objects = attachSelfLookupRecipe();
            const iteration = objects[0].iterations[0];
            const recipe = { runs: [], selectedRunFolderName: '', objects: objects, trees: [], notices: [], emptyStateMessage: '' };
            const openableSourceKeys = RecipeCockpitService.collectOpenableSourceKeys(recipe);

            expect(openableSourceKeys).toEqual(expect.arrayContaining([
                RecipeCockpitService.buildOpenSourceKey(recipeFilePath, iteration.lineNumber),
                ...iteration.fields.map(iterationField => RecipeCockpitService.buildOpenSourceKey(recipeFilePath, iterationField.lineNumber))
            ]));

            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.openableSourceKeys = new Set(openableSourceKeys);
            expect(RecipeCockpitService.routePanelMessage({ command: 'openSource', filePath: recipeFilePath, lineNumber: iteration.fields[1].lineNumber }, panelState))
                .toEqual({ kind: 'openSource', filePath: recipeFilePath, lineNumber: iteration.fields[1].lineNumber });

        });

    });

    describe('buildDisplayExpression', () => {

        it.each([
            ['a single line', ['${{ x }}'], '${{ x }}'],
            ['a literal block scalar', ['|', '        ${{ x }}'], '${{ x }}'],
            ['a folded block scalar with a chomping indicator', [' >-', '   a', '', '   b'], 'a\nb'],
            ['nothing at all', [''], ''],
            // THE RELATIVE INDENTATION IS WHICH "pick" BELONGS TO WHICH "when"
            ['a nested block', ['', '        if:', '            - choice:', '                pick: a'], 'if:\n    - choice:\n        pick: a'],
            ['a value longer than the engine\'s argument limit', ['|', ...Array.from({ length: 200000 }, () => '    x')], Array.from({ length: 200000 }, () => 'x').join('\n')],
            ['a leading value with continuation lines', [' ### TODO: pick one', '                    Account.Retail', '                    Account.Bank'], '### TODO: pick one\nAccount.Retail\nAccount.Bank']
        ])('given %s, keeps only the structure a reader needs', (unusedDescription, expressionLines, expectedExpression) => {

            expect(RecipeCockpitService.buildDisplayExpression(expressionLines)).toBe(expectedExpression);

        });

    });

    describe('collectOpenableSourceKeys', () => {

        it('names every object and field line the model offers to open, and nothing it does not', () => {

            const recipe = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT);

            const actualKeys = RecipeCockpitService.collectOpenableSourceKeys(recipe);

            expect(actualKeys).toContain(RecipeCockpitService.buildOpenSourceKey(LATEST_RECIPE_FILE_PATH, 7));
            expect(actualKeys).toContain(RecipeCockpitService.buildOpenSourceKey(LATEST_RECIPE_FILE_PATH, 11));
            // Account (1 + 4 LOCATED FIELDS) AND Contact (1 + 2) -- Legacy_Code__c HAS NO LINE
            expect(actualKeys).toHaveLength(8);

        });

    });

    describe('routePanelMessage', () => {

        let panelState: IRecipeCockpitPanelState;

        beforeEach(() => {
            panelState = RecipeCockpitService.buildInitialPanelState(MOCK_WORKSPACE_ROOT);
        });

        const withRenderedRecipe = () => {
            panelState.recipeDataMessage = { command: 'recipeData', recipe: buildRecipeViewModel(), renderSequence: 7 };
            panelState.openableSourceKeys = new Set([RecipeCockpitService.buildOpenSourceKey('/workspace/recipe.yml', 12)]);
            panelState.selectableRunFolderNames = new Set([LATEST_RUN_FOLDER_NAME]);
        };

        describe('ready', () => {

            it('given nothing loaded yet, replays the phase the load is in', () => {

                panelState.loadPhaseMessage = RECIPE_COCKPIT_LOAD_PHASES.findingRuns;

                expect(RecipeCockpitService.routePanelMessage({ command: 'ready' }, panelState)).toEqual({
                    kind: 'replay',
                    hostMessages: [{ command: 'loadPhase', message: RECIPE_COCKPIT_LOAD_PHASES.findingRuns }]
                });

            });

            it('given a rendered model, replays the model', () => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage({ command: 'ready' }, panelState)).toEqual({
                    kind: 'replay',
                    hostMessages: [panelState.recipeDataMessage]
                });

            });

            // THE STRUCTURE STAYS WORTH SHOWING, AND THE READER STILL HAS TO BE TOLD THE LOAD BEHIND IT DIED
            it('given a model and then a failed load, replays both, the failure last', () => {

                withRenderedRecipe();
                panelState.loadFailedMessage = { command: 'loadFailed', message: 'it broke' };

                expect(RecipeCockpitService.routePanelMessage({ command: 'ready' }, panelState)).toEqual({
                    kind: 'replay',
                    hostMessages: [panelState.recipeDataMessage, panelState.loadFailedMessage]
                });

            });

        });

        describe('rendered', () => {

            it('given the model that was sent, activates the actions it offers', () => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage({ command: 'rendered', renderSequence: 7 }, panelState)).toEqual({ kind: 'activateActions' });

            });

            /*
                A replayed model's ack can land after a newer load has posted. Promoting the newer
                model's targets on it would honour rows that are not on screen yet, and refuse the
                ones that are.
            */
            it.each([
                ['an earlier model', 6],
                ['no model at all', undefined]
            ])('given the acknowledgement of %s, activates nothing', (unusedDescription, renderSequence) => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage({ command: 'rendered', renderSequence }, panelState)).toBeUndefined();

            });

            it('given no model was ever sent, is ignored', () => {

                expect(RecipeCockpitService.routePanelMessage({ command: 'rendered' }, panelState)).toBeUndefined();

            });

        });

        describe('renderFailed', () => {

            it('given a failure to draw, reports it and invalidates the panel', () => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage(
                    { command: 'renderFailed', phase: 'render', message: 'boom', stack: 'at renderPanel' },
                    panelState
                )).toEqual({ kind: 'reportRenderFailure', failureDescription: 'boom', failureStack: 'at renderPanel', invalidatesPanel: true });

            });

            // A HANDLER THAT THREW ON A KEYSTROKE LEAVES THE ROWS ON SCREEN AND READABLE
            it('given a runtime throw after a successful draw, reports it without invalidating the panel', () => {

                withRenderedRecipe();

                const actualAction = RecipeCockpitService.routePanelMessage({ command: 'renderFailed', phase: 'runtime', message: 'boom' }, panelState);

                expect(actualAction).toMatchObject({ kind: 'reportRenderFailure', invalidatesPanel: false, failureStack: '' });

            });

            it('given a failure with no description, reports it as an unknown error', () => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage({ command: 'renderFailed', message: { not: 'a string' } }, panelState))
                    .toMatchObject({ kind: 'reportRenderFailure', failureDescription: 'unknown error' });

            });

            it('given a failure already reported, is not reported again', () => {

                withRenderedRecipe();
                panelState.reportedFailureDescriptions.add('boom');

                expect(RecipeCockpitService.routePanelMessage({ command: 'renderFailed', message: 'boom' }, panelState)).toBeUndefined();

            });

            it('given no model was ever sent, is ignored', () => {

                expect(RecipeCockpitService.routePanelMessage({ command: 'renderFailed', message: 'boom' }, panelState)).toBeUndefined();

            });

        });

        describe('openSource', () => {

            it('given a file and line the rendered model named, opens it', () => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage(
                    { command: 'openSource', filePath: '/workspace/recipe.yml', lineNumber: 12 },
                    panelState
                )).toEqual({ kind: 'openSource', filePath: '/workspace/recipe.yml', lineNumber: 12 });

            });

            /*
                The allow-list is MATCHED, never used to validate a path. A file the model named at a
                line it did not, a file it never named, and a value of the wrong type are all refused
                the same way.
            */
            it.each([
                ['a line the model did not name', { filePath: '/workspace/recipe.yml', lineNumber: 13 }],
                ['a file the model did not name', { filePath: '/etc/passwd', lineNumber: 12 }],
                ['a line number posted as a string', { filePath: '/workspace/recipe.yml', lineNumber: '12' }],
                ['a fractional line number', { filePath: '/workspace/recipe.yml', lineNumber: 12.5 }],
                ['a file path that is not a string', { filePath: ['/workspace/recipe.yml'], lineNumber: 12 }]
            ])('given %s, opens nothing', (unusedDescription, openSourcePayload) => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage({ command: 'openSource', ...openSourcePayload }, panelState)).toBeUndefined();

            });

            it('given the panel has not confirmed drawing anything, opens nothing', () => {

                panelState.pendingOpenableSourceKeys = new Set([RecipeCockpitService.buildOpenSourceKey('/workspace/recipe.yml', 12)]);

                expect(RecipeCockpitService.routePanelMessage(
                    { command: 'openSource', filePath: '/workspace/recipe.yml', lineNumber: 12 },
                    panelState
                )).toBeUndefined();

            });

        });

        describe('selectRun', () => {

            it('given a run the rendered selector offered, loads it', () => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage({ command: 'selectRun', runFolderName: LATEST_RUN_FOLDER_NAME }, panelState))
                    .toEqual({ kind: 'selectRun', runFolderName: LATEST_RUN_FOLDER_NAME });

            });

            it.each([
                ['a run the selector did not offer', '../../elsewhere'],
                ['a run name that is not a string', 42]
            ])('given %s, loads nothing', (unusedDescription, runFolderName) => {

                withRenderedRecipe();

                expect(RecipeCockpitService.routePanelMessage({ command: 'selectRun', runFolderName }, panelState)).toBeUndefined();

            });

        });

        it.each([
            ['an unrecognized command', { command: 'traverseRecipe' }],
            ['a message with no command at all', {}],
            ['nothing at all', undefined]
        ])('given %s, answers with nothing', (unusedDescription, panelMessage) => {

            expect(RecipeCockpitService.routePanelMessage(panelMessage, panelState)).toBeUndefined();

        });

    });

    describe('formatFieldTypeWithSize', () => {

        it.each([
            ['Text', { length: 50 }, 'Text(50)'],
            ['Number', { precision: 16, scale: 2 }, 'Number(16,2)'],
            ['Currency', { precision: 18, scale: 2 }, 'Currency(18,2)'],
            ['Percent', { precision: 5, scale: 2 }, 'Percent(5,2)'],
            ['Number', { precision: 18 }, 'Number(18,0)'],
            ['Number', { precision: 18, scale: 0 }, 'Number(18,0)'],
            ['Checkbox', {}, 'Checkbox'],
            ['LongTextArea', { length: 32768 }, 'LongTextArea(32768)'],
            ['', { length: 50 }, '']
        ])('formats %s with %j as %s', (fieldType, fieldSize, expectedTypeWithSize) => {

            expect(RecipeCockpitService.formatFieldTypeWithSize(fieldType, fieldSize)).toBe(expectedTypeWithSize);

        });

    });

    describe('relationship trees', () => {

        const loadTreeRun = (runFolderName = TREE_RUN_FOLDER_NAME) => RecipeCockpitService.buildRecipeViewModel(TREE_WORKSPACE_ROOT, runFolderName);

        it('builds one card per RecipeFiles entry, in RecipeFiles order, keyed and subtitled by the folder the tree was written to', () => {

            const treeRecipe = loadTreeRun();

            expect(treeRecipe.trees.map(tree => [tree.treeKey, tree.title, tree.folderName])).toEqual([
                ['Account-thru-OtherChildObject__c', 'Relationship Tree 1', 'Account-thru-OtherChildObject__c'],
                ['Lead-ONLY', 'Relationship Tree 2', 'Lead-ONLY']
            ]);
            expect(treeRecipe.notices).toEqual([]);

        });

        it('lists a tree\'s objects in insert order, leaving out a lookup target with no recipe of its own', () => {

            const [firstTree, secondTree] = loadTreeRun().trees;

            expect(firstTree.objects.map(treeObject => treeObject.objectApiName)).toEqual(['Account', 'Contact', 'OtherChildObject__c']);
            expect(secondTree.objects.map(treeObject => treeObject.objectApiName)).toEqual(['Lead']);
            expect(firstTree.fieldCount).toBe(13);
            expect(secondTree.fieldCount).toBe(2);

        });

        it('carries each object\'s lookups to a parent in the same tree, a self-lookup included', () => {

            const [firstTree, secondTree] = loadTreeRun().trees;
            const parentLookupsOf = (objectApiName: string) => firstTree.objects.find(treeObject => treeObject.objectApiName === objectApiName).parentLookups;

            expect(parentLookupsOf('Account')).toEqual([
                { fieldApiName: 'ParentId', parentObjectApiName: 'Account' },
                { fieldApiName: 'OwnerId', parentObjectApiName: 'User' }
            ]);
            expect(parentLookupsOf('Contact')).toEqual([{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]);
            expect(parentLookupsOf('OtherChildObject__c')).toEqual([{ fieldApiName: 'Contact__c', parentObjectApiName: 'Contact' }]);
            expect(secondTree.objects[0].parentLookups).toEqual([]);

        });

        it('carries each field\'s type with its size, and the bare type where the wrapper records none', () => {

            const treeRecipe = loadTreeRun();
            const typeOf = (objectApiName: string, fieldApiName: string) => treeRecipe.objects
                .find(objectViewModel => objectViewModel.objectApiName === objectApiName).fields
                .find(fieldViewModel => fieldViewModel.fieldApiName === fieldApiName);

            expect(typeOf('Account', 'Legacy_Code__c').fieldTypeWithSize).toBe('Text(50)');
            expect(typeOf('Account', 'Annual_Budget__c').fieldTypeWithSize).toBe('Currency(18,2)');
            expect(typeOf('OtherChildObject__c', 'Score__c').fieldTypeWithSize).toBe('Number(18,0)');
            expect(typeOf('OtherChildObject__c', 'Ratio__c').fieldTypeWithSize).toBe('Percent(5,2)');
            expect(typeOf('Account', 'OwnerId').fieldTypeWithSize).toBe('Lookup');
            // THE CLASSIC LIST AND THE DIFF STILL READ THE BARE TYPE
            expect(typeOf('Account', 'Legacy_Code__c').fieldType).toBe('Text');

        });

        it('keeps a picklist\'s active values beside the model, grouped per record type, and marks only picklist rows', () => {

            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            const loadedRecipe = RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME);
            const [accountObject] = loadedRecipe.recipeViewModel.objects;
            const fieldOf = (fieldApiName: string) => accountObject.fields.find(fieldViewModel => fieldViewModel.fieldApiName === fieldApiName);
            const displayValuesOf = (fieldApiName: string) => loadedRecipe.picklistDisplayValuesByObjectApiName.get('Account')?.get(fieldApiName);

            expect(displayValuesOf('Rating__c')).toEqual({
                picklistValues: ['Hot', 'Warm', 'Cold'],
                recordTypePicklistValues: [
                    { recordTypeDeveloperName: 'Business', picklistValues: ['Hot', 'Warm'] },
                    { recordTypeDeveloperName: 'Partner', picklistValues: ['Cold'] }
                ]
            });
            expect(displayValuesOf('Regions__c')).toEqual({ picklistValues: [], recordTypePicklistValues: [] });
            expect(fieldOf('Sub_Rating__c').controllingField).toBe('Rating__c');
            expect(['Rating__c', 'Sub_Rating__c', 'Regions__c', 'Legacy_Code__c'].map(fieldApiName => !!fieldOf(fieldApiName).isPicklist)).toEqual([true, true, true, false]);
            expect(RecipeCockpitService.collectLoadablePicklistKeys(loadedRecipe.recipeViewModel)).toEqual([
                'Account\nRating__c', 'Account\nSub_Rating__c', 'Account\nRegions__c', 'Lead\nStatus'
            ]);

        });

        describe('loadPicklistValues, routed', () => {

            const buildPicklistPanelState = (): IRecipeCockpitPanelState => {
                const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
                const loadedRecipe = RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME);
                const panelState = RecipeCockpitService.buildInitialPanelState(TREE_WORKSPACE_ROOT);
                panelState.recipeDataMessage = { command: 'recipeData', recipe: loadedRecipe.recipeViewModel, renderSequence: 3 };
                panelState.picklistDisplayValuesByObjectApiName = loadedRecipe.picklistDisplayValuesByObjectApiName;
                panelState.pendingLoadablePicklistKeys = new Set(RecipeCockpitService.collectLoadablePicklistKeys(loadedRecipe.recipeViewModel));
                return panelState;
            };

            const activate = (panelState: IRecipeCockpitPanelState) => {
                panelState.loadablePicklistKeys = panelState.pendingLoadablePicklistKeys;
                return panelState;
            };

            it('answers with one row\'s values, tagged with the model they belong to, once that model is confirmed drawn', () => {

                const panelState = buildPicklistPanelState();
                const loadMessage = { command: 'loadPicklistValues', objectApiName: 'Account', fieldApiName: 'Rating__c' };

                // PENDING IS NOT ENOUGH: A POSTED MODEL IS NOT A DRAWN ONE
                expect(RecipeCockpitService.routePanelMessage(loadMessage, panelState)).toBeUndefined();

                expect(RecipeCockpitService.routePanelMessage({ command: 'rendered', renderSequence: 3 }, panelState)).toEqual({ kind: 'activateActions' });
                activate(panelState);

                expect(RecipeCockpitService.routePanelMessage(loadMessage, panelState)).toEqual({
                    kind: 'postPicklistValues',
                    hostMessage: {
                        command: 'picklistValues',
                        objectApiName: 'Account',
                        fieldApiName: 'Rating__c',
                        picklistValues: ['Hot', 'Warm', 'Cold'],
                        recordTypePicklistValues: [
                            { recordTypeDeveloperName: 'Business', picklistValues: ['Hot', 'Warm'] },
                            { recordTypeDeveloperName: 'Partner', picklistValues: ['Cold'] }
                        ],
                        renderSequence: 3
                    }
                });

            });

            it.each([
                ['a row that is not a picklist', { objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }],
                ['an object the model does not name', { objectApiName: 'Opportunity', fieldApiName: 'StageName' }],
                ['a non-string object name', { objectApiName: ['Account'], fieldApiName: 'Rating__c' }],
                ['a missing field name', { objectApiName: 'Account' }],
                ['a key smuggled across the separator', { objectApiName: 'Account\nRating__c', fieldApiName: '' }]
            ])('answers nothing for %s', (unusedDescription, payload) => {

                const panelState = activate(buildPicklistPanelState());

                expect(RecipeCockpitService.routePanelMessage({ command: 'loadPicklistValues', ...payload }, panelState)).toBeUndefined();

            });

            it('answers an allow-listed row the host holds no values for with an empty list rather than nothing', () => {

                const panelState = activate(buildPicklistPanelState());
                panelState.picklistDisplayValuesByObjectApiName = new Map();

                const panelAction = RecipeCockpitService.routePanelMessage({ command: 'loadPicklistValues', objectApiName: 'Lead', fieldApiName: 'Status' }, panelState);

                expect(panelAction).toEqual({ kind: 'postPicklistValues', hostMessage: expect.objectContaining({ picklistValues: [], recordTypePicklistValues: [] }) });

            });

            it('answers nothing when no model has been posted', () => {

                const panelState = RecipeCockpitService.buildInitialPanelState(TREE_WORKSPACE_ROOT);
                panelState.loadablePicklistKeys = new Set(['Account\nRating__c']);

                expect(RecipeCockpitService.routePanelMessage({ command: 'loadPicklistValues', objectApiName: 'Account', fieldApiName: 'Rating__c' }, panelState)).toBeUndefined();

            });

        });

        it('given a run from before field sizes were recorded, draws the bare type and still builds', () => {

            const legacyRecipe = loadTreeRun(LEGACY_TREE_RUN_FOLDER_NAME);
            const legacyCodeField = legacyRecipe.objects[0].fields.find(fieldViewModel => fieldViewModel.fieldApiName === 'Legacy_Code__c');

            expect(legacyCodeField.fieldTypeWithSize).toBe('Text');

        });

        it('given a wrapper with no RecipeFiles, falls back to one card per recipe file, objects in file order, no lookups, and says why', () => {

            const legacyRecipe = loadTreeRun(LEGACY_TREE_RUN_FOLDER_NAME);

            expect(legacyRecipe.trees.map(tree => [tree.treeKey, tree.title, tree.folderName])).toEqual([
                ['Account-thru-Contact', 'Relationship Tree 1', 'Account-thru-Contact'],
                ['Lead-ONLY', 'Relationship Tree 2', 'Lead-ONLY']
            ]);
            expect(legacyRecipe.trees[0].objects).toEqual([
                { objectApiName: 'Account', parentLookups: [] },
                { objectApiName: 'Contact', parentLookups: [] }
            ]);
            expect(legacyRecipe.notices).toEqual([RECIPE_COCKPIT_TREE_DATA_MISSING_NOTICE]);

        });

        describe('buildRecipeTreeViewModels, tested pure', () => {

            const buildObject = (objectApiName: string, fieldCount = 1) => ({
                objectApiName: objectApiName,
                recipeFilePath: '',
                fields: Array.from({ length: fieldCount }, (unusedValue, fieldIndex) => ({
                    fieldApiName: `Field${fieldIndex}__c`, fieldLabel: '', fieldType: 'Text', fieldTypeWithSize: 'Text', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false
                }))
            });

            it('given an empty RecipeFiles list, falls back the same as a missing one', () => {

                const normalizedWrapper = RecipeCockpitService.normalizeObjectsWrapper({
                    ObjectToObjectInfoMap: { Lead: { Fields: [{ fieldName: 'Company' }] } },
                    RecipeFiles: []
                });
                const recipeSourceFile = { filePath: path.join('run', 'Lead-ONLY', 'recipe.yml'), objectEntries: new Map([['Lead', { lineNumber: 1, fieldEntries: new Map() }]]) };

                const treeBuild = RecipeCockpitService.buildRecipeTreeViewModels(normalizedWrapper, [buildObject('Lead')], [recipeSourceFile], 'run');

                expect(treeBuild.trees.map(tree => tree.folderName)).toEqual(['Lead-ONLY']);
                expect(treeBuild.notices).toEqual([RECIPE_COCKPIT_TREE_DATA_MISSING_NOTICE]);

            });

            it('given a nested faker-js recipe and no RecipeFiles, the card lists every object at every friends: depth in file order (#46)', () => {

                const nestedRecipeText = fs.readFileSync(path.join(__dirname, 'mocks', 'recipeWriter', 'recipe-fakerjs-nested--RelationshipTree_1.yml'), 'utf-8');
                const recipeSourceFile = { filePath: path.join('run', 'Account-thru-MasterDetailMadness__c', 'recipe.yml'), objectEntries: RecipeCockpitService.parseRecipeSource(nestedRecipeText) };
                const objectApiNamesInFileOrder = [...nestedRecipeText.matchAll(/^ *- object: (\S+)$/gm)].map(([, objectApiName]) => objectApiName);

                const treeBuild = RecipeCockpitService.buildRecipeTreeViewModels(
                    { recipeTrees: [], parentLookupsByObjectApiName: new Map() },
                    objectApiNamesInFileOrder.map(objectApiName => buildObject(objectApiName)),
                    [recipeSourceFile],
                    'run'
                );

                expect(objectApiNamesInFileOrder).toContain('MasterDetailMadness__c');
                expect(treeBuild.trees).toHaveLength(1);
                // AN OBJECT WRITTEN TWICE (Example_Everything__c's SELF-LOOKUP ITERATION, #188) IS LISTED AGAIN ONLY THROUGH ITS iterations, WHICH THESE BARE OBJECTS DO NOT CARRY
                expect(treeBuild.trees[0].objects.map(treeObject => treeObject.objectApiName)).toEqual([...new Set(objectApiNamesInFileOrder)]);

            });

            it('gives a nested object its recipe file, header line and field lines (#46)', () => {

                const nestedRecipeText = fs.readFileSync(path.join(__dirname, 'mocks', 'recipeWriter', 'recipe-fakerjs-nested--RelationshipTree_1.yml'), 'utf-8');
                const nestedLines = nestedRecipeText.split('\n');
                const recipeSourceFile = { filePath: path.join('run', 'tree', 'recipe.yml'), objectEntries: RecipeCockpitService.parseRecipeSource(nestedRecipeText) };

                const [masterDetailObject] = RecipeCockpitService.attachRecipeSources([{
                    ...buildObject('MasterDetailMadness__c'),
                    fields: [{ fieldApiName: 'LU_Contact__c', fieldLabel: '', fieldType: 'Lookup', fieldTypeWithSize: 'Lookup', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false }]
                }], [recipeSourceFile]);

                expect(masterDetailObject.recipeFilePath).toBe(recipeSourceFile.filePath);
                expect(nestedLines[masterDetailObject.lineNumber - 1]).toBe('        - object: MasterDetailMadness__c');
                expect(nestedLines[masterDetailObject.fields[0].lineNumber - 1]).toBe('            LU_Contact__c: Contact_NickName');
                expect(masterDetailObject.fields.filter(field => field.isOnlyInRecipeFile).map(field => field.fieldApiName)).toEqual(['MD_MegaMapMadness__c']);

            });

            it('given a recipe file written straight into the run folder, names its card by the file', () => {

                const recipeSourceFile = { filePath: path.join('run', 'recipe.yml'), objectEntries: new Map([['Lead', { lineNumber: 1, fieldEntries: new Map() }]]) };

                const treeBuild = RecipeCockpitService.buildRecipeTreeViewModels(
                    { recipeTrees: [], parentLookupsByObjectApiName: new Map() }, [buildObject('Lead')], [recipeSourceFile], 'run'
                );

                expect(treeBuild.trees[0].folderName).toBe('recipe.yml');

            });

            it('drops a lookup to a parent outside the tree, and gives an object no tree claimed a card of its own', () => {

                const treeBuild = RecipeCockpitService.buildRecipeTreeViewModels({
                    recipeTrees: [{ objectApiNames: ['Contact'] }],
                    parentLookupsByObjectApiName: new Map([['Contact', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]]])
                }, [buildObject('Contact', 2), buildObject('Stray__c', 3)], [], 'run');

                expect(treeBuild.trees.map(tree => [tree.treeKey, tree.title, tree.objects.map(treeObject => treeObject.objectApiName), tree.fieldCount])).toEqual([
                    ['Contact-ONLY', 'Relationship Tree 1', ['Contact'], 2],
                    ['', RECIPE_COCKPIT_UNGROUPED_TREE_TITLE, ['Stray__c'], 3]
                ]);
                expect(treeBuild.trees[0].objects[0].parentLookups).toEqual([]);

            });

            it('keeps two cards distinct when a hand-edited wrapper repeats a folder, and lists an object in its first tree only', () => {

                const treeBuild = RecipeCockpitService.buildRecipeTreeViewModels({
                    recipeTrees: [{ objectApiNames: ['Lead'] }, { objectApiNames: ['Lead'] }],
                    parentLookupsByObjectApiName: new Map()
                }, [buildObject('Lead')], [], 'run');

                expect(treeBuild.trees.map(tree => tree.treeKey)).toEqual(['Lead-ONLY', 'Lead-ONLY#2']);
                expect(treeBuild.trees.map(tree => tree.objects.length)).toEqual([1, 0]);

            });

            it('reads lookups and record type sections defensively, dropping whatever is not the expected type', () => {

                expect(RecipeCockpitService.readParentLookups({ parentObjectToFieldReferences: { Account: ['AccountId', 7, ''], User: 'OwnerId' } }))
                    .toEqual([{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]);
                expect(RecipeCockpitService.readParentLookups(undefined)).toEqual([]);

                const [recordTypeSection] = RecipeCockpitService.readRecordTypePicklistSections({
                    Business: { PicklistFieldSectionsToPicklistDetail: { Rating__c: ['Hot', 3], Broken__c: 'Hot', constructor: ['Value'] } }
                });
                expect(recordTypeSection.recordTypeDeveloperName).toBe('Business');
                expect({ ...recordTypeSection.picklistValuesByFieldApiName }).toEqual({ Rating__c: ['Hot'], constructor: ['Value'] });
                expect(RecipeCockpitService.readRecordTypePicklistSections(['not', 'a', 'map'])).toEqual([]);
                expect(RecipeCockpitService.readRecordTypePicklistSections({ Bare: { DeveloperName: 'Bare' } }).map(section => ({ ...section.picklistValuesByFieldApiName })))
                    .toEqual([{}]);

            });

        });

    });

    describe('loadRecipeRunByRuns', () => {

        it('answers the posted model and the picklist values the panel asks for one row at a time, and no diff copy of them (#266)', () => {

            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(MOCK_GENERATED_RECIPES_PATH);
            const loadedRecipe = RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, MOCK_WORKSPACE_ROOT);

            expect(loadedRecipe.recipeViewModel).toEqual(RecipeCockpitService.buildRecipeViewModelByRuns(recipeRuns, MOCK_WORKSPACE_ROOT));
            expect(loadedRecipe.picklistDisplayValuesByObjectApiName).toBeInstanceOf(Map);
            expect(loadedRecipe).not.toHaveProperty('recipePicklistValuesByObjectApiName');

        });

        it('given no run, answers no picklist values', () => {

            expect(RecipeCockpitService.loadRecipeRunByRuns([], MOCK_WORKSPACE_ROOT).picklistDisplayValuesByObjectApiName.size).toBe(0);

        });

    });

    describe('routePanelMessage, regenerateRecipe (#263)', () => {

        const COMPARED_TREE_KEY = 'Account-thru-Contact';

        const buildComparedPanelState = (): IRecipeCockpitPanelState => ({
            ...RecipeCockpitService.buildInitialPanelState(MOCK_WORKSPACE_ROOT),
            recipeDataMessage: { command: 'recipeData', recipe: buildRecipeViewModel(), renderSequence: 2 }
        });

        // THE BUTTON IS GONE, SO A POSTED regenerateRecipe IS A MESSAGE NO RENDERED CONTROL COULD HAVE SENT
        it('refuses a posted regenerateRecipe for any card, drawn or not', () => {

            const panelState = buildComparedPanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'regenerateRecipe', treeKey: COMPARED_TREE_KEY }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'regenerateRecipe', treeKey: 'Lead-ONLY' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'regenerateRecipe' }, panelState)).toBeUndefined();

        });

    });

    describe('routePanelMessage, generateTreecipe (#214)', () => {

        const buildNoRunPanelState = (): IRecipeCockpitPanelState => ({
            ...RecipeCockpitService.buildInitialPanelState(MOCK_WORKSPACE_ROOT),
            recipeDataMessage: { command: 'recipeData', recipe: RecipeCockpitService.buildRecipeViewModel(path.join(MOCK_WORKSPACE_ROOT, 'doesNotExist')), renderSequence: 3 },
            pendingIsGenerateTreecipeOffered: true,
            isGenerateTreecipeOffered: true
        });

        it('given the no-run empty state is on screen, generates, ignoring any payload', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'generateTreecipe', treeKey: 'Account-ONLY', filePath: '/etc/passwd' }, buildNoRunPanelState()))
                .toEqual({ kind: 'generateTreecipe' });

        });

        it('given the panel has not confirmed drawing the no-run model, generates nothing', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'generateTreecipe' }, { ...buildNoRunPanelState(), isGenerateTreecipeOffered: false })).toBeUndefined();

        });

        it('given a run is on screen, generates nothing', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'generateTreecipe' }, RecipeCockpitService.buildInitialPanelState(MOCK_WORKSPACE_ROOT))).toBeUndefined();

        });

        it('given a generation is already running, starts no second one', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'generateTreecipe' }, { ...buildNoRunPanelState(), isGenerateTreecipeInFlight: true })).toBeUndefined();

        });

    });

    describe('buildOrgLabel', () => {

        it('names the alias with the username it points at, or the username alone', () => {

            expect(RecipeCockpitService.buildOrgLabel({ targetOrgIdentifier: 'devhub', username: 'jd@example.com', alias: 'devhub' })).toBe('devhub (jd@example.com)');
            expect(RecipeCockpitService.buildOrgLabel({ targetOrgIdentifier: 'jd@example.com', username: 'jd@example.com' })).toBe('jd@example.com');

        });

    });

    describe('the panel script, Recipe Trees view', () => {

        const renderTreeRecipe = (runFolderName = TREE_RUN_FOLDER_NAME) => {
            const panel = runPanelScript();
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            const loadedRecipe = RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, runFolderName);
            const recipe = loadedRecipe.recipeViewModel;
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
            return { panel, recipe, loadedRecipe };
        };

        /*
            Answers the panel's last loadPicklistValues through the REAL router, with the host
            state the panel's "rendered" would have activated -- so the values the panel draws are
            exactly what the host would have posted.
        */
        const answerLastPicklistRequest = (panel: any, loadedRecipe: IRecipeCockpitLoadedRecipe, renderSequence = 1) => {
            const panelState = RecipeCockpitService.buildInitialPanelState(TREE_WORKSPACE_ROOT);
            panelState.recipeDataMessage = { command: 'recipeData', recipe: loadedRecipe.recipeViewModel, renderSequence: renderSequence };
            panelState.picklistDisplayValuesByObjectApiName = loadedRecipe.picklistDisplayValuesByObjectApiName;
            panelState.loadablePicklistKeys = new Set(RecipeCockpitService.collectLoadablePicklistKeys(loadedRecipe.recipeViewModel));
            const loadMessage = [...panel.postedHostMessages].reverse().find((hostMessage: any) => hostMessage.command === 'loadPicklistValues');
            const panelAction = RecipeCockpitService.routePanelMessage(loadMessage, panelState);
            if ( panelAction?.kind !== 'postPicklistValues' ) {
                throw new Error('the router did not answer the panel\'s loadPicklistValues');
            }
            panel.postToPanel(panelAction.hostMessage);
            return panelAction.hostMessage;
        };

        const textOf = (panel: any, rootElement: any, className: string) => panel.findAll(rootElement, className).map((element: any) => element.textContent);
        const treeCardsOf = (panel: any) => panel.findAll(panel.cockpitBodyElement, 'treeCard');
        const treeBodyOf = (treeCard: any) => treeCard.children[1];
        const viewOf = (panel: any, className: string) => panel.findAll(panel.cockpitBodyElement, className)[0];
        const clickNamed = (panel: any, rootElement: any, className: string, labelText: string) =>
            panel.findAll(rootElement, className).find((element: any) => element.textContent === labelText).dispatch('click');
        const treeObjectNamed = (panel: any, treeCard: any, objectApiName: string) => panel.findAll(treeCard, 'treeObject')
            .find((objectElement: any) => panel.findAll(objectElement, 'treeObjectName')[0].textContent === objectApiName);
        const treeFieldNamed = (panel: any, objectElement: any, fieldApiName: string) => panel.findAll(objectElement, 'treeField')
            .find((fieldElement: any) => panel.findAll(fieldElement, 'treeFieldName')[0].textContent === fieldApiName);
        const expandTree = (panel: any, treeCard: any) => panel.findAll(treeCard, 'treeToggle')[0].dispatch('click');
        const expandTreeObject = (panel: any, objectElement: any) => panel.findAll(objectElement, 'treeObjectToggle')[0].dispatch('click');

        it('draws a toolbar with no view switch, and no global find box, match count or 🔍 scope (#217)', () => {

            const { panel } = renderTreeRecipe();

            expect(panel.isHidden(viewOf(panel, 'treesView'))).toBe(false);
            // THE VIEW SWITCH, THE GLOBAL FIND BOX AND 🔍 ARE GONE, WITH EVERY NODE THEY DREW; SO IS THE CLASSIC LIST
            ['viewButton', 'dataOrgView', 'dataTreeCard', 'filterInput', 'treeMatchCount', 'treeMatch', 'treeScope', 'treeScopeStatus', 'treeScopeClear',
                'classicView', 'classicControls', 'object', 'field', 'matchCount'].forEach(className => {
                expect(panel.findAll(panel.cockpitBodyElement, className)).toEqual([]);
            });
            // THE COMPARISON'S CONTROLS ARE IN THE CARDS, NOT IN THE TOOLBAR
            expect(panel.findAll(panel.cockpitBodyElement.children[0], 'describeInOrg')).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement.children[0], 'statusFilter')).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement.children[0], 'tabSearchInput')).toEqual([]);
            // #255: THE ORG PICKER IS DRAWN IN EACH CARD'S TREECIPE TAB, NOT IN THE TOOLBAR
            ['dataOrgControls', 'dataOrgSelect', 'dataOrgLoad', 'dataOrgRefresh'].forEach(className => {
                expect(panel.findAll(panel.cockpitBodyElement.children[0], className)).toEqual([]);
            });

        });

        // A MODEL OF THE SAME RUN KEEPS THE READER'S PLACE (#225); ANOTHER RUN STARTS FRESH
        it('starts every search box empty when the next model drawn is another run', () => {

            const { panel, recipe } = renderTreeRecipe();
            panel.expandAllTrees();
            panel.typeIntoFilter('rating');

            panel.postToPanel({ command: 'recipeData', recipe: { ...recipe, selectedRunFolderName: 'recipe-2001-01-01T00-00-00' }, renderSequence: 2 });
            panel.expandAllTrees();

            expect(panel.findAll(panel.cockpitBodyElement, 'tabSearchInput').map((inputElement: any) => inputElement.value)).toEqual(['', '']);
            expect(panel.visibleFieldNamesOf(treeObjectNamed(panel, treeCardsOf(panel)[0], 'Account'))).toEqual([]);
            expect(textOf(panel, treeCardsOf(panel)[0], 'treeObjectCount')).toEqual(['8 fields', '2 fields', '3 fields']);

        });

        it('draws one collapsed card per tree, titled by position, subtitled by folder, with its object and field counts', () => {

            const { panel } = renderTreeRecipe();
            const treeCards = treeCardsOf(panel);

            expect(treeCards).toHaveLength(2);
            expect(textOf(panel, panel.cockpitBodyElement, 'treeTitle')).toEqual(['Relationship Tree 1', 'Relationship Tree 2']);
            expect(textOf(panel, panel.cockpitBodyElement, 'treeFolder')).toEqual(['Account-thru-OtherChildObject__c', 'Lead-ONLY']);
            expect(textOf(panel, panel.cockpitBodyElement, 'treeCount')).toEqual(['3 objects · 13 fields', '1 object · 2 fields']);
            expect(treeCards.every((treeCard: any) => panel.isHidden(treeBodyOf(treeCard)))).toBe(true);
            // THE BODY IS BUILT ON FIRST EXPAND, SO A COLLAPSED CARD HAS NO TAB STRIP AND NO ROWS YET
            expect(panel.findAll(panel.cockpitBodyElement, 'treeTab')).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement, 'treeField')).toEqual([]);

        });

        it('given a card is expanded, draws its tabs with Treecipe selected, and its objects in insert order with their lookups', () => {

            const { panel } = renderTreeRecipe();
            const [firstTreeCard] = treeCardsOf(panel);

            expandTree(panel, firstTreeCard);

            expect(panel.isHidden(treeBodyOf(firstTreeCard))).toBe(false);
            expect(textOf(panel, firstTreeCard, 'treeTab')).toEqual(['Treecipe', 'Previously Used Data Sets']);
            expect(panel.findAll(firstTreeCard, 'treeTab').map((tabElement: any) => tabElement.attributes['aria-selected'])).toEqual(['true', 'false']);
            // #266: THE COMPARE TAB IS GONE
            expect(RECIPE_COCKPIT_TREE_TABS).toEqual(['treecipe', 'datasets']);
            // ONLY TREECIPE IS BUILT: THE DATA SETS TAB BUILDS ITS ROWS ON ITS OWN FIRST OPEN
            expect(panel.findAll(firstTreeCard, 'treeDataset')).toEqual([]);
            expect(textOf(panel, firstTreeCard, 'treeObjectName')).toEqual(['Account', 'Contact', 'OtherChildObject__c']);
            expect(textOf(panel, firstTreeCard, 'treeLookups')).toEqual(['(ParentId, OwnerId → User)', '(AccountId → Account)', '(Contact__c → Contact)']);

        });

        it('given an object is expanded, draws each field with its sized type, its controlling field and a link to its recipe line', () => {

            const { panel, recipe } = renderTreeRecipe();
            const [firstTreeCard] = treeCardsOf(panel);

            expandTree(panel, firstTreeCard);
            const accountElement = treeObjectNamed(panel, firstTreeCard, 'Account');
            const otherChildElement = treeObjectNamed(panel, firstTreeCard, 'OtherChildObject__c');
            expandTreeObject(panel, accountElement);
            expandTreeObject(panel, otherChildElement);

            expect(textOf(panel, treeFieldNamed(panel, accountElement, 'Legacy_Code__c'), 'fieldType')).toEqual(['Text(50)']);
            expect(textOf(panel, treeFieldNamed(panel, accountElement, 'Annual_Budget__c'), 'fieldType')).toEqual(['Currency(18,2)']);
            expect(textOf(panel, treeFieldNamed(panel, otherChildElement, 'Score__c'), 'fieldType')).toEqual(['Number(18,0)']);
            expect(textOf(panel, treeFieldNamed(panel, otherChildElement, 'Ratio__c'), 'fieldType')).toEqual(['Percent(5,2)']);
            expect(textOf(panel, treeFieldNamed(panel, accountElement, 'Sub_Rating__c'), 'controllingField')).toEqual(['controlled by Rating__c']);

            const legacyCodeSource = panel.findAll(treeFieldNamed(panel, accountElement, 'Legacy_Code__c'), 'treeFieldSource')[0];
            expect(legacyCodeSource.textContent).toBe('↗ yml');

            legacyCodeSource.dispatch('click');

            const openSourceMessage = panel.postedHostMessages[panel.postedHostMessages.length - 1];
            expect(openSourceMessage).toEqual({ command: 'openSource', filePath: recipe.objects[0].recipeFilePath, lineNumber: 12 });
            // THE SAME ALLOW-LIST AS THE CLASSIC LIST: THE TREE OFFERS NOTHING THE MODEL DID NOT NAME
            expect(RecipeCockpitService.collectOpenableSourceKeys(recipe)).toContain(RecipeCockpitService.buildOpenSourceKey(openSourceMessage.filePath, openSourceMessage.lineNumber));

        });

        it('draws a self-lookup\'s nested iteration as its own object, opening its own lines, and counts the object once (#188)', () => {

            const selfLookupRecipeText = fs.readFileSync(path.join(__dirname, 'mocks', 'recipeWriter', 'recipe-fakerjs-selfLookup--RelationshipTree_1.yml'), 'utf-8');
            const selfLookupLines = selfLookupRecipeText.split('\n');
            const recipeFilePath = path.join(TREE_WORKSPACE_ROOT, 'recipe.yml');
            const buildObject = (objectApiName: string, fieldApiNames: string[]) => ({
                objectApiName: objectApiName,
                recipeFilePath: '',
                fields: fieldApiNames.map(fieldApiName => ({ fieldApiName: fieldApiName, fieldLabel: '', fieldType: 'Text', fieldTypeWithSize: 'Text', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false }))
            });
            const objects = RecipeCockpitService.attachRecipeSources(
                [buildObject('Account', ['Name', 'ParentId']), buildObject('Contact', ['Name', 'AccountId'])],
                [{ filePath: recipeFilePath, objectEntries: RecipeCockpitService.parseRecipeSource(selfLookupRecipeText) }]
            );
            const { trees } = RecipeCockpitService.buildRecipeTreeViewModels({
                recipeTrees: [{ objectApiNames: ['Account', 'Contact'] }],
                parentLookupsByObjectApiName: new Map([['Account', [{ fieldApiName: 'ParentId', parentObjectApiName: 'Account' }]]])
            }, objects, [], TREE_WORKSPACE_ROOT);

            const { panel, recipe: treeRecipe } = renderTreeRecipe();
            const recipe = { ...treeRecipe, objects: objects, trees: trees };
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 2 });

            const [treeCard] = treeCardsOf(panel);
            expect(textOf(panel, treeCard, 'treeCount')).toEqual(['2 objects · 4 fields']);

            expandTree(panel, treeCard);
            expect(textOf(panel, treeCard, 'treeObjectName')).toEqual(['Account', 'Account', 'Contact']);
            expect(textOf(panel, treeCard, 'treeIteration')).toEqual(['Account_NickName', 'Account_child_NickName · nested under Account_NickName']);

            const [, iterationElement] = panel.findAll(treeCard, 'treeObject');
            panel.findAll(iterationElement, 'treeObjectName')[0].dispatch('click');
            expect(panel.postedHostMessages[panel.postedHostMessages.length - 1]).toEqual({ command: 'openSource', filePath: recipeFilePath, lineNumber: objects[0].iterations[0].lineNumber });
            expect(selfLookupLines[objects[0].iterations[0].lineNumber]).toBe('      nickname: Account_child_NickName');

            expandTreeObject(panel, iterationElement);
            panel.findAll(treeFieldNamed(panel, iterationElement, 'ParentId'), 'treeFieldSource')[0].dispatch('click');
            const openSourceMessage = panel.postedHostMessages[panel.postedHostMessages.length - 1];
            expect(selfLookupLines[openSourceMessage.lineNumber - 1]).toBe('        ParentId: Account_NickName');
            expect(RecipeCockpitService.collectOpenableSourceKeys(recipe)).toContain(RecipeCockpitService.buildOpenSourceKey(openSourceMessage.filePath, openSourceMessage.lineNumber));

            const [accountElement] = panel.findAll(treeCard, 'treeObject');
            expandTreeObject(panel, accountElement);
            panel.findAll(treeFieldNamed(panel, accountElement, 'ParentId'), 'treeFieldSource')[0].dispatch('click');
            expect(selfLookupLines[panel.postedHostMessages[panel.postedHostMessages.length - 1].lineNumber - 1]).toBe('    ParentId: ### TODO -- REFERENCE ID REQUIRED -- Account');

        });

        it('a search for an iteration\'s nickname finds it, and an iteration naming no nickname the object holds is not drawn (#188)', () => {

            const selfLookupRecipeText = fs.readFileSync(path.join(__dirname, 'mocks', 'recipeWriter', 'recipe-fakerjs-selfLookup--RelationshipTree_1.yml'), 'utf-8');
            const recipeFilePath = path.join(TREE_WORKSPACE_ROOT, 'recipe.yml');
            const [accountObject] = RecipeCockpitService.attachRecipeSources(
                [{ objectApiName: 'Account', recipeFilePath: '', fields: [] }],
                [{ filePath: recipeFilePath, objectEntries: RecipeCockpitService.parseRecipeSource(selfLookupRecipeText) }]
            );
            accountObject.iterations[0].fields.push({ fieldApiName: 'Iteration_Only__c', lineNumber: 99, recipeValue: 'branch' });
            // A SECOND TOP-LEVEL OCCURRENCE, AS A HAND EDIT WRITES ONE, NAMES NO PARENT AND IS NOT LABELLED NESTED
            accountObject.iterations.push({ nickname: 'Account_Second_NickName', lineNumber: 1, fields: [] });

            const { panel, recipe: treeRecipe } = renderTreeRecipe();
            panel.postToPanel({ command: 'recipeData', renderSequence: 2, recipe: { ...treeRecipe, objects: [accountObject], trees: [{
                treeKey: 'tree', title: 'Relationship Tree 1', folderName: 'tree', fieldCount: 0,
                objects: [
                    { objectApiName: 'Account', parentLookups: [] },
                    { objectApiName: 'Account', parentLookups: [], iterationNickname: 'Account_child_NickName' },
                    { objectApiName: 'Account', parentLookups: [], iterationNickname: 'Account_Second_NickName' },
                    { objectApiName: 'Account', parentLookups: [], iterationNickname: 'Not_An_Iteration' }
                ]
            }] } });

            const [treeCard] = treeCardsOf(panel);
            expandTree(panel, treeCard);
            expect(textOf(panel, treeCard, 'treeObjectName')).toEqual(['Account', 'Account', 'Account']);
            expect(textOf(panel, treeCard, 'treeIteration')).toEqual(['Account_NickName', 'Account_child_NickName · nested under Account_NickName', 'Account_Second_NickName']);

            const [, iterationElement] = panel.findAll(treeCard, 'treeObject');
            expandTreeObject(panel, iterationElement);
            // A FIELD ONLY THE ITERATION WRITES IS A ROW OF ITS OWN, READ FROM THE RECIPE FILE
            expect(textOf(panel, iterationElement, 'treeFieldName')).toEqual(['Name', 'ParentId', 'Iteration_Only__c']);
            expect(textOf(panel, treeFieldNamed(panel, iterationElement, 'Iteration_Only__c'), 'recipeFileOnly')).toEqual(['read from the recipe file']);

            panel.typeIntoFilter('branch');
            expect(panel.isHidden(treeFieldNamed(panel, iterationElement, 'Iteration_Only__c'))).toBe(false);
            expect(panel.isHidden(treeFieldNamed(panel, iterationElement, 'Name'))).toBe(true);

            panel.typeIntoFilter('account_child');
            const [accountElement] = panel.findAll(treeCard, 'treeObject');
            expect(textOf(panel, iterationElement, 'treeObjectCount')).toEqual(['3 fields']);
            expect(textOf(panel, accountElement, 'treeObjectCount')).toEqual(['no matching fields']);

        });

        it('expands a picklist to its values, asked for on expand and grouped per record type, and says when a picklist has none', () => {

            const { panel, loadedRecipe } = renderTreeRecipe();
            const [firstTreeCard] = treeCardsOf(panel);

            expandTree(panel, firstTreeCard);
            const accountElement = treeObjectNamed(panel, firstTreeCard, 'Account');
            expandTreeObject(panel, accountElement);

            const ratingRow = treeFieldNamed(panel, accountElement, 'Rating__c');
            expect(panel.findAll(ratingRow, 'picklistValues')).toEqual([]);
            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'loadPicklistValues')).toEqual([]);

            panel.findAll(ratingRow, 'picklistToggle')[0].dispatch('click');

            // THE PLACE IS SAVED AFTER THE CLICK TOO, SO THE REQUEST IS THE LAST MESSAGE THAT IS NOT A savePlace
            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command !== 'savePlace').pop()).toEqual({ command: 'loadPicklistValues', objectApiName: 'Account', fieldApiName: 'Rating__c' });
            expect(textOf(panel, ratingRow, 'picklistLoading')).toEqual(['Loading values…']);

            answerLastPicklistRequest(panel, loadedRecipe);

            const ratingValuesElement = panel.findAll(ratingRow, 'picklistValues')[0];
            expect(ratingValuesElement.children.map((element: any) => element.textContent)).toEqual([
                'Hot', 'Warm', 'Cold',
                'Record type: Business', 'Hot', 'Warm',
                'Record type: Partner', 'Cold'
            ]);

            panel.findAll(ratingRow, 'picklistToggle')[0].dispatch('click');
            expect(panel.isHidden(ratingValuesElement)).toBe(true);

            // A SECOND EXPAND SHOWS WHAT WAS ALREADY ANSWERED RATHER THAN ASKING AGAIN
            const requestCount = panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'loadPicklistValues').length;
            panel.findAll(ratingRow, 'picklistToggle')[0].dispatch('click');
            expect(panel.isHidden(ratingValuesElement)).toBe(false);
            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'loadPicklistValues')).toHaveLength(requestCount);

            const regionsRow = treeFieldNamed(panel, accountElement, 'Regions__c');
            panel.findAll(regionsRow, 'picklistToggle')[0].dispatch('click');
            answerLastPicklistRequest(panel, loadedRecipe);
            expect(textOf(panel, regionsRow, 'picklistEmpty')).toEqual(['no values']);

            expect(panel.findAll(treeFieldNamed(panel, accountElement, 'Legacy_Code__c'), 'picklistToggle')).toEqual([]);

        });

        const toggleGlyphPathOf = (toggleElement: any) => toggleElement.children[0].children[0].attributes.d;

        // #277: THE ▸/▾ IS A PATH CENTRED IN ITS BOX, NOT A FONT GLYPH ON THE TEXT BASELINE
        it('draws every Treecipe toggle as an svg triangle that turns down when it opens', () => {

            const { panel } = renderTreeRecipe();
            const [firstTreeCard] = treeCardsOf(panel);
            const treeToggle = panel.findAll(firstTreeCard, 'treeToggle')[0];

            expect(treeToggle.textContent).toBe('');
            expect(treeToggle.children[0].namespaceURI).toBe('http://www.w3.org/2000/svg');
            expect(treeToggle.children[0].attributes['aria-hidden']).toBe('true');
            expect(toggleGlyphPathOf(treeToggle)).toBe(RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH);

            expandTree(panel, firstTreeCard);
            expect(toggleGlyphPathOf(treeToggle)).toBe(RECIPE_COCKPIT_TOGGLE_EXPANDED_GLYPH_PATH);
            expect(treeToggle.attributes['aria-expanded']).toBe('true');

            const accountElement = treeObjectNamed(panel, firstTreeCard, 'Account');
            const objectToggle = panel.findAll(accountElement, 'treeObjectToggle')[0];
            expect(toggleGlyphPathOf(objectToggle)).toBe(RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH);
            expandTreeObject(panel, accountElement);
            expect(toggleGlyphPathOf(objectToggle)).toBe(RECIPE_COCKPIT_TOGGLE_EXPANDED_GLYPH_PATH);

            const picklistToggle = panel.findAll(treeFieldNamed(panel, accountElement, 'Rating__c'), 'picklistToggle')[0];
            expect(toggleGlyphPathOf(picklistToggle)).toBe(RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH);
            expect(picklistToggle.attributes['aria-expanded']).toBe('false');
            picklistToggle.dispatch('click');
            expect(toggleGlyphPathOf(picklistToggle)).toBe(RECIPE_COCKPIT_TOGGLE_EXPANDED_GLYPH_PATH);
            expect(picklistToggle.attributes['aria-expanded']).toBe('true');
            picklistToggle.dispatch('click');
            expect(toggleGlyphPathOf(picklistToggle)).toBe(RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH);

        });

        it('gives a field with no picklist a hidden slot where the ▸ goes, so every field name lines up', () => {

            const { panel } = renderTreeRecipe();
            const [firstTreeCard] = treeCardsOf(panel);
            expandTree(panel, firstTreeCard);
            const accountElement = treeObjectNamed(panel, firstTreeCard, 'Account');
            expandTreeObject(panel, accountElement);

            const leadingClassOf = (fieldApiName: string) => {
                const headerChildren = treeFieldNamed(panel, accountElement, fieldApiName).children[0].children;
                const nameIndex = headerChildren.findIndex((child: any) => child.classList.contains('treeFieldName'));
                return headerChildren[nameIndex - 1].classList;
            };

            expect(leadingClassOf('Rating__c').contains('picklistToggle')).toBe(true);
            expect(leadingClassOf('Legacy_Code__c').contains('picklistToggleSpacer')).toBe(true);
            const spacer = panel.findAll(treeFieldNamed(panel, accountElement, 'Legacy_Code__c'), 'picklistToggleSpacer')[0];
            expect(spacer.attributes['aria-hidden']).toBe('true');
            expect(panel.findAll(treeFieldNamed(panel, accountElement, 'Rating__c'), 'picklistToggleSpacer')).toEqual([]);

        });

        // #277: THE VALUES OPEN UNDER THE ROW THAT WAS CLICKED, NEVER ABOVE IT
        it('opens a picklist\'s values at the bottom of its own row, after its header and expression', () => {

            const { panel } = renderTreeRecipe();
            const [firstTreeCard] = treeCardsOf(panel);
            expandTree(panel, firstTreeCard);
            const accountElement = treeObjectNamed(panel, firstTreeCard, 'Account');
            expandTreeObject(panel, accountElement);
            const ratingRow = treeFieldNamed(panel, accountElement, 'Rating__c');

            panel.findAll(ratingRow, 'picklistToggle')[0].dispatch('click');

            expect(ratingRow.children[0].classList.contains('treeFieldHeader')).toBe(true);
            expect(ratingRow.children[ratingRow.children.length - 1].classList.contains('picklistValues')).toBe(true);

        });

        it('ignores values answered for a model that is no longer on screen, or for a row that did not ask', () => {

            const { panel, recipe, loadedRecipe } = renderTreeRecipe();
            const [firstTreeCard] = treeCardsOf(panel);
            expandTree(panel, firstTreeCard);
            const accountElement = treeObjectNamed(panel, firstTreeCard, 'Account');
            expandTreeObject(panel, accountElement);
            const ratingRow = treeFieldNamed(panel, accountElement, 'Rating__c');
            panel.findAll(ratingRow, 'picklistToggle')[0].dispatch('click');

            panel.postToPanel({ command: 'picklistValues', objectApiName: 'Account', fieldApiName: 'Rating__c', picklistValues: ['Stale'], recordTypePicklistValues: [], renderSequence: 7 });
            panel.postToPanel({ command: 'picklistValues', objectApiName: 'Account', fieldApiName: 'Regions__c', picklistValues: ['Unasked'], recordTypePicklistValues: [], renderSequence: 1 });

            expect(textOf(panel, ratingRow, 'picklistLoading')).toEqual(['Loading values…']);
            expect(textOf(panel, panel.cockpitBodyElement, 'picklistValue')).toEqual([]);

            // A NEWER MODEL OF ANOTHER RUN DROPS THE OLD ROW'S REQUEST, SO ITS LATE ANSWER DRAWS NOTHING EITHER
            panel.postToPanel({ command: 'recipeData', recipe: { ...recipe, selectedRunFolderName: 'recipe-2001-01-01T00-00-00' }, renderSequence: 2 });
            answerLastPicklistRequest(panel, loadedRecipe, 2);
            expect(textOf(panel, panel.cockpitBodyElement, 'picklistValue')).toEqual([]);

        });

        it('writes every value from the model as text, never as markup', () => {

            const { panel, loadedRecipe } = renderTreeRecipe();
            const hostileValue = '<img src=x onerror=alert(1)>';
            loadedRecipe.picklistDisplayValuesByObjectApiName.get('Account').get('Rating__c').picklistValues = [hostileValue];

            const [firstTreeCard] = treeCardsOf(panel);
            expandTree(panel, firstTreeCard);
            const accountElement = treeObjectNamed(panel, firstTreeCard, 'Account');
            expandTreeObject(panel, accountElement);
            const ratingRow = treeFieldNamed(panel, accountElement, 'Rating__c');
            panel.findAll(ratingRow, 'picklistToggle')[0].dispatch('click');
            answerLastPicklistRequest(panel, loadedRecipe);

            expect(textOf(panel, ratingRow, 'picklistValue')[0]).toBe(hostileValue);
            expect(RecipeCockpitService.buildWebviewShellHtml('testNonce')).not.toContain('innerHTML');

        });

        it('given a search in one card\'s Treecipe tab, narrows only that card, and labels an object with no match rather than hiding it', () => {

            const { panel } = renderTreeRecipe();
            const [firstTreeCard, secondTreeCard] = treeCardsOf(panel);
            panel.expandAllTrees();

            panel.typeIntoFilter('status', secondTreeCard);

            const leadElement = treeObjectNamed(panel, secondTreeCard, 'Lead');
            expect(panel.visibleFieldNamesOf(leadElement)).toEqual(['Status']);
            expect(textOf(panel, secondTreeCard, 'tabMatchCount')).toEqual(['1 of 2 fields']);
            // THE OTHER CARD'S STRUCTURE TAB IS AS IT WAS
            expect(textOf(panel, firstTreeCard, 'tabMatchCount')).toEqual(['13 fields']);
            expect(textOf(panel, firstTreeCard, 'treeObjectCount')).toEqual(['8 fields', '2 fields', '3 fields']);
            expect(panel.findAll(firstTreeCard, 'treeObjectBody').every((bodyElement: any) => panel.isHidden(bodyElement))).toBe(true);

            panel.typeIntoFilter('status', firstTreeCard);

            expect(panel.isHidden(treeBodyOf(firstTreeCard))).toBe(false);
            expect(textOf(panel, firstTreeCard, 'treeObjectName')).toEqual(['Account', 'Contact', 'OtherChildObject__c']);
            expect(textOf(panel, firstTreeCard, 'treeObjectCount')).toEqual(['no matching fields', 'no matching fields', 'no matching fields']);
            expect(textOf(panel, firstTreeCard, 'tabMatchCount')).toEqual(['no matches']);

        });

        it('keeps each search box\'s text when the reader switches tabs or collapses the card', () => {

            const { panel } = renderTreeRecipe();
            const [firstTreeCard] = treeCardsOf(panel);
            expandTree(panel, firstTreeCard);

            panel.typeIntoFilter('rating');
            panel.openTab(firstTreeCard, 'Previously Used Data Sets');
            panel.openTab(firstTreeCard, 'Treecipe');
            expandTree(panel, firstTreeCard);
            expandTree(panel, firstTreeCard);

            expect(panel.findAll(panel.tabPanelOf(firstTreeCard, 'treeStructure'), 'tabSearchInput')[0].value).toBe('rating');
            expect(panel.visibleFieldNamesOf(treeObjectNamed(panel, firstTreeCard, 'Account'))).toEqual(['Rating__c', 'Sub_Rating__c']);

        });

        it('given the search is cleared, puts back the objects the reader had open', () => {

            const { panel } = renderTreeRecipe();
            const [firstTreeCard] = treeCardsOf(panel);
            expandTree(panel, firstTreeCard);
            const accountElement = treeObjectNamed(panel, firstTreeCard, 'Account');
            const contactElement = treeObjectNamed(panel, firstTreeCard, 'Contact');
            expandTreeObject(panel, contactElement);

            panel.typeIntoFilter('rating');
            expect(panel.isHidden(panel.objectBodyOf(accountElement))).toBe(false);
            expect(panel.isHidden(panel.objectBodyOf(contactElement))).toBe(true);

            panel.typeIntoFilter('');

            expect(panel.isHidden(panel.objectBodyOf(accountElement))).toBe(true);
            expect(panel.isHidden(panel.objectBodyOf(contactElement))).toBe(false);
            expect(textOf(panel, firstTreeCard, 'tabMatchCount')).toEqual(['13 fields']);

        });

        it('opens at most the auto-expand limit of matching objects, and each card\'s search box spends its own budget', () => {

            const buildManyObjects = (prefix: string) => Array.from({ length: RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT + 5 }, (unusedValue, objectIndex) => ({
                objectApiName: `${prefix}${objectIndex}__c`,
                recipeFilePath: '',
                fields: [{ fieldApiName: 'Shared__c', fieldLabel: '', fieldType: 'Text', fieldTypeWithSize: 'Text', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false }]
            }));
            const firstObjects = buildManyObjects('First');
            const secondObjects = buildManyObjects('Second');
            const buildTree = (treeKey: string, objects: any[]) => ({
                treeKey: treeKey, title: 'Relationship Tree', folderName: treeKey, fieldCount: objects.length,
                objects: objects.map(objectViewModel => ({ objectApiName: objectViewModel.objectApiName, parentLookups: [] as any[] }))
            });

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', renderSequence: 1, recipe: buildRecipeViewModel({
                objects: [...firstObjects, ...secondObjects],
                trees: [buildTree('First', firstObjects), buildTree('Second', secondObjects)]
            }) });
            panel.expandAllTrees();
            const [firstTreeCard, secondTreeCard] = treeCardsOf(panel);

            panel.typeIntoFilter('shared', firstTreeCard);
            panel.typeIntoFilter('shared', secondTreeCard);

            [firstTreeCard, secondTreeCard].forEach(treeCard => {
                const openedBodies = panel.findAll(treeCard, 'treeObjectBody').filter((bodyElement: any) => !panel.isHidden(bodyElement));
                expect(openedBodies).toHaveLength(RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT);
                expect(textOf(panel, treeCard, 'treeObjectCount').slice(RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT)).toEqual(Array(5).fill('1 of 1 field'));
            });

        });

        it('stops opening objects once the next would pass the row budget, and always opens the first', () => {

            const buildWideObject = (objectApiName: string, fieldCount: number) => ({
                objectApiName: objectApiName,
                recipeFilePath: '',
                fields: Array.from({ length: fieldCount }, (unusedValue, fieldIndex) => ({
                    fieldApiName: `Shared_${fieldIndex}__c`, fieldLabel: '', fieldType: 'Text', fieldTypeWithSize: 'Text', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false
                }))
            });
            const wideObjects = [buildWideObject('Widest__c', RECIPE_COCKPIT_AUTO_EXPAND_ROW_BUDGET + 1), buildWideObject('Narrow__c', 1)];

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', renderSequence: 1, recipe: buildRecipeViewModel({
                objects: wideObjects,
                trees: [{ treeKey: 'Widest__c-thru-Narrow__c', title: 'Relationship Tree 1', folderName: 'Widest__c-thru-Narrow__c', fieldCount: wideObjects[0].fields.length + 1,
                          objects: wideObjects.map(objectViewModel => ({ objectApiName: objectViewModel.objectApiName, parentLookups: [] })) }]
            }) });

            panel.expandAllTrees();
            panel.typeIntoFilter('shared');

            const [treeCard] = treeCardsOf(panel);
            expect(panel.findAll(treeCard, 'treeObjectBody').map((bodyElement: any) => !panel.isHidden(bodyElement))).toEqual([true, false]);
            expect(panel.findAll(treeCard, 'treeObjectCount').map((element: any) => element.textContent)).toEqual([
                `${RECIPE_COCKPIT_AUTO_EXPAND_ROW_BUDGET + 1} of ${RECIPE_COCKPIT_AUTO_EXPAND_ROW_BUDGET + 1} fields`, '1 of 1 field'
            ]);

        });

        it('given a run with no tree data, draws one card per recipe file and the notice that says why', () => {

            const { panel } = renderTreeRecipe(LEGACY_TREE_RUN_FOLDER_NAME);

            expect(textOf(panel, panel.cockpitBodyElement, 'treeFolder')).toEqual(['Account-thru-Contact', 'Lead-ONLY']);
            expect(textOf(panel, panel.cockpitBodyElement, 'notice')).toEqual([RECIPE_COCKPIT_TREE_DATA_MISSING_NOTICE]);

            expandTree(panel, treeCardsOf(panel)[0]);
            expect(panel.findAll(treeCardsOf(panel)[0], 'treeLookups')).toEqual([]);

        });

        it('given an object named __proto__ in a hand-edited wrapper, still lists it in its card', () => {

            const prototypeNamedObject = { objectApiName: '__proto__', recipeFilePath: '', fields: [] as any[] };
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', renderSequence: 1, recipe: buildRecipeViewModel({
                objects: [prototypeNamedObject],
                trees: [{ treeKey: '__proto__-ONLY', title: 'Relationship Tree 1', folderName: '__proto__-ONLY', fieldCount: 0, objects: [{ objectApiName: '__proto__', parentLookups: [] }] }]
            }) });

            const [treeCard] = treeCardsOf(panel);
            expandTree(panel, treeCard);

            expect(textOf(panel, treeCard, 'treeObjectName')).toEqual(['__proto__']);
            expect(textOf(panel, treeCard, 'treeCount')).toEqual(['1 object · 0 fields']);

        });

        // WHAT IS SEARCHABLE IS WHAT IS ON SCREEN: THE STRUCTURE TAB DRAWS THE TYPE WITH ITS SIZE
        it('matches a field by the sized type the Treecipe tab draws', () => {

            const { panel } = renderTreeRecipe();
            panel.expandAllTrees();

            panel.typeIntoFilter('text(50)');
            expect(textOf(panel, treeCardsOf(panel)[0], 'tabMatchCount')).toEqual(['1 of 13 fields']);

        });

        it('answers every row that asked for the same picklist, not only the last', () => {

            const { panel, recipe, loadedRecipe } = renderTreeRecipe();
            const leadObject = recipe.objects.find(objectViewModel => objectViewModel.objectApiName === 'Lead');
            const repeatedRecipe = { ...recipe, objects: recipe.objects.map(objectViewModel => objectViewModel === leadObject
                ? { ...leadObject, fields: [...leadObject.fields, leadObject.fields.find(fieldViewModel => fieldViewModel.fieldApiName === 'Status')] }
                : objectViewModel) };
            panel.postToPanel({ command: 'recipeData', recipe: repeatedRecipe, renderSequence: 1 });

            const [, leadTreeCard] = treeCardsOf(panel);
            expandTree(panel, leadTreeCard);
            const leadElement = treeObjectNamed(panel, leadTreeCard, 'Lead');
            expandTreeObject(panel, leadElement);
            panel.findAll(leadElement, 'picklistToggle').forEach((toggleElement: any) => toggleElement.dispatch('click'));

            answerLastPicklistRequest(panel, loadedRecipe);

            expect(panel.findAll(leadElement, 'picklistValues').map((element: any) => textOf(panel, element, 'picklistValue'))).toEqual([
                ['Open', 'Closed'], ['Open', 'Closed']
            ]);

        });

        // AN INSERT RELOADS INTO THE CARDS WITH THE CARD IT WAS ASKED FROM OPEN ON ITS TREECIPE TAB, WHOSE ORG PICKER ASKS FOR ITS ORGS (#255)
        it('given a reload focused on a card\'s Treecipe tab, opens that card on Treecipe and asks for the orgs after the ack', () => {

            const panel = runPanelScript();
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            const recipe = RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME).recipeViewModel;
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1, focusTree: { treeKey: 'Lead-ONLY', tab: 'treecipe' } });

            const [firstTreeCard, leadTreeCard] = treeCardsOf(panel);

            expect(panel.isHidden(treeBodyOf(firstTreeCard))).toBe(true);
            expect(panel.isHidden(treeBodyOf(leadTreeCard))).toBe(false);
            expect(panel.findAll(leadTreeCard, 'selected').map((element: any) => element.textContent)).toEqual(['Treecipe']);
            const postedCommands = panel.postedHostMessages.map((hostMessage: any) => hostMessage.command);
            expect(postedCommands.filter((command: string) => command === 'loadDataOrgs')).toHaveLength(1);
            expect(postedCommands.indexOf('loadDataOrgs')).toBeGreaterThan(postedCommands.indexOf('rendered'));

        });

        // #266: A FOCUS NAMING THE REMOVED COMPARE TAB OPENS THE CARD ON TREECIPE, WHOSE ORG PICKER ASKS FOR ITS ORGS
        it('given a reload focused on a card\'s removed Compare tab, opens that card on Treecipe', () => {

            const panel = runPanelScript();
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            const recipe = RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME).recipeViewModel;
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1, focusTree: { treeKey: 'Lead-ONLY', tab: 'compare' } });

            const [, leadTreeCard] = treeCardsOf(panel);

            expect(panel.postedHostMessages.map((hostMessage: any) => hostMessage.command)).not.toContain('renderFailed');
            expect(panel.isHidden(treeBodyOf(leadTreeCard))).toBe(false);
            expect(panel.findAll(leadTreeCard, 'selected').map((element: any) => element.textContent)).toEqual(['Treecipe']);
            expect(panel.findAll(leadTreeCard, 'treeTab').map((element: any) => element.textContent)).not.toContain('Compare');

        });

        it('given a model with objects and no trees, says so in the trees view', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', renderSequence: 1, recipe: buildRecipeViewModel({
                objects: [{ objectApiName: 'Lead', recipeFilePath: '', fields: [] }]
            }) });

            expect(textOf(panel, viewOf(panel, 'treesView'), 'emptyState')).toEqual(['This run has no relationship trees to show. Run "Generate Treecipe" again to draw its objects in relationship trees.']);

        });

    });

    describe('the panel script, executed', () => {

        const renderFixtureRecipe = () => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT), renderSequence: 1 });
            return panel;
        };

        it('announces itself ready on load, and shows it is still connecting until the host answers', () => {

            const panel = runPanelScript();

            expect(panel.postedHostMessages).toEqual([{ command: 'ready' }]);
            expect(panel.loadStatusElement.textContent).toBe(RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT);

        });

        it('reports each load phase the host sends in its status line', () => {

            const panel = runPanelScript();

            panel.postToPanel({ command: 'loadPhase', message: RECIPE_COCKPIT_LOAD_PHASES.readingRun });

            expect(panel.loadStatusElement.textContent).toBe(RECIPE_COCKPIT_LOAD_PHASES.readingRun);
            expect(panel.isHidden(panel.loadStatusElement)).toBe(false);

        });

        it('given the recipe, draws the toolbar first, one collapsed card per tree, and acknowledges the draw', () => {

            const panel = renderFixtureRecipe();

            expect(panel.cockpitBodyElement.children[0].classList.contains('toolbar')).toBe(true);
            expect(panel.findAll(panel.cockpitBodyElement, 'filterInput')).toEqual([]);

            expect(panel.treeCards()).toHaveLength(1);
            // A CARD'S OBJECTS, AND ITS STRUCTURE TAB'S SEARCH BOX, ARE ATTACHED ON ITS FIRST EXPAND, AND THEIR ROWS ON THEIR OWN
            expect(panel.objectElements()).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement, 'tabSearchInput')).toEqual([]);

            panel.expandAllTrees();

            const structureElement = panel.tabPanelOf(panel.treeCards()[0], 'treeStructure');
            // THE TREECIPE TAB OPENS WITH ITS HEADER -- THE ORG PICKER AND THE TREE'S ACTIONS (#255) -- THEN ITS SEARCH BOX
            expect(structureElement.children[0].classList.contains('treecipeHeader')).toBe(true);
            expect(structureElement.children[1].classList.contains('tabSearch')).toBe(true);
            expect(panel.findAll(structureElement, 'tabMatchCount')[0].textContent).toBe('7 fields');

            expect(panel.objectElements().map(panel.objectNameOf)).toEqual(['Account', 'Contact']);
            expect(panel.objectElements().map(panel.objectCountOf)).toEqual(['5 fields', '2 fields']);
            expect(panel.objectElements().every(objectElement => panel.isHidden(panel.objectBodyOf(objectElement)))).toBe(true);
            expect(panel.findAll(panel.cockpitBodyElement, 'treeField')).toEqual([]);

            expect(panel.findAll(panel.cockpitBodyElement, 'notice').map(notice => notice.textContent)).toEqual([
                '1 field entry in the objects wrapper had no field api name and is not shown.'
            ]);
            expect(panel.postedHostMessages).toContainEqual({ command: 'rendered', renderSequence: 1 });
            expect(panel.isHidden(panel.loadStatusElement)).toBe(true);

        });

        it('given an object is expanded, builds its rows with each field\'s type, controlling field and faker expression', () => {

            const panel = renderFixtureRecipe();
            panel.expandAllTrees();
            const [accountElement] = panel.objectElements();

            panel.expandObject(accountElement);

            expect(panel.isHidden(panel.objectBodyOf(accountElement))).toBe(false);
            expect(panel.visibleFieldNamesOf(accountElement)).toEqual(['Name', 'Industry', 'Industry_Group__c', 'Number_of_Contacts__c', 'Legacy_Code__c']);

            const industryGroupRow = panel.fieldRowNamed(accountElement, 'Industry_Group__c');
            expect(panel.findAll(industryGroupRow, 'fieldType')[0].textContent).toBe('Picklist');
            expect(panel.findAll(industryGroupRow, 'controllingField')[0].textContent).toBe('controlled by Industry');
            expect(panel.findAll(industryGroupRow, 'expression')[0].textContent).toContain("when: ${{ Industry == 'Agriculture' }}");

            expect(panel.findAll(panel.fieldRowNamed(accountElement, 'Name'), 'recipeFileOnly')).toHaveLength(1);

        });

        /*
            An object with no match stays on screen, collapsed and labelled: hiding it would make a
            filter look like a truncation.
        */
        it('given a filter, narrows fields live and labels an object with no match rather than hiding it', () => {

            const panel = renderFixtureRecipe();
            panel.expandAllTrees();

            panel.typeIntoFilter('industry');

            const [accountElement, contactElement] = panel.objectElements();

            expect(panel.isHidden(panel.objectBodyOf(accountElement))).toBe(false);
            expect(panel.visibleFieldNamesOf(accountElement)).toEqual(['Industry', 'Industry_Group__c']);
            expect(panel.objectCountOf(accountElement)).toBe('2 of 5 fields');

            expect(panel.isHidden(contactElement)).toBe(false);
            expect(panel.isHidden(panel.objectBodyOf(contactElement))).toBe(true);
            expect(panel.objectCountOf(contactElement)).toBe('no matching fields');

            expect(panel.findAll(panel.cockpitBodyElement, 'tabMatchCount')[0].textContent).toBe('2 of 7 fields');

        });

        it('given a filter naming an object, shows all of that object\'s fields', () => {

            const panel = renderFixtureRecipe();
            panel.expandAllTrees();

            panel.typeIntoFilter('  CONTACT ');

            const [, contactElement] = panel.objectElements();
            expect(panel.visibleFieldNamesOf(contactElement)).toEqual(['LastName', 'AccountId']);
            expect(panel.objectCountOf(contactElement)).toBe('2 fields');

        });

        it('matches a field by its faker expression, which the row draws', () => {

            const panel = renderFixtureRecipe();
            panel.expandAllTrees();

            panel.typeIntoFilter('random_number');

            const [accountElement] = panel.objectElements();
            expect(panel.visibleFieldNamesOf(accountElement)).toEqual(['Number_of_Contacts__c']);
            expect(panel.findAll(panel.fieldRowNamed(accountElement, 'Number_of_Contacts__c'), 'expression')[0].textContent).toContain('random_number');

        });

        it('given the filter is cleared, shows every field and puts back the objects the reader had open', () => {

            const panel = renderFixtureRecipe();
            panel.expandAllTrees();
            const [accountElement, contactElement] = panel.objectElements();

            panel.expandObject(contactElement);
            panel.typeIntoFilter('industry');
            expect(panel.isHidden(panel.objectBodyOf(contactElement))).toBe(true);

            panel.typeIntoFilter('');

            expect(panel.isHidden(panel.objectBodyOf(accountElement))).toBe(true);
            expect(panel.isHidden(panel.objectBodyOf(contactElement))).toBe(false);
            expect(panel.objectCountOf(accountElement)).toBe('5 fields');
            expect(panel.findAll(accountElement, 'treeField').every((fieldElement: any) => !panel.isHidden(fieldElement))).toBe(true);

        });

        const buildOneTreeRecipe = (objects: any[]) => buildRecipeViewModel({
            objects: objects,
            trees: [{ treeKey: 'Wide-thru-Narrow', title: 'Relationship Tree 1', folderName: 'Wide-thru-Narrow', fieldCount: 0,
                objects: objects.map(objectViewModel => ({ objectApiName: objectViewModel.objectApiName, parentLookups: [] })) }]
        });

        // WHAT A KEYSTROKE COSTS IS BOUNDED BY WHAT IT EXPANDS, NOT BY WHAT IT MATCHES
        it('expands at most the auto-expand limit of matching objects, and leaves the rest collapsed with their counts', () => {

            const manyObjects = Array.from({ length: RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT + 5 }, (unusedValue, objectIndex) => ({
                objectApiName: `Object${objectIndex}__c`,
                recipeFilePath: '',
                fields: [{ fieldApiName: 'Shared__c', fieldLabel: '', fieldType: 'Text', fieldTypeWithSize: 'Text', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false }]
            }));

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: buildOneTreeRecipe(manyObjects) });
            panel.expandAllTrees();

            panel.typeIntoFilter('shared');

            const expandedObjectElements = panel.objectElements().filter(objectElement => !panel.isHidden(panel.objectBodyOf(objectElement)));
            expect(expandedObjectElements).toHaveLength(RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT);
            expect(panel.objectCountOf(panel.objectElements()[RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT])).toBe('1 of 1 field');

        });

        /*
            An expand builds every row of the object, so the object limit alone lets 25 wide objects
            build 20,000 rows on one keystroke. The first match always opens, however wide.
        */
        it('stops opening objects once the next would pass the row budget, and always opens the first', () => {

            const buildWideObject = (objectApiName: string, fieldCount: number) => ({
                objectApiName: objectApiName,
                recipeFilePath: '',
                fields: Array.from({ length: fieldCount }, (unusedValue, fieldIndex) => ({
                    fieldApiName: `Shared_${fieldIndex}__c`, fieldLabel: '', fieldType: 'Text', fieldTypeWithSize: 'Text', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false
                }))
            });

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', renderSequence: 1, recipe: buildOneTreeRecipe([
                buildWideObject('Widest__c', RECIPE_COCKPIT_AUTO_EXPAND_ROW_BUDGET + 1),
                buildWideObject('Narrow__c', 1),
                buildWideObject('AlsoNarrow__c', 1)
            ]) });
            panel.expandAllTrees();

            panel.typeIntoFilter('shared');

            expect(panel.objectElements().map(objectElement => !panel.isHidden(panel.objectBodyOf(objectElement)))).toEqual([true, false, false]);
            expect(panel.objectCountOf(panel.objectElements()[1])).toBe('1 of 1 field');

        });

        it('given an object name or a field\'s yml link is clicked, asks the host to open that line of the recipe file', () => {

            const panel = renderFixtureRecipe();
            panel.expandAllTrees();
            const [accountElement] = panel.objectElements();

            panel.findAll(accountElement, 'treeObjectName')[0].dispatch('click');
            panel.expandObject(accountElement);
            panel.findAll(panel.fieldRowNamed(accountElement, 'Industry'), 'treeFieldSource')[0].dispatch('click');

            expect(panel.postedHostMessages).toContainEqual({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 7 });
            expect(panel.postedHostMessages).toContainEqual({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });

        });

        it('offers nothing to click for a field the recipe file does not carry', () => {

            const panel = renderFixtureRecipe();
            panel.expandAllTrees();
            const [accountElement] = panel.objectElements();

            panel.expandObject(accountElement);
            const legacyCodeRow = panel.fieldRowNamed(accountElement, 'Legacy_Code__c');

            expect(panel.findAll(legacyCodeRow, 'treeFieldSource')).toEqual([]);
            expect(panel.findAll(legacyCodeRow, 'sourceLink')).toEqual([]);

        });

        it('offers every run in a selector, the loaded one selected, and asks the host for the one chosen', () => {

            const panel = renderFixtureRecipe();
            const runSelectElement = panel.findAll(panel.cockpitBodyElement, 'runSelect')[0];

            expect(runSelectElement.children.map((runOption: any) => [runOption.value, runOption.selected])).toEqual([
                [LATEST_RUN_FOLDER_NAME, true],
                [FAKER_JS_RUN_FOLDER_NAME, false]
            ]);

            runSelectElement.value = FAKER_JS_RUN_FOLDER_NAME;
            runSelectElement.dispatch('change');

            expect(panel.postedHostMessages).toContainEqual({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });

        });

        it('given no generated run, shows the empty state naming Generate Treecipe, no search box and no org picker', () => {

            const panel = runPanelScript();

            panel.postToPanel({ command: 'recipeData', recipe: RecipeCockpitService.buildRecipeViewModel(path.join(MOCK_WORKSPACE_ROOT, 'doesNotExist')) });

            expect(panel.findAll(panel.cockpitBodyElement, 'emptyState')[0].textContent).toBe(RECIPE_COCKPIT_NO_RUN_MESSAGE);
            expect(panel.findAll(panel.cockpitBodyElement, 'tabSearchInput')).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement, 'dataOrgControls')).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement, 'runSelect')).toEqual([]);

        });

        it('given no generated run, offers Generate Treecipe, which disables itself and asks the host once', () => {

            const panel = runPanelScript();

            panel.postToPanel({ command: 'recipeData', recipe: RecipeCockpitService.buildRecipeViewModel(path.join(MOCK_WORKSPACE_ROOT, 'doesNotExist')) });

            const [generateButton] = panel.findAll(panel.cockpitBodyElement, 'generateTreecipe');
            expect(generateButton.textContent).toBe(RECIPE_COCKPIT_GENERATE_TREECIPE_ACTION_LABEL);

            generateButton.dispatch('click');

            expect(generateButton.disabled).toBe(true);
            expect(generateButton.textContent).toBe(RECIPE_COCKPIT_GENERATE_TREECIPE_RUNNING_LABEL);
            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'generateTreecipe')).toEqual([{ command: 'generateTreecipe' }]);

            // THE HOST'S RELOAD REDRAWS THE BODY, AND WITH STILL NO RUN THE BUTTON COMES BACK PRESSABLE
            panel.postToPanel({ command: 'recipeData', recipe: RecipeCockpitService.buildRecipeViewModel(path.join(MOCK_WORKSPACE_ROOT, 'doesNotExist')) });

            const [redrawnButton] = panel.findAll(panel.cockpitBodyElement, 'generateTreecipe');
            expect(redrawnButton.disabled).toBeFalsy();
            expect(redrawnButton.textContent).toBe(RECIPE_COCKPIT_GENERATE_TREECIPE_ACTION_LABEL);

        });

        it('given a run, or a run that could not be read, offers no Generate Treecipe', () => {

            const fixturePanel = renderFixtureRecipe();
            expect(fixturePanel.findAll(fixturePanel.cockpitBodyElement, 'generateTreecipe')).toEqual([]);

            const unreadablePanel = runPanelScript();
            unreadablePanel.postToPanel({ command: 'recipeData', recipe: buildRecipeViewModel({ emptyStateMessage: 'could not be read' }) });
            expect(unreadablePanel.findAll(unreadablePanel.cockpitBodyElement, 'generateTreecipe')).toEqual([]);

        });

        it('given a run that could not be read, keeps the run selector so another run can be chosen', () => {

            const panel = runPanelScript();

            panel.postToPanel({ command: 'recipeData', recipe: buildRecipeViewModel({ emptyStateMessage: 'could not be read' }) });

            expect(panel.findAll(panel.cockpitBodyElement, 'runSelect')).toHaveLength(1);
            expect(panel.findAll(panel.cockpitBodyElement, 'emptyState')[0].textContent).toBe('could not be read');

        });

        // A PARTIAL PAGE IS AN ARBITRARY PREFIX OF THE MODEL, NOT A SMALLER CORRECT ANSWER
        it('given a model it cannot draw, replaces the body with a failure notice and reports the failure', () => {

            const panel = runPanelScript();

            panel.postToPanel({ command: 'recipeData', recipe: buildRecipeViewModel({
                objects: [{ objectApiName: 'Account' } as any],
                trees: [{ treeKey: 'Account-ONLY', title: 'Relationship Tree 1', folderName: 'Account-ONLY', fieldCount: 0, objects: [{ objectApiName: 'Account', parentLookups: [] }] }]
            }) });

            expect(panel.findAll(panel.cockpitBodyElement, 'treeCard')).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement, 'emptyState')[0].textContent).toContain('could not draw');
            expect(panel.postedHostMessages.map(hostMessage => hostMessage.command)).not.toContain('rendered');
            expect(panel.postedHostMessages).toContainEqual(expect.objectContaining({ command: 'renderFailed', phase: 'render' }));
            // THE STATUS LINE IS LEFT ALONE -- CLEARING IT WOULD READ AS A FINISHED LOAD
            expect(panel.isHidden(panel.loadStatusElement)).toBe(false);

        });

        it('given a throw outside the render, reports it as a runtime failure', () => {

            const panel = runPanelScript();

            panel.raiseWindowError({ message: 'lazy expand broke', type: 'error', error: { stack: 'at ensureObjectBodyBuilt' } });

            expect(panel.postedHostMessages).toContainEqual({
                command: 'renderFailed',
                phase: 'runtime',
                message: 'lazy expand broke',
                stack: 'at ensureObjectBodyBuilt'
            });

        });

        it('given a run fails to load, puts the selector back on the run whose rows are still on screen', () => {

            const panel = renderFixtureRecipe();
            const runSelectElement = panel.findAll(panel.cockpitBodyElement, 'runSelect')[0];

            runSelectElement.value = FAKER_JS_RUN_FOLDER_NAME;
            runSelectElement.dispatch('change');
            panel.postToPanel({ command: 'loadFailed', message: 'The Recipe Cockpit could not finish loading: EIO' });

            expect(runSelectElement.value).toBe(LATEST_RUN_FOLDER_NAME);

        });

        it('given the load failed, says so in the status line', () => {

            const panel = runPanelScript();

            panel.postToPanel({ command: 'loadFailed', message: 'The Recipe Cockpit could not finish loading: disk' });

            expect(panel.loadStatusElement.textContent).toBe('The Recipe Cockpit could not finish loading: disk');
            expect(panel.loadStatusElement.classList.contains('failed')).toBe(true);

        });

        it('given an unrecognized message or nothing at all, changes nothing', () => {

            const panel = runPanelScript();

            panel.postToPanel({ command: 'renderModel' });
            panel.postToPanel(undefined);

            expect(panel.loadStatusElement.textContent).toBe(RECIPE_COCKPIT_PENDING_ACKNOWLEDGEMENT);
            expect(panel.cockpitBodyElement.children).toEqual([]);

        });

    });

    describe('tree history', () => {

        const LEAD_TREE_KEY = 'Lead-ONLY';
        const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';

        const loadHistoryRecipe = (runFolderName?: string) => RecipeCockpitService.loadRecipeRunByRuns(
            RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
            HISTORY_WORKSPACE_ROOT,
            runFolderName
        );

        const datasetListing = (datasetFolderName: string, source: Partial<IDatasetSourceReadResult>): IDatasetListing => ({
            datasetFolderName: datasetFolderName,
            datasetFolderPath: `/workspace/treecipe/FakeDataSets/${datasetFolderName}`,
            folderNameDetail: DatasetSourceService.parseDatasetFolderName(datasetFolderName),
            source: { status: 'linked', basis: 'recorded', recipeRunFolderName: null, recipeTreeFolderName: null, reason: '', ...source }
        });

        // DatasetSourceService REPEATS THE NAME TO STAY fs-AND-path-ONLY, SO THE TWO ARE HELD TOGETHER HERE
        it('reads legacy record counts from the folder Run Faker by Recipe writes them to', () => {

            expect(DATASET_COLLECTIONS_API_FOLDER_NAME).toBe(ConfigurationService.getDatasetFilesForCollectionsApiFolderName());

        });

        describe('groupTreeHistories, tested pure', () => {

            const KNOWN_RUNS = [
                { runFolderName: 'recipe-2026-09-01T00-00-00', treeFolderNames: ['Lead-ONLY'] },
                { runFolderName: 'recipe-2026-09-20T10-00-00', treeFolderNames: ['Account-thru-Contact', 'Lead-ONLY'] },
                { runFolderName: 'recipe-fakerjs-2026-09-10T00-00-00', treeFolderNames: ['Lead-ONLY'] }
            ];
            const TREES = [
                { treeKey: 'Account-thru-Contact', folderName: 'Account-thru-Contact' },
                { treeKey: 'Lead-ONLY', folderName: 'Lead-ONLY' },
                { treeKey: 'not-a-folder', folderName: 'recipe-loose.yml' },
                { treeKey: '', folderName: '' }
            ];

            it('lists every run carrying the tree\'s folder, newest first by timestamp rather than by name, marking the current one', () => {

                const { historiesByTreeKey } = RecipeCockpitTreeHistory.groupTreeHistories(KNOWN_RUNS, [], TREES, 'recipe-2026-09-20T10-00-00');

                expect(historiesByTreeKey.get('Lead-ONLY').versions).toEqual([
                    { runFolderName: 'recipe-2026-09-20T10-00-00', generatedAtLabel: '2026-09-20 10:00:00 UTC', fakerService: 'snowfakery', isCurrent: true },
                    { runFolderName: 'recipe-fakerjs-2026-09-10T00-00-00', generatedAtLabel: '2026-09-10 00:00:00 UTC', fakerService: 'faker-js', isCurrent: false },
                    { runFolderName: 'recipe-2026-09-01T00-00-00', generatedAtLabel: '2026-09-01 00:00:00 UTC', fakerService: 'snowfakery', isCurrent: false }
                ]);
                expect(historiesByTreeKey.get('Account-thru-Contact').versions.map(version => version.runFolderName)).toEqual(['recipe-2026-09-20T10-00-00']);

            });

            it('orders runs of the same second by name, and data sets of the same second by suffix and then name', () => {

                const { historiesByTreeKey } = RecipeCockpitTreeHistory.groupTreeHistories(
                    [
                        { runFolderName: 'recipe-fakerjs-2026-09-20T10-00-00', treeFolderNames: ['Lead-ONLY'] },
                        { runFolderName: 'recipe-2026-09-20T10-00-00', treeFolderNames: ['Lead-ONLY'] }
                    ],
                    [
                        datasetListing('dataset-fakerjs-2026-09-21T00-00-00', { recipeRunFolderName: 'recipe-2026-09-20T10-00-00', recipeTreeFolderName: 'Lead-ONLY' }),
                        datasetListing('dataset-2026-09-21T00-00-00', { recipeRunFolderName: 'recipe-2026-09-20T10-00-00', recipeTreeFolderName: 'Lead-ONLY' })
                    ],
                    [{ treeKey: 'Lead-ONLY', folderName: 'Lead-ONLY' }],
                    'recipe-2026-09-20T10-00-00'
                );

                expect(historiesByTreeKey.get('Lead-ONLY').versions.map(version => version.runFolderName)).toEqual(['recipe-2026-09-20T10-00-00', 'recipe-fakerjs-2026-09-20T10-00-00']);
                expect(historiesByTreeKey.get('Lead-ONLY').datasets.map(dataset => dataset.datasetFolderName)).toEqual(['dataset-2026-09-21T00-00-00', 'dataset-fakerjs-2026-09-21T00-00-00']);

            });

            it('labels a folder name with no timestamp as itself, and finds no recipe in a folder that is not there or holds two', () => {

                expect(RecipeCockpitTreeHistory.formatTimestampLabel('latest')).toBe('latest');
                expect(RecipeCockpitTreeHistory.findTreeRecipeFilePath(path.join(HISTORY_GENERATED_RECIPES_PATH, 'missing'))).toBeUndefined();
                expect(RecipeCockpitTreeHistory.findTreeRecipeFilePath(path.join(MOCK_GENERATED_RECIPES_PATH, LATEST_RUN_FOLDER_NAME))).toBeUndefined();

            });

            it('gives every card of a repeated folder the same data sets, and words a single unmatched data set in the singular', () => {

                const { historiesByTreeKey } = RecipeCockpitTreeHistory.groupTreeHistories(
                    KNOWN_RUNS,
                    [datasetListing('dataset-2026-09-21T00-00-00', { recipeRunFolderName: 'recipe-2026-09-20T10-00-00', recipeTreeFolderName: 'Lead-ONLY' })],
                    [{ treeKey: 'Lead-ONLY', folderName: 'Lead-ONLY' }, { treeKey: 'Lead-ONLY#2', folderName: 'Lead-ONLY' }],
                    'recipe-2026-09-20T10-00-00'
                );

                expect(historiesByTreeKey.get('Lead-ONLY#2').datasets).toEqual(historiesByTreeKey.get('Lead-ONLY').datasets);
                expect(historiesByTreeKey.get('Lead-ONLY#2').datasets).toHaveLength(1);
                expect(RecipeCockpitTreeHistory.buildUnmatchedDatasetsNotice(1)).toBe('1 data set couldn\'t be matched to a recipe tree.');

            });

            it('holds only data set folders and Run Faker recipes on the host, with no version summary or diff targets (#265)', () => {

                const { targets } = RecipeCockpitTreeHistory.buildTreeHistories(
                    HISTORY_GENERATED_RECIPES_PATH,
                    path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'FakeDataSets'),
                    HISTORY_WORKSPACE_ROOT,
                    HISTORY_CURRENT_RUN,
                    [{ treeKey: 'Lead-ONLY', folderName: 'Lead-ONLY' }]
                );

                expect(Object.keys(targets).sort()).toEqual(['datasetFolderPathsByName', 'runFakerRecipeFilePathsByTreeKey']);
                expect(targets.runFakerRecipeFilePathsByTreeKey.get('Lead-ONLY')).toContain(HISTORY_CURRENT_RUN);

            });

            it('gives no history to a card with no tree folder in the run on screen', () => {

                const { historiesByTreeKey } = RecipeCockpitTreeHistory.groupTreeHistories(KNOWN_RUNS, [], TREES, 'recipe-2026-09-01T00-00-00');

                expect([...historiesByTreeKey.keys()]).toEqual(['Lead-ONLY']);

            });

            it('places each data set under its tree newest first, collision suffix included, with its version or none, and counts the rest as unmatched', () => {

                const { historiesByTreeKey, unmatchedDatasetCount } = RecipeCockpitTreeHistory.groupTreeHistories(KNOWN_RUNS, [
                    datasetListing('dataset-2026-09-21T00-00-00', { recipeRunFolderName: 'recipe-2026-09-20T10-00-00', recipeTreeFolderName: 'Lead-ONLY' }),
                    datasetListing('dataset-2026-09-21T00-00-00-2', { recipeRunFolderName: 'recipe-2026-09-20T10-00-00', recipeTreeFolderName: 'Lead-ONLY' }),
                    datasetListing('dataset-fakerjs-2026-09-11T00-00-00', { recipeRunFolderName: 'recipe-fakerjs-2026-09-10T00-00-00', recipeTreeFolderName: 'Lead-ONLY' }),
                    datasetListing('dataset-2026-09-15T00-00-00', { status: 'unknown', treeFolderNameHint: 'Lead-ONLY' }),
                    datasetListing('dataset-2026-09-16T00-00-00', { status: 'unknown' }),
                    datasetListing('dataset-2026-09-17T00-00-00', { status: 'linked' }),
                    datasetListing('dataset-2026-09-18T00-00-00', { status: 'unreadable', basis: 'recorded' }),
                    datasetListing('dataset-2026-09-19T00-00-00', { status: 'absent', basis: 'none' }),
                    datasetListing('dataset-2026-09-22T00-00-00', { recipeRunFolderName: 'recipe-2026-08-01T00-00-00', recipeTreeFolderName: 'Opportunity-ONLY' })
                ], TREES, 'recipe-2026-09-20T10-00-00');

                expect(historiesByTreeKey.get('Lead-ONLY').datasets.map(dataset => [dataset.datasetFolderName, dataset.runFolderName])).toEqual([
                    ['dataset-2026-09-21T00-00-00-2', 'recipe-2026-09-20T10-00-00'],
                    ['dataset-2026-09-21T00-00-00', 'recipe-2026-09-20T10-00-00'],
                    ['dataset-2026-09-15T00-00-00', null],
                    ['dataset-fakerjs-2026-09-11T00-00-00', 'recipe-fakerjs-2026-09-10T00-00-00']
                ]);
                expect(historiesByTreeKey.get('Account-thru-Contact').datasets).toEqual([]);
                expect(unmatchedDatasetCount).toBe(5);

            });

            it('carries recorded record counts sorted by object, and leaves a legacy data set\'s to be read on expand', () => {

                const recordedSource = DatasetSourceService.buildDatasetSource(
                    { recipeRunFolderName: 'recipe-2026-09-20T10-00-00', recipeTreeFolderName: 'Lead-ONLY', recipeFileName: 'recipe.yml' },
                    'snowfakery', '2026-09-21T00:00:00.000Z', { Lead: 5, Account: 0 }
                );

                const { historiesByTreeKey } = RecipeCockpitTreeHistory.groupTreeHistories(KNOWN_RUNS, [
                    datasetListing('dataset-2026-09-21T00-00-00', { recipeRunFolderName: 'recipe-2026-09-20T10-00-00', recipeTreeFolderName: 'Lead-ONLY', datasetSource: recordedSource }),
                    datasetListing('dataset-2026-09-02T00-00-00', { basis: 'inferred', recipeRunFolderName: 'recipe-2026-09-01T00-00-00', recipeTreeFolderName: 'Lead-ONLY' })
                ], TREES, 'recipe-2026-09-20T10-00-00');

                expect(historiesByTreeKey.get('Lead-ONLY').datasets.map(dataset => dataset.recordCounts)).toEqual([
                    [{ objectApiName: 'Account', recordCount: 0 }, { objectApiName: 'Lead', recordCount: 5 }],
                    null
                ]);

            });

        });

        describe('loadRecipeRunByRuns, with data sets on disk', () => {

            it('gives each card with a tree folder its versions and data sets, and counts the unmatched data sets in one notice', () => {

                const { recipeViewModel } = loadHistoryRecipe();
                const leadTree = recipeViewModel.trees.find(tree => tree.treeKey === LEAD_TREE_KEY);
                const accountTree = recipeViewModel.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY);

                expect(leadTree.history.versions.map(version => [version.runFolderName, version.isCurrent])).toEqual([
                    [HISTORY_CURRENT_RUN, true],
                    ['recipe-fakerjs-2026-09-10T00-00-00', false],
                    ['recipe-2026-09-01T00-00-00', false]
                ]);
                expect(leadTree.history.datasets.map(dataset => [dataset.datasetFolderName, dataset.runFolderName])).toEqual([
                    ['dataset-2026-09-21T00-00-00', HISTORY_CURRENT_RUN],
                    ['dataset-2026-09-15T00-00-00', null],
                    ['dataset-2026-09-02T00-00-00', 'recipe-2026-09-01T00-00-00']
                ]);
                expect(accountTree.history.datasets.map(dataset => dataset.datasetFolderName)).toEqual(['dataset-2026-09-21T00-00-00-2']);
                expect(recipeViewModel.notices).toEqual(['3 data sets couldn\'t be matched to a recipe tree.']);

            });

            it('matches a data set to whichever run is on screen, by the tree it was made from', () => {

                const { recipeViewModel } = loadHistoryRecipe('recipe-2026-09-01T00-00-00');
                const contactTree = recipeViewModel.trees.find(tree => tree.folderName === 'Account-thru-Contact');

                expect(contactTree.history.datasets.map(dataset => dataset.datasetFolderName)).toEqual(['dataset-2026-09-03T00-00-00']);
                expect(contactTree.history.versions.map(version => version.runFolderName)).toEqual(['recipe-2026-09-01T00-00-00']);

            });

            it('keeps every path on the host and posts only names', () => {

                const { recipeViewModel, treeHistoryTargets } = loadHistoryRecipe();

                expect(JSON.stringify(recipeViewModel.trees.map(tree => tree.history))).not.toContain(HISTORY_WORKSPACE_ROOT);
                expect([...treeHistoryTargets.datasetFolderPathsByName.keys()].sort()).toEqual([
                    'dataset-2026-09-02T00-00-00', 'dataset-2026-09-03T00-00-00', 'dataset-2026-09-15T00-00-00', 'dataset-2026-09-16T00-00-00',
                    'dataset-2026-09-17T00-00-00', 'dataset-2026-09-21T00-00-00', 'dataset-2026-09-21T00-00-00-2'
                ]);
                expect([...treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.keys()].sort()).toEqual([ACCOUNT_TREE_KEY, LEAD_TREE_KEY]);

            });

            it('leaves out a data set whose path resolves outside the workspace', () => {

                const realIsPathContainedInWorkspace = SfdxProjectService.isPathContainedInWorkspace.bind(SfdxProjectService);
                jest.spyOn(SfdxProjectService, 'isPathContainedInWorkspace').mockImplementation((candidatePath: string, workspaceRoot: string) => (
                    !candidatePath.includes('dataset-2026-09-21T00-00-00')
                    && realIsPathContainedInWorkspace(candidatePath, workspaceRoot)
                ));

                const { recipeViewModel, treeHistoryTargets } = loadHistoryRecipe();
                const leadTree = recipeViewModel.trees.find(tree => tree.treeKey === LEAD_TREE_KEY);

                expect(leadTree.history.datasets.map(dataset => dataset.datasetFolderName)).not.toContain('dataset-2026-09-21T00-00-00');
                expect(treeHistoryTargets.datasetFolderPathsByName.has('dataset-2026-09-21T00-00-00')).toBe(false);

            });

        });

        describe('routePanelMessage, history actions', () => {

            const buildHistoryPanelState = (isActivated = true): IRecipeCockpitPanelState => {
                const loadedRecipe = loadHistoryRecipe();
                const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
                panelState.recipeDataMessage = { command: 'recipeData', recipe: loadedRecipe.recipeViewModel, renderSequence: 7 };
                panelState.treeHistoryTargets = loadedRecipe.treeHistoryTargets;
                panelState.pendingTreeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(loadedRecipe.recipeViewModel);
                if ( isActivated ) {
                    panelState.treeHistoryAllowLists = panelState.pendingTreeHistoryAllowLists;
                }
                return panelState;
            };

            it('builds each allow-list from the rendered histories, with only legacy data sets countable', () => {

                const allowLists = RecipeCockpitService.collectTreeHistoryAllowLists(loadHistoryRecipe().recipeViewModel);

                expect(allowLists).not.toHaveProperty('summaryTreeKeys');
                expect(allowLists).not.toHaveProperty('diffKeys');
                expect([...allowLists.countableDatasetFolderNames]).toEqual(['dataset-2026-09-02T00-00-00']);
                expect([...allowLists.openableDatasetFolderNames].sort()).toEqual([
                    'dataset-2026-09-02T00-00-00', 'dataset-2026-09-15T00-00-00', 'dataset-2026-09-21T00-00-00', 'dataset-2026-09-21T00-00-00-2'
                ]);
                expect(allowLists.insertableDatasetFolderNames).toEqual(allowLists.openableDatasetFolderNames);

            });

            it('offers nothing from a card that has no history', () => {

                const { recipeViewModel } = loadHistoryRecipe();
                recipeViewModel.trees.forEach(tree => { delete tree.history; });

                const allowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipeViewModel);

                expect([allowLists.openableDatasetFolderNames, allowLists.insertableDatasetFolderNames, allowLists.countableDatasetFolderNames].map(allowList => allowList.size))
                    .toEqual([0, 0, 0]);

            });

            it('answers nothing for an allow-listed name the host holds no target for', () => {

                const panelState = buildHistoryPanelState();
                panelState.treeHistoryTargets = RecipeCockpitTreeHistory.buildEmptyTargets();

                [
                    { command: 'loadDatasetRecordCounts', datasetFolderName: 'dataset-2026-09-02T00-00-00' },
                    { command: 'openDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00' }
                ].forEach(panelMessage => expect(RecipeCockpitService.routePanelMessage(panelMessage, panelState)).toBeUndefined());

            });

            it('routes every history action only once the model is confirmed drawn', () => {

                const panelState = buildHistoryPanelState(false);

                [
                    { command: 'loadDatasetRecordCounts', datasetFolderName: 'dataset-2026-09-02T00-00-00' },
                    { command: 'openDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00' },
                    { command: 'insertDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00' }
                ].forEach(panelMessage => expect(RecipeCockpitService.routePanelMessage(panelMessage, panelState)).toBeUndefined());

            });

            it('resolves a posted name through the host\'s own map, never a posted path', () => {

                const panelState = buildHistoryPanelState();
                const datasetFolderPath = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'FakeDataSets', 'dataset-2026-09-21T00-00-00');

                expect(RecipeCockpitService.routePanelMessage({ command: 'openDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00', filePath: '/etc' }, panelState))
                    .toEqual({ kind: 'openDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00', datasetFolderPath: datasetFolderPath });
                expect(RecipeCockpitService.routePanelMessage({ command: 'insertDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00', treeKey: LEAD_TREE_KEY, tab: 'datasets' }, panelState))
                    .toEqual({ kind: 'insertDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00', datasetFolderPath: datasetFolderPath, focusTree: { treeKey: LEAD_TREE_KEY, tab: 'datasets' } });
                expect(RecipeCockpitService.routePanelMessage({ command: 'loadDatasetRecordCounts', datasetFolderName: 'dataset-2026-09-02T00-00-00' }, panelState))
                    .toEqual({ kind: 'loadDatasetRecordCounts', datasetFolderName: 'dataset-2026-09-02T00-00-00', datasetFolderPath: path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'FakeDataSets', 'dataset-2026-09-02T00-00-00'), renderSequence: 7 });

            });

            it('routes nothing for the removed Previous Versions tab: no summaries, no diff, and no focus on it (#265)', () => {

                const panelState = buildHistoryPanelState();

                expect(RecipeCockpitService.routePanelMessage({ command: 'loadVersionSummaries', treeKey: LEAD_TREE_KEY }, panelState)).toBeUndefined();
                expect(RecipeCockpitService.routePanelMessage({ command: 'diffTreeVersion', treeKey: LEAD_TREE_KEY, runFolderName: 'recipe-2026-09-01T00-00-00' }, panelState)).toBeUndefined();
                expect(RecipeCockpitService.routePanelMessage({ command: 'insertDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00', treeKey: LEAD_TREE_KEY, tab: 'versions' }, panelState))
                    .not.toHaveProperty('focusTree');
                expect(RECIPE_COCKPIT_TREE_TABS).toEqual(['treecipe', 'datasets']);

            });

            it('answers nothing for a name the rendered model did not offer, a payload of the wrong type, or a focus it did not draw', () => {

                const panelState = buildHistoryPanelState();

                [
                    { command: 'loadDatasetRecordCounts', datasetFolderName: 'dataset-2026-09-21T00-00-00' },
                    { command: 'loadDatasetRecordCounts', datasetFolderName: 'dataset-2026-09-16T00-00-00' },
                    { command: 'loadDatasetRecordCounts', datasetFolderName: 42 },
                    { command: 'openDataset', datasetFolderName: 'dataset-2026-09-16T00-00-00' },
                    { command: 'openDataset', datasetFolderName: '../../../etc' },
                    { command: 'insertDataset', datasetFolderName: 'dataset-2026-09-17T00-00-00' },
                    { command: 'insertDataset' }
                ].forEach(panelMessage => expect(RecipeCockpitService.routePanelMessage(panelMessage, panelState)).toBeUndefined());

                expect(RecipeCockpitService.routePanelMessage({ command: 'openDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00', treeKey: '__proto__', tab: 'datasets' }, panelState))
                    .not.toHaveProperty('focusTree');
                expect(RecipeCockpitService.routePanelMessage({ command: 'openDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00', treeKey: LEAD_TREE_KEY, tab: 'constructor' }, panelState))
                    .not.toHaveProperty('focusTree');

            });

        });

        describe('routePanelMessage, runFaker', () => {

            const LEAD_RECIPE_FILE_PATH = path.join(HISTORY_GENERATED_RECIPES_PATH, HISTORY_CURRENT_RUN, 'Lead-ONLY', 'recipe--Lead-ONLY-2026-09-20T10-00-00.yml');

            const buildRunFakerPanelState = (isActivated = true): IRecipeCockpitPanelState => {
                const loadedRecipe = loadHistoryRecipe();
                const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
                panelState.recipeDataMessage = { command: 'recipeData', recipe: loadedRecipe.recipeViewModel, renderSequence: 7 };
                panelState.treeHistoryTargets = loadedRecipe.treeHistoryTargets;
                panelState.pendingTreeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(loadedRecipe.recipeViewModel);
                if ( isActivated ) {
                    panelState.treeHistoryAllowLists = panelState.pendingTreeHistoryAllowLists;
                }
                return panelState;
            };

            it('names each card\'s recipe FILE for the tooltip, and keeps its path on the host', () => {

                const { recipeViewModel, treeHistoryTargets } = loadHistoryRecipe();

                expect(recipeViewModel.trees.map(tree => [tree.treeKey, tree.runFakerRecipeFileName])).toEqual([
                    [ACCOUNT_TREE_KEY, 'recipe--Account-thru-OtherChildObject__c-2026-09-20T10-00-00.yml'],
                    [LEAD_TREE_KEY, 'recipe--Lead-ONLY-2026-09-20T10-00-00.yml']
                ]);
                expect(treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(LEAD_TREE_KEY)).toBe(LEAD_RECIPE_FILE_PATH);
                expect(JSON.stringify(recipeViewModel.trees)).not.toContain(HISTORY_WORKSPACE_ROOT);
                expect([...RecipeCockpitService.collectTreeHistoryAllowLists(recipeViewModel).runnableTreeKeys]).toEqual([ACCOUNT_TREE_KEY, LEAD_TREE_KEY]);

            });

            it('offers no Run Faker for a tree whose recipe resolves outside the workspace', () => {

                const realIsPathContainedInWorkspace = SfdxProjectService.isPathContainedInWorkspace.bind(SfdxProjectService);
                jest.spyOn(SfdxProjectService, 'isPathContainedInWorkspace').mockImplementation((candidatePath: string, workspaceRoot: string) => (
                    !candidatePath.endsWith('recipe--Lead-ONLY-2026-09-20T10-00-00.yml') && realIsPathContainedInWorkspace(candidatePath, workspaceRoot)
                ));

                const { recipeViewModel, treeHistoryTargets } = loadHistoryRecipe();

                expect(recipeViewModel.trees.find(tree => tree.treeKey === LEAD_TREE_KEY)).not.toHaveProperty('runFakerRecipeFileName');
                expect(treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.has(LEAD_TREE_KEY)).toBe(false);

            });

            it('resolves a posted tree key to the host\'s recipe file, never to a posted path', () => {

                expect(RecipeCockpitService.routePanelMessage({ command: 'runFaker', treeKey: LEAD_TREE_KEY, filePath: '/etc/passwd' }, buildRunFakerPanelState()))
                    .toEqual({ kind: 'runFaker', treeKey: LEAD_TREE_KEY, recipeFilePath: LEAD_RECIPE_FILE_PATH });

            });

            /*
                The panel disables every Run Faker on the click, so a refusal still answers: nothing
                runs, and the buttons come back. Only a run already in flight goes unanswered -- its
                own end re-enables them.
            */
            it('runs nothing before the draw is confirmed, for a key the model did not offer, or a payload of the wrong type, and says so', () => {

                const notRunning = (treeKey: string) => ({ kind: 'postRunFakerState', hostMessage: { command: 'runFakerState', isRunning: false, treeKey: treeKey } });

                expect(RecipeCockpitService.routePanelMessage({ command: 'runFaker', treeKey: LEAD_TREE_KEY }, buildRunFakerPanelState(false))).toEqual(notRunning(LEAD_TREE_KEY));

                const panelState = buildRunFakerPanelState();

                expect([
                    { command: 'runFaker', treeKey: 'Opportunity-ONLY' },
                    { command: 'runFaker', treeKey: '__proto__' },
                    { command: 'runFaker', treeKey: [LEAD_TREE_KEY] },
                    { command: 'runFaker' }
                ].map(panelMessage => RecipeCockpitService.routePanelMessage(panelMessage, panelState)))
                    .toEqual([notRunning('Opportunity-ONLY'), notRunning('__proto__'), notRunning(''), notRunning('')]);

                const withoutTargets = buildRunFakerPanelState();
                withoutTargets.treeHistoryTargets = RecipeCockpitTreeHistory.buildEmptyTargets();
                expect(RecipeCockpitService.routePanelMessage({ command: 'runFaker', treeKey: LEAD_TREE_KEY }, withoutTargets)).toEqual(notRunning(LEAD_TREE_KEY));

            });

            it('answers nothing while a run is in flight', () => {

                const panelState = buildRunFakerPanelState();
                panelState.runFakerStateMessage = { command: 'runFakerState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };

                expect(RecipeCockpitService.routePanelMessage({ command: 'runFaker', treeKey: LEAD_TREE_KEY }, panelState)).toBeUndefined();

            });

            it('replays a run still in flight after the model, so a reloaded document keeps its buttons disabled', () => {

                const panelState = buildRunFakerPanelState();
                panelState.runFakerStateMessage = { command: 'runFakerState', isRunning: true, treeKey: LEAD_TREE_KEY };

                const replayedCommands = RecipeCockpitService.buildReplayMessages(panelState).map(hostMessage => hostMessage.command);

                expect(replayedCommands).toEqual(['recipeData', 'runFakerState']);

            });

        });

        describe('the panel script, history tabs', () => {

            const renderHistoryRecipe = (renderSequence = 1, focusTree?: any) => {
                const panel = runPanelScript();
                const loadedRecipe = loadHistoryRecipe();
                panel.postToPanel({ command: 'recipeData', recipe: loadedRecipe.recipeViewModel, renderSequence: renderSequence, ...( focusTree ? { focusTree } : {} ) });
                return { panel, loadedRecipe };
            };

            const textOf = (panel: any, rootElement: any, className: string) => panel.findAll(rootElement, className).map((element: any) => element.textContent);
            const treeCardFolded = (panel: any, folderName: string) => panel.findAll(panel.cockpitBodyElement, 'treeCard')
                .find((treeCard: any) => panel.findAll(treeCard, 'treeFolder')[0]?.textContent === folderName);
            const clickNamed = (panel: any, rootElement: any, className: string, labelText: string) =>
                panel.findAll(rootElement, className).find((element: any) => element.textContent === labelText).dispatch('click');
            const openTab = (panel: any, folderName: string, tabLabel: string) => {
                const treeCard = treeCardFolded(panel, folderName);
                panel.findAll(treeCard, 'treeToggle')[0].dispatch('click');
                clickNamed(panel, treeCard, 'treeTab', tabLabel);
                return treeCard;
            };
            const postedNamed = (panel: any, command: string) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === command);
            // ▶ RUN FAKER AND RESET SELECTION SIT AT THE TOP OF THE TREECIPE TAB (#255), BUILT ON THE CARD'S FIRST EXPAND
            const expandCard = (panel: any, folderName: string) => {
                const treeCard = treeCardFolded(panel, folderName);
                panel.findAll(treeCard, 'treeToggle')[0].dispatch('click');
                return treeCard;
            };

            it('draws no Previous Versions tab, version row or summary, and asks the host for none (#265)', () => {

                const { panel } = renderHistoryRecipe();
                const leadCard = expandCard(panel, 'Lead-ONLY');
                panel.findAll(leadCard, 'treeTab').forEach((tabElement: any) => tabElement.dispatch('click'));

                expect(textOf(panel, leadCard, 'treeTab')).toEqual(['Treecipe', 'Previously Used Data Sets']);
                expect(panel.findAll(leadCard, 'treeVersions')).toEqual([]);
                expect(panel.findAll(leadCard, 'treeVersion')).toEqual([]);
                expect(panel.findAll(leadCard, 'treeVersionToggle')).toEqual([]);
                expect(postedNamed(panel, 'loadVersionSummaries')).toEqual([]);
                expect(postedNamed(panel, 'diffTreeVersion')).toEqual([]);

                // A versionSummaries MESSAGE FROM AN OLDER HOST DRAWS NOTHING AND THROWS NOTHING
                panel.postToPanel({ command: 'versionSummaries', treeKey: LEAD_TREE_KEY, summaries: [{ runFolderName: HISTORY_CURRENT_RUN, isSummaryAvailable: true, fieldCount: 2, changeText: '' }], renderSequence: 1 });
                expect(postedNamed(panel, 'renderFailed')).toEqual([]);

            });

            it('lists every data set of the tree newest first on Previously Used Data Sets, tagged with its version or "version unknown"', () => {

                const { panel } = renderHistoryRecipe();
                const leadCard = openTab(panel, 'Lead-ONLY', 'Previously Used Data Sets');

                expect(textOf(panel, leadCard, 'treeDatasetDate')).toEqual(['2026-09-21 00:00:00 UTC', '2026-09-15 00:00:00 UTC', '2026-09-02 00:00:00 UTC']);
                expect(textOf(panel, leadCard, 'treeDatasetVersion')).toEqual(['current version', 'version unknown', 'version of 2026-09-01 00:00:00 UTC']);
                expect(textOf(panel, leadCard, 'treeDatasetCounts')).toEqual(['Lead: 5 records', 'Lead: 7 records', '']);

            });

            it('reads a legacy data set\'s counts on the Fake Sets tab only when the reader asks for them', () => {

                const { panel } = renderHistoryRecipe(3);
                const leadCard = openTab(panel, 'Lead-ONLY', 'Previously Used Data Sets');

                expect(postedNamed(panel, 'loadDatasetRecordCounts')).toEqual([]);
                expect(textOf(panel, leadCard, 'treeDatasetCountsLoad')).toEqual(['Show record counts']);

                panel.findAll(leadCard, 'treeDatasetCountsLoad')[0].dispatch('click');

                expect(postedNamed(panel, 'loadDatasetRecordCounts')).toEqual([{ command: 'loadDatasetRecordCounts', datasetFolderName: 'dataset-2026-09-02T00-00-00' }]);
                expect(textOf(panel, leadCard, 'treeDatasetCounts')[2]).toBe('Loading record counts…');

                panel.postToPanel({
                    command: 'datasetRecordCounts', datasetFolderName: 'dataset-2026-09-02T00-00-00',
                    recordCounts: [{ objectApiName: 'Lead', recordCount: 3 }], failureMessage: 'Could not count the records in collectionsApi-Broken.json.', renderSequence: 3
                });

                expect(textOf(panel, leadCard, 'treeDatasetCounts')[2]).toBe('Lead: 3 records · Could not count the records in collectionsApi-Broken.json.');

            });

            it('posts Open and Insert by data set name, with the card and tab they came from', () => {

                const { panel } = renderHistoryRecipe();
                const accountCard = openTab(panel, ACCOUNT_TREE_KEY, 'Previously Used Data Sets');

                panel.findAll(accountCard, 'treeDatasetOpen')[0].dispatch('click');
                panel.findAll(accountCard, 'treeDatasetInsert')[0].dispatch('click');

                expect(textOf(panel, accountCard, 'treeDatasetCounts')).toEqual(['Account: 2 records · Contact: 4 records · OtherChildObject__c: 0 records']);
                expect(postedNamed(panel, 'openDataset')).toEqual([{ command: 'openDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00-2', treeKey: ACCOUNT_TREE_KEY, tab: 'datasets' }]);
                expect(postedNamed(panel, 'insertDataset')).toEqual([{ command: 'insertDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00-2', treeKey: ACCOUNT_TREE_KEY, tab: 'datasets' }]);

            });

            it('lists a tree\'s data sets from every run, whichever run is on screen, and draws no history tabs on a card with no history', () => {

                const panel = runPanelScript();
                const loadedRecipe = loadHistoryRecipe('recipe-2026-09-01T00-00-00');
                panel.postToPanel({ command: 'recipeData', recipe: loadedRecipe.recipeViewModel, renderSequence: 1 });

                const leadCard = openTab(panel, 'Lead-ONLY', 'Previously Used Data Sets');
                expect(textOf(panel, leadCard, 'treeDatasetVersion')).toEqual(['version of 2026-09-20 10:00:00 UTC', 'version unknown', 'current version']);

                const withoutHistory = JSON.parse(JSON.stringify(loadedRecipe.recipeViewModel));
                withoutHistory.trees.forEach((tree: any) => { delete tree.history; });
                panel.postToPanel({ command: 'recipeData', recipe: withoutHistory, renderSequence: 2 });

                const bareCard = treeCardFolded(panel, 'Lead-ONLY');
                panel.findAll(bareCard, 'treeToggle')[0].dispatch('click');
                expect(textOf(panel, bareCard, 'treeTab')).toEqual(['Treecipe']);

            });

            it('says when a tree has no data sets at all', () => {

                const panel = runPanelScript();
                const loadedRecipe = loadHistoryRecipe();
                loadedRecipe.recipeViewModel.trees.forEach(tree => { tree.history.datasets = []; });
                panel.postToPanel({ command: 'recipeData', recipe: loadedRecipe.recipeViewModel, renderSequence: 1 });

                const leadCard = openTab(panel, 'Lead-ONLY', 'Previously Used Data Sets');
                expect(textOf(panel, leadCard, 'treeEmpty')).toEqual(['No data sets were made from this tree.']);

            });

            it('re-opens the card and tab a refresh names, after acknowledging the draw', () => {

                const { panel } = renderHistoryRecipe(9, { treeKey: LEAD_TREE_KEY, tab: 'datasets' });
                const leadCard = treeCardFolded(panel, 'Lead-ONLY');

                expect(panel.isHidden(panel.findAll(leadCard, 'treeDatasets')[0])).toBe(false);
                expect(postedNamed(panel, 'rendered')).toHaveLength(1);

            });

            it('searches Previously Used Data Sets by data set folder, and leaves the card\'s other tabs as they were', () => {

                const { panel } = renderHistoryRecipe();
                const leadCard = openTab(panel, 'Lead-ONLY', 'Previously Used Data Sets');
                const datasetsElement = panel.tabPanelOf(leadCard, 'treeDatasets');
                const visibleDatasetFolders = () => panel.findAll(datasetsElement, 'treeDataset')
                    .filter((datasetElement: any) => !panel.isHidden(datasetElement))
                    .map((datasetElement: any) => panel.findAll(datasetElement, 'treeDatasetFolder')[0].textContent);

                panel.typeIntoTabSearch(leadCard, 'treeDatasets', '09-21');

                expect(visibleDatasetFolders()).toEqual(['dataset-2026-09-21T00-00-00']);
                expect(textOf(panel, datasetsElement, 'tabMatchCount')).toEqual(['1 of 3 data sets']);

                // A DATE THE ROW DRAWS ONLY AS A LABEL IS NOT IN ITS FOLDER NAME, AND THE SEARCH SAYS WHAT IT MATCHES
                panel.typeIntoTabSearch(leadCard, 'treeDatasets', 'utc');
                expect(visibleDatasetFolders()).toEqual([]);

                clickNamed(panel, leadCard, 'treeTab', 'Treecipe');
                expect(textOf(panel, panel.tabPanelOf(leadCard, 'treeStructure'), 'tabMatchCount')).toEqual(['2 fields']);
                clickNamed(panel, leadCard, 'treeTab', 'Previously Used Data Sets');
                expect(panel.findAll(datasetsElement, 'tabSearchInput')[0].value).toBe('utc');

            });

            it('draws ▶ Run Faker on each card that has a recipe, naming the file in its tooltip, and none on a card without one', () => {

                const panel = runPanelScript();
                const loadedRecipe = loadHistoryRecipe();
                delete loadedRecipe.recipeViewModel.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY).runFakerRecipeFileName;
                panel.postToPanel({ command: 'recipeData', recipe: loadedRecipe.recipeViewModel, renderSequence: 1 });

                // A FOLDED CARD HAS NO TREECIPE TAB YET, SO NO BUTTON
                expect(panel.findAll(treeCardFolded(panel, 'Lead-ONLY'), 'treeRunFaker')).toEqual([]);

                const leadButtons = panel.findAll(panel.findAll(expandCard(panel, 'Lead-ONLY'), 'treecipeActions')[0], 'treeRunFaker');

                expect(leadButtons.map((button: any) => button.textContent)).toEqual([RECIPE_COCKPIT_RUN_FAKER_ACTION_LABEL]);
                expect(leadButtons[0].attributes.title).toBe('Run Faker by Recipe on recipe--Lead-ONLY-2026-09-20T10-00-00.yml');
                expect(panel.findAll(expandCard(panel, ACCOUNT_TREE_KEY), 'treeRunFaker')).toEqual([]);

            });

            it('posts the tree key on a click and disables every Run Faker until the host says the run ended', () => {

                const { panel } = renderHistoryRecipe(3);
                const leadButton = panel.findAll(expandCard(panel, 'Lead-ONLY'), 'treeRunFaker')[0];
                const accountButton = panel.findAll(expandCard(panel, ACCOUNT_TREE_KEY), 'treeRunFaker')[0];

                leadButton.dispatch('click');
                accountButton.dispatch('click');
                leadButton.dispatch('click');

                expect(postedNamed(panel, 'runFaker')).toEqual([{ command: 'runFaker', treeKey: LEAD_TREE_KEY }]);
                expect([leadButton.disabled, accountButton.disabled]).toEqual([true, true]);
                expect([leadButton.textContent, accountButton.textContent]).toEqual([RECIPE_COCKPIT_RUN_FAKER_RUNNING_LABEL, RECIPE_COCKPIT_RUN_FAKER_ACTION_LABEL]);

                // THE HOST RELOADS THE RUN BEFORE IT SAYS THE RUN ENDED: THE RELOADED CARDS ARE STILL DISABLED
                panel.postToPanel({ command: 'recipeData', recipe: loadHistoryRecipe().recipeViewModel, renderSequence: 4 });
                [ACCOUNT_TREE_KEY, 'Lead-ONLY'].forEach(folderName => {
                    const treeCard = treeCardFolded(panel, folderName);
                    if (panel.findAll(treeCard, 'treeRunFaker').length === 0) { expandCard(panel, folderName); }
                });
                const reloadedButtons = panel.findAll(panel.cockpitBodyElement, 'treeRunFaker');
                expect(reloadedButtons.map((button: any) => button.disabled)).toEqual([true, true]);

                panel.postToPanel({ command: 'runFakerState', isRunning: false, treeKey: LEAD_TREE_KEY });

                expect(reloadedButtons.map((button: any) => [button.disabled, button.textContent])).toEqual([
                    [false, RECIPE_COCKPIT_RUN_FAKER_ACTION_LABEL],
                    [false, RECIPE_COCKPIT_RUN_FAKER_ACTION_LABEL]
                ]);

                reloadedButtons[0].dispatch('click');
                expect(postedNamed(panel, 'runFaker')).toHaveLength(2);

            });

            it('disables every Run Faker when a reloaded document is told a run is still in flight', () => {

                const { panel } = renderHistoryRecipe();

                panel.postToPanel({ command: 'runFakerState', isRunning: true, treeKey: ACCOUNT_TREE_KEY });
                expandCard(panel, ACCOUNT_TREE_KEY);
                expandCard(panel, 'Lead-ONLY');

                const runFakerButtons = panel.findAll(panel.cockpitBodyElement, 'treeRunFaker');
                expect(runFakerButtons.map((button: any) => [button.disabled, button.textContent])).toEqual([
                    [true, RECIPE_COCKPIT_RUN_FAKER_RUNNING_LABEL],
                    [true, RECIPE_COCKPIT_RUN_FAKER_ACTION_LABEL]
                ]);

            });

            describe('the header row tile', () => {

                const headerOf = (treeCard: any) => treeCard.children[0];
                const isOpen = (panel: any, treeCard: any) => !panel.isHidden(treeCard.children[1]);

                it('opens and closes the card from a click anywhere on the row, and from its ▸ toggle', () => {

                    const { panel } = renderHistoryRecipe();
                    const leadCard = treeCardFolded(panel, 'Lead-ONLY');
                    const toggleElement = panel.findAll(leadCard, 'treeToggle')[0];

                    headerOf(leadCard).dispatch('click');
                    expect(isOpen(panel, leadCard)).toBe(true);
                    expect(toggleElement.attributes['aria-expanded']).toBe('true');

                    panel.findAll(leadCard, 'treeTitle')[0].dispatch('click');
                    expect(isOpen(panel, leadCard)).toBe(false);

                    panel.findAll(leadCard, 'treeFolder')[0].dispatch('click');
                    expect(isOpen(panel, leadCard)).toBe(true);

                    toggleElement.dispatch('click');
                    expect(isOpen(panel, leadCard)).toBe(false);
                    expect(toggleElement.attributes['aria-expanded']).toBe('false');

                });

                // #217 TOOK 🔍 OUT: EACH TAB HAS ITS OWN SEARCH, SO THERE IS NO PANEL-WIDE ONE TO SCOPE
                // #255 MOVED ▶ RUN FAKER AND RESET SELECTION INTO THE TREECIPE TAB; #263 TOOK REGENERATE OUT OF IT
                it('keeps only ☆ and ✎ in the row\'s action group, and puts ▶ Run Faker and Reset selection at the top of the Treecipe tab', () => {

                    const { panel } = renderHistoryRecipe();
                    const leadCard = treeCardFolded(panel, 'Lead-ONLY');
                    const headerChildren = headerOf(leadCard).children;
                    const actionGroup = headerChildren[headerChildren.length - 1];

                    expect(actionGroup.classList.contains('treeHeaderActions')).toBe(true);
                    expect(actionGroup.children.map((actionElement: any) => actionElement.className)).toEqual(['treeFavorite', 'treeRename']);
                    expect(panel.findAll(panel.cockpitBodyElement, 'treeScope')).toEqual([]);

                    expandCard(panel, 'Lead-ONLY');

                    expect(panel.findAll(actionGroup, 'treeRunFaker')).toEqual([]);
                    expect(panel.findAll(actionGroup, 'treeResetSelection')).toEqual([]);
                    const treecipeHeader = panel.findAll(panel.tabPanelOf(leadCard, 'treeStructure'), 'treecipeHeader')[0];
                    const treecipeActions = panel.findAll(treecipeHeader, 'treecipeActions')[0];
                    expect(treecipeActions.children.map((actionElement: any) => actionElement.className)).toEqual(['treeRunFaker', 'treeResetSelection hidden']);

                });

                it('draws no Regenerate recipe button or note in any card', () => {

                    const { panel } = renderHistoryRecipe();
                    const accountCard = expandCard(panel, ACCOUNT_TREE_KEY);
                    const leadCard = expandCard(panel, 'Lead-ONLY');

                    [accountCard, leadCard].forEach((treeCard: any) => {
                        expect(panel.findAll(treeCard, 'regenerateRecipe')).toEqual([]);
                        expect(panel.findAll(treeCard, 'regenerateNote')).toEqual([]);
                    });

                });

                it('runs Faker from ▶ Run Faker without closing the card, and a DISABLED one neither toggles nor posts', () => {

                    const { panel } = renderHistoryRecipe();
                    const leadCard = expandCard(panel, 'Lead-ONLY');
                    const accountCard = expandCard(panel, ACCOUNT_TREE_KEY);
                    const leadButton = panel.findAll(leadCard, 'treeRunFaker')[0];
                    const accountButton = panel.findAll(accountCard, 'treeRunFaker')[0];

                    leadButton.dispatch('click');

                    expect(postedNamed(panel, 'runFaker')).toEqual([{ command: 'runFaker', treeKey: LEAD_TREE_KEY }]);
                    expect(isOpen(panel, leadCard)).toBe(true);

                    expect(accountButton.disabled).toBe(true);
                    accountButton.dispatch('click');

                    expect(postedNamed(panel, 'runFaker')).toHaveLength(1);
                    expect(isOpen(panel, accountCard)).toBe(true);

                });

            });

            it('writes every name from disk as text, so a data set folder named like markup stays text', () => {

                const panel = runPanelScript();
                const loadedRecipe = loadHistoryRecipe();
                const leadTree = loadedRecipe.recipeViewModel.trees.find(tree => tree.treeKey === LEAD_TREE_KEY);
                leadTree.history.datasets[0].datasetFolderName = '<img src=x onerror=alert(1)>';
                panel.postToPanel({ command: 'recipeData', recipe: loadedRecipe.recipeViewModel, renderSequence: 1 });

                const leadCard = openTab(panel, 'Lead-ONLY', 'Previously Used Data Sets');

                expect(textOf(panel, leadCard, 'treeDatasetFolder')[0]).toBe('<img src=x onerror=alert(1)>');
                expect(panel.findAll(leadCard, 'img')).toEqual([]);

            });

        });

    });

    describe('openRecipeCockpitPanel', () => {

        let createdWebviewPanel: any;
        let registeredDisposeHandler: () => void;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let registeredMessageSubscriptions: { dispose: jest.Mock }[];
        let postedPanelMessages: any[];
        let createdStatusBarItems: { text: string; dispose: jest.Mock }[];

        // WHAT THE REAL PANEL ECHOES: THE SEQUENCE OF THE LAST MODEL IT WAS POSTED
        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;

        function buildFakeWebviewPanel() {

            return {
                reveal: jest.fn(),
                dispose: jest.fn(),
                onDidDispose: jest.fn().mockImplementation((disposeHandler: () => void) => {
                    registeredDisposeHandler = disposeHandler;
                    return { dispose: jest.fn() };
                }),
                webview: {
                    html: '',
                    postMessage: jest.fn().mockImplementation((hostMessage: any) => {
                        postedPanelMessages.push(hostMessage);
                        return Promise.resolve(true);
                    }),
                    onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: (panelMessage: any) => Promise<void>) => {
                        receivedMessageHandler = messageHandler;
                        const messageSubscription = { dispose: jest.fn() };
                        registeredMessageSubscriptions.push(messageSubscription);
                        return messageSubscription;
                    })
                }
            };

        }

        beforeEach(() => {

            postedPanelMessages = [];
            registeredMessageSubscriptions = [];
            createdStatusBarItems = [];

            createdWebviewPanel = buildFakeWebviewPanel();

            // THESE LIVE ON THE MODULE FACTORY RATHER THAN ON A SPY, SO restoreMocks DOES NOT REACH THEM
            (vscode.window.createWebviewPanel as jest.Mock).mockClear();
            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => createdWebviewPanel);

            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => {
                const statusBarItem = { text: initialMessage, dispose: jest.fn() };
                createdStatusBarItems.push(statusBarItem);
                return statusBarItem as any;
            });

            // THE PANEL IS HELD ON THE CLASS SO IT CAN BE REUSED ACROSS INVOCATIONS, SO IT SURVIVES BETWEEN TESTS UNLESS CLEARED
            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        it('opens a scripted panel that is granted no local resource root at all', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);

            expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);

            const [actualViewType, actualPanelTitle, actualViewColumn, actualPanelOptions] =
                (vscode.window.createWebviewPanel as jest.Mock).mock.calls[0];

            expect(actualViewType).toBe(RECIPE_COCKPIT_VIEW_TYPE);
            expect(actualPanelTitle).toBe(RECIPE_COCKPIT_PANEL_TITLE);
            expect(actualViewColumn).toBe(vscode.ViewColumn.One);
            expect(actualPanelOptions).toEqual({ enableScripts: true, localResourceRoots: [] });
            expect(createdWebviewPanel.reveal).toHaveBeenCalled();

        });

        it('reports each phase in the status bar and clears it when the load ends', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);

            expect(createdStatusBarItems).toHaveLength(1);
            expect(createdStatusBarItems[0].text).toContain(RECIPE_COCKPIT_LOAD_PHASES.readingRun);
            expect(createdStatusBarItems[0].dispose).toHaveBeenCalled();

        });

        // A WEBVIEW THAT HAS NOT FINISHED LOADING DROPS WHAT IS POSTED TO IT, AND POSTING TWICE WOULD RENDER TWICE
        it('posts nothing before the panel is ready, then replays the loaded recipe once it is', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);

            expect(postedPanelMessages).toEqual([]);

            await receivedMessageHandler({ command: 'ready' });

            const expectedRecipe = RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT);
            RecipeCockpitService.applyObjectSelections(expectedRecipe, new Map());
            expect(postedPanelMessages).toEqual([{
                command: 'recipeData',
                recipe: expectedRecipe,
                renderSequence: expect.any(Number)
            }]);

        });

        it('given a ready panel, posts each phase of a later load as it happens', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            postedPanelMessages.length = 0;

            await receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });

            expect(postedPanelMessages.map(hostMessage => hostMessage.command)).toEqual(['loadPhase', 'loadPhase', 'recipeData']);
            expect(postedPanelMessages[2].recipe.selectedRunFolderName).toBe(FAKER_JS_RUN_FOLDER_NAME);

        });

        /*
            The allow-lists are built when the model is posted but honoured only once the panel says
            it drew it -- a post succeeding says the message left the host, not that a row is on
            screen for the click to have come from.
        */
        it('opens a recipe line only after the panel has confirmed drawing the row it came from', async () => {

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });

            await receivedMessageHandler({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });
            expect(openFileInEditorSpy).not.toHaveBeenCalled();

            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await receivedMessageHandler({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });

            expect(openFileInEditorSpy).toHaveBeenCalledWith(LATEST_RECIPE_FILE_PATH, 12);

        });

        it('posts a picklist row\'s values only once the panel has confirmed drawing it, and stops on a reload', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });

            const postedPicklistValues = () => postedPanelMessages.filter(hostMessage => hostMessage.command === 'picklistValues');
            const loadIndustryValues = () => receivedMessageHandler({ command: 'loadPicklistValues', objectApiName: 'Account', fieldApiName: 'Industry' });

            await loadIndustryValues();
            expect(postedPicklistValues()).toEqual([]);

            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await loadIndustryValues();

            expect(postedPicklistValues()).toEqual([{
                command: 'picklistValues',
                objectApiName: 'Account',
                fieldApiName: 'Industry',
                picklistValues: [],
                recordTypePicklistValues: [],
                renderSequence: lastRenderSequence()
            }]);

            await receivedMessageHandler({ command: 'ready' });
            await loadIndustryValues();

            expect(postedPicklistValues()).toHaveLength(1);

        });

        // EVERY RELOAD OF THE DOCUMENT PUTS THE PANEL BACK TO "NOTHING DRAWN" UNTIL THE REPLAY IS
        it('given the panel reloads, refuses actions until the replayed recipe is drawn again', async () => {

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await receivedMessageHandler({ command: 'ready' });

            await receivedMessageHandler({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });

            expect(openFileInEditorSpy).not.toHaveBeenCalled();

        });

        it('given a failure to draw, empties the allow-lists and reports it once', async () => {

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await receivedMessageHandler({ command: 'renderFailed', phase: 'render', message: 'boom' });
            await receivedMessageHandler({ command: 'renderFailed', phase: 'render', message: 'boom' });
            await receivedMessageHandler({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });

            expect(handleCapturedErrorSpy).toHaveBeenCalledTimes(1);
            expect(handleCapturedErrorSpy.mock.calls[0][0].message).toContain('boom');
            expect(handleCapturedErrorSpy.mock.calls[0][1]).toBe('openRecipeCockpit');
            expect(openFileInEditorSpy).not.toHaveBeenCalled();

        });

        it('given the recipe file now resolves outside the workspace, warns instead of opening it', async () => {

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            const showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });

            // A SYMLINK SWAPPED IN AFTER THE MODEL WAS BUILT
            jest.spyOn(SfdxProjectService, 'isPathContainedInWorkspace').mockReturnValue(false);
            await receivedMessageHandler({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });

            expect(openFileInEditorSpy).not.toHaveBeenCalled();
            expect(String(showWarningMessageSpy.mock.calls[0][0])).toContain('outside this workspace');

        });

        it('given the recipe file was deleted since the render, warns instead of opening it', async () => {

            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            const showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            jest.spyOn(fs, 'existsSync').mockReturnValue(false);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await receivedMessageHandler({ command: 'openSource', filePath: LATEST_RECIPE_FILE_PATH, lineNumber: 12 });

            expect(openFileInEditorSpy).not.toHaveBeenCalled();
            expect(showWarningMessageSpy).toHaveBeenCalledTimes(1);

        });

        /*
            A load that throws puts the failure in the panel and still reaches the command's error
            handler, which is the one that reports it.
        */
        it('given the load throws, shows the failure in the panel and rethrows it to the command', async () => {

            jest.spyOn(RecipeCockpitService, 'findGeneratedRecipeRuns').mockImplementation(() => {
                throw new Error('EACCES');
            });

            await expect(RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT)).rejects.toThrow('EACCES');

            await receivedMessageHandler({ command: 'ready' });

            expect(postedPanelMessages).toEqual([{ command: 'loadFailed', message: 'The Recipe Cockpit could not finish loading: EACCES' }]);
            expect(createdStatusBarItems[0].dispose).toHaveBeenCalled();

        });

        it('given a run chosen from the panel fails to load, routes the error through ErrorHandlingService', async () => {

            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });

            jest.spyOn(RecipeCockpitService, 'loadRecipeRunByRuns').mockImplementation(() => {
                throw new Error('EIO');
            });
            await receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });

            expect(handleCapturedErrorSpy).toHaveBeenCalledTimes(1);
            expect(handleCapturedErrorSpy.mock.calls[0][1]).toBe('openRecipeCockpit');
            expect(postedPanelMessages).toContainEqual({ command: 'loadFailed', message: 'The Recipe Cockpit could not finish loading: EIO' });

        });

        /*
            A run chosen while another is still loading supersedes it. The superseded load must not
            render over the one the reader asked for last, whichever finishes first.
        */
        it('given a second run is chosen before the first finishes loading, renders only the second', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            postedPanelMessages.length = 0;

            const firstSelection = receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });
            const secondSelection = receivedMessageHandler({ command: 'selectRun', runFolderName: LATEST_RUN_FOLDER_NAME });
            await Promise.all([firstSelection, secondSelection]);

            const renderedRunFolderNames = postedPanelMessages
                .filter(hostMessage => hostMessage.command === 'recipeData')
                .map(hostMessage => hostMessage.recipe.selectedRunFolderName);

            expect(renderedRunFolderNames).toEqual([LATEST_RUN_FOLDER_NAME]);

        });

        it('given a superseded load throws, neither shows nor reports its failure', async () => {

            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            postedPanelMessages.length = 0;

            const loadRecipeRunByRuns = RecipeCockpitService.loadRecipeRunByRuns.bind(RecipeCockpitService);
            jest.spyOn(RecipeCockpitService, 'loadRecipeRunByRuns').mockImplementation((recipeRuns, workspaceRoot, requestedRunFolderName) => {
                if ( requestedRunFolderName === FAKER_JS_RUN_FOLDER_NAME ) {
                    throw new Error('EIO');
                }
                return loadRecipeRunByRuns(recipeRuns, workspaceRoot, requestedRunFolderName);
            });

            /*
                The first load is let through its first phase so it is inside the reading phase --
                past every isCurrentLoad check -- when the second supersedes it. Started together,
                the first would bail out at a check and never reach the throw this is about.
            */
            const firstSelection = receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });
            await new Promise(resolveTick => setImmediate(resolveTick));
            const secondSelection = receivedMessageHandler({ command: 'selectRun', runFolderName: LATEST_RUN_FOLDER_NAME });
            await Promise.all([firstSelection, secondSelection]);

            expect(RecipeCockpitService.loadRecipeRunByRuns).toHaveBeenCalledWith(expect.anything(), MOCK_WORKSPACE_ROOT, FAKER_JS_RUN_FOLDER_NAME);
            expect(handleCapturedErrorSpy).not.toHaveBeenCalled();
            expect(postedPanelMessages.map(hostMessage => hostMessage.command)).not.toContain('loadFailed');

        });

        it('given the panel is closed while it loads, renders nothing into it', async () => {

            const openingLoad = RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            registeredDisposeHandler();
            await openingLoad;

            expect(postedPanelMessages).toBeEmpty();
            expect(createdStatusBarItems[0].dispose).toHaveBeenCalled();

        });

        it('given the load throws something that is not an Error, still says what it was', async () => {

            const nonErrorThrowable: unknown = 'EACCES';
            jest.spyOn(RecipeCockpitService, 'findGeneratedRecipeRuns').mockImplementation(() => {
                throw nonErrorThrowable;
            });

            await expect(RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT)).rejects.toBe('EACCES');
            await receivedMessageHandler({ command: 'ready' });

            expect(postedPanelMessages).toEqual([{ command: 'loadFailed', message: 'The Recipe Cockpit could not finish loading: EACCES' }]);

        });

        it('given the command is run again, reveals the panel the window already has rather than opening a duplicate', async () => {

            const firstCockpitPanel = await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            const secondCockpitPanel = await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);

            expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
            expect(secondCockpitPanel).toBe(firstCockpitPanel);
            expect(createdWebviewPanel.reveal).toHaveBeenCalledTimes(2);

        });

        it('given the command is run again, builds the reused panel a document with a fresh nonce', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            const firstShellHtml = createdWebviewPanel.webview.html;

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            const secondShellHtml = createdWebviewPanel.webview.html;

            const readNonce = (shellHtml: string) => shellHtml.match(/<script nonce="([A-Za-z0-9]{32})">/)?.[1];

            expect(readNonce(firstShellHtml)).toMatch(/^[A-Za-z0-9]{32}$/);
            expect(readNonce(secondShellHtml)).not.toBe(readNonce(firstShellHtml));

        });

        // TWO LISTENERS ANSWERING ONE "ready" WOULD REPLAY THE MODEL TWICE
        it('given the command is run again, disposes the subscription it is replacing', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);

            expect(registeredMessageSubscriptions).toHaveLength(2);
            expect(registeredMessageSubscriptions[0].dispose).toHaveBeenCalled();
            expect(registeredMessageSubscriptions[1].dispose).not.toHaveBeenCalled();

        });

        it('given an unrecognized command, posts nothing back', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);

            await receivedMessageHandler({ command: 'traverseRecipe' });

            expect(postedPanelMessages).toBeEmpty();

        });

        // POSTING TO A DISPOSED WEBVIEW THROWS, AND THAT WOULD REACH THE USER AS AN ERROR FOR CLOSING A TAB
        it('given the panel was closed before its message was handled, posts nothing back', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);

            registeredDisposeHandler();
            await receivedMessageHandler({ command: 'ready' });

            expect(postedPanelMessages).toBeEmpty();

        });

        it('given the panel was closed, opens a new one the next time the command is run', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
            registeredDisposeHandler();

            expect(registeredMessageSubscriptions[0].dispose).toHaveBeenCalled();

            createdWebviewPanel = buildFakeWebviewPanel();
            await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);

            expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);

        });

        describe('the history tabs', () => {

            const LEAD_TREE_KEY = 'Lead-ONLY';
            const FAKER_JS_LEAD_RUN = 'recipe-fakerjs-2026-09-10T00-00-00';
            const OLDEST_LEAD_RUN = 'recipe-2026-09-01T00-00-00';
            const LEGACY_DATASET = 'dataset-2026-09-02T00-00-00';
            const RECORDED_DATASET = 'dataset-2026-09-21T00-00-00';

            let showWarningMessageSpy: jest.SpyInstance;
            let temporaryWorkspaceRoots: string[];

            const executedCommandsNamed = (commandName: string) => (vscode.commands.executeCommand as jest.Mock).mock.calls
                .filter(commandCall => commandCall[0] === commandName);

            const openRenderedHistoryCockpit = async (workspaceRoot = HISTORY_WORKSPACE_ROOT) => {
                await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot);
                await receivedMessageHandler({ command: 'ready' });
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            };

            // A COPY, SO A TEST CAN DELETE WHAT THE MODEL NAMED AFTER IT WAS DRAWN
            const copyHistoryWorkspace = () => {
                const temporaryWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-history-'));
                fs.cpSync(HISTORY_WORKSPACE_ROOT, temporaryWorkspaceRoot, { recursive: true });
                temporaryWorkspaceRoots.push(temporaryWorkspaceRoot);
                return temporaryWorkspaceRoot;
            };

            beforeEach(() => {
                temporaryWorkspaceRoots = [];
                (vscode.commands.executeCommand as jest.Mock).mockReset();
                showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            });

            afterEach(() => {
                temporaryWorkspaceRoots.forEach(temporaryWorkspaceRoot => fs.rmSync(temporaryWorkspaceRoot, { recursive: true, force: true }));
            });

            it('opens no diff and reads no wrapper for the removed Previous Versions tab, even once the model is drawn (#265)', async () => {

                const readFileSpy = jest.spyOn(fs, 'readFileSync');
                await openRenderedHistoryCockpit();
                readFileSpy.mockClear();
                postedPanelMessages.length = 0;

                await receivedMessageHandler({ command: 'diffTreeVersion', treeKey: LEAD_TREE_KEY, runFolderName: OLDEST_LEAD_RUN });
                await receivedMessageHandler({ command: 'diffTreeVersion', treeKey: LEAD_TREE_KEY, runFolderName: FAKER_JS_LEAD_RUN });
                await receivedMessageHandler({ command: 'loadVersionSummaries', treeKey: LEAD_TREE_KEY });

                expect(executedCommandsNamed('vscode.diff')).toEqual([]);
                expect(postedPanelMessages).toEqual([]);
                expect(readFileSpy.mock.calls.filter(([filePath]) => String(filePath).includes('treecipeObjectsWrapper'))).toEqual([]);

            });

            it('counts a legacy data set\'s records from its Collections API files, and says which file it could not read', async () => {

                await openRenderedHistoryCockpit();
                await receivedMessageHandler({ command: 'loadDatasetRecordCounts', datasetFolderName: LEGACY_DATASET });
                await receivedMessageHandler({ command: 'loadDatasetRecordCounts', datasetFolderName: RECORDED_DATASET });

                expect(postedPanelMessages.filter(hostMessage => hostMessage.command === 'datasetRecordCounts')).toEqual([{
                    command: 'datasetRecordCounts',
                    datasetFolderName: LEGACY_DATASET,
                    recordCounts: [{ objectApiName: 'Lead', recordCount: 3 }],
                    failureMessage: 'Could not count the records in collectionsApi-Broken.json.',
                    renderSequence: lastRenderSequence()
                }]);

            });

            it('reveals a data set folder in the Explorer, and hands one to Insert Data Set by Directory pre-selected', async () => {

                await openRenderedHistoryCockpit();
                await receivedMessageHandler({ command: 'openDataset', datasetFolderName: RECORDED_DATASET });
                await receivedMessageHandler({ command: 'insertDataset', datasetFolderName: RECORDED_DATASET });

                const datasetFolderPath = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'FakeDataSets', RECORDED_DATASET);

                expect(executedCommandsNamed('revealInExplorer')).toEqual([['revealInExplorer', vscode.Uri.file(datasetFolderPath)]]);
                expect(executedCommandsNamed(RECIPE_COCKPIT_INSERT_DATASET_COMMAND)).toEqual([[RECIPE_COCKPIT_INSERT_DATASET_COMMAND, datasetFolderPath]]);

            });

            it('stops honouring every history action when the document reloads, until the replayed model is drawn', async () => {

                await openRenderedHistoryCockpit();
                await receivedMessageHandler({ command: 'ready' });

                await receivedMessageHandler({ command: 'openDataset', datasetFolderName: RECORDED_DATASET });
                await receivedMessageHandler({ command: 'insertDataset', datasetFolderName: RECORDED_DATASET });
                await receivedMessageHandler({ command: 'loadDatasetRecordCounts', datasetFolderName: LEGACY_DATASET });

                expect((vscode.commands.executeCommand as jest.Mock).mock.calls).toEqual([]);
                expect(postedPanelMessages.filter(hostMessage => hostMessage.command === 'datasetRecordCounts')).toEqual([]);

            });

            it('given a data set deleted after the draw, says it no longer exists and reloads the run with the reader\'s card and tab open', async () => {

                const temporaryWorkspaceRoot = copyHistoryWorkspace();

                await openRenderedHistoryCockpit(temporaryWorkspaceRoot);
                fs.rmSync(path.join(temporaryWorkspaceRoot, 'treecipe', 'FakeDataSets', RECORDED_DATASET), { recursive: true });
                postedPanelMessages.length = 0;

                await receivedMessageHandler({ command: 'insertDataset', datasetFolderName: RECORDED_DATASET, treeKey: LEAD_TREE_KEY, tab: 'datasets' });

                expect(executedCommandsNamed(RECIPE_COCKPIT_INSERT_DATASET_COMMAND)).toEqual([]);
                expect(showWarningMessageSpy).toHaveBeenCalledWith(`The data set "${RECORDED_DATASET}" no longer exists in this workspace. The Recipe Cockpit has reloaded its data sets.`);

                const reloadedRecipeData = postedPanelMessages.find(hostMessage => hostMessage.command === 'recipeData');
                const reloadedLeadTree = reloadedRecipeData.recipe.trees.find((tree: any) => tree.treeKey === LEAD_TREE_KEY);

                expect(reloadedRecipeData.focusTree).toEqual({ treeKey: LEAD_TREE_KEY, tab: 'datasets' });
                // THE SAME RUN, SO THE PANEL MATCHES THE PLACE BY RUN NAME; ONLY Regenerate CARRIES IT ACROSS RUNS
                expect(reloadedRecipeData.carryPlaceAcrossRuns).toBeUndefined();
                expect(reloadedRecipeData.recipe.selectedRunFolderName).toBe(HISTORY_CURRENT_RUN);
                expect(reloadedLeadTree.history.datasets.map((dataset: any) => dataset.datasetFolderName)).not.toContain(RECORDED_DATASET);

                // A FOCUS IS FOR THE ONE DRAW AFTER THE RELOAD -- A REVEAL LATER MUST NOT RE-OPEN A CARD THE READER HAS CLOSED SINCE
                postedPanelMessages.length = 0;
                await receivedMessageHandler({ command: 'ready' });

                expect(postedPanelMessages.find(hostMessage => hostMessage.command === 'recipeData')).not.toHaveProperty('focusTree');

            });

            it('given a data set deleted after the draw, refuses to open it and drops a focus that names no history tab', async () => {

                const temporaryWorkspaceRoot = copyHistoryWorkspace();

                await openRenderedHistoryCockpit(temporaryWorkspaceRoot);
                fs.rmSync(path.join(temporaryWorkspaceRoot, 'treecipe', 'FakeDataSets', RECORDED_DATASET), { recursive: true });
                postedPanelMessages.length = 0;

                await receivedMessageHandler({ command: 'openDataset', datasetFolderName: RECORDED_DATASET, treeKey: LEAD_TREE_KEY, tab: 'treecipe' });

                expect(executedCommandsNamed('revealInExplorer')).toEqual([]);
                expect(showWarningMessageSpy).toHaveBeenCalledTimes(1);
                expect(postedPanelMessages.find(hostMessage => hostMessage.command === 'recipeData')).not.toHaveProperty('focusTree');

            });

            it('given a legacy data set deleted before its counts are read, says it is gone rather than counting nothing', async () => {

                const temporaryWorkspaceRoot = copyHistoryWorkspace();

                await openRenderedHistoryCockpit(temporaryWorkspaceRoot);
                fs.rmSync(path.join(temporaryWorkspaceRoot, 'treecipe', 'FakeDataSets', LEGACY_DATASET), { recursive: true });

                await receivedMessageHandler({ command: 'loadDatasetRecordCounts', datasetFolderName: LEGACY_DATASET });

                expect(postedPanelMessages.filter(hostMessage => hostMessage.command === 'datasetRecordCounts')).toEqual([
                    expect.objectContaining({ recordCounts: [], failureMessage: 'This data set is no longer in the workspace.' })
                ]);

            });

            it('given a legacy data set whose every Collections API file reads, reports no failure', async () => {

                const temporaryWorkspaceRoot = copyHistoryWorkspace();
                fs.rmSync(path.join(temporaryWorkspaceRoot, 'treecipe', 'FakeDataSets', LEGACY_DATASET, 'DatasetFilesForCollectionsApi', 'collectionsApi-Broken.json'));

                await openRenderedHistoryCockpit(temporaryWorkspaceRoot);
                await receivedMessageHandler({ command: 'loadDatasetRecordCounts', datasetFolderName: LEGACY_DATASET });

                expect(postedPanelMessages.filter(hostMessage => hostMessage.command === 'datasetRecordCounts')).toEqual([
                    expect.objectContaining({ recordCounts: [{ objectApiName: 'Lead', recordCount: 3 }], failureMessage: '' })
                ]);

            });

            it('given a legacy data set whose Collections API folder resolves outside the workspace, does not count it', async () => {

                const temporaryWorkspaceRoot = copyHistoryWorkspace();
                const outsideFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-outside-'));
                temporaryWorkspaceRoots.push(outsideFolderPath);
                const collectionsApiFolderPath = path.join(temporaryWorkspaceRoot, 'treecipe', 'FakeDataSets', LEGACY_DATASET, 'DatasetFilesForCollectionsApi');
                fs.writeFileSync(path.join(outsideFolderPath, 'collectionsApi-Secret.json'), JSON.stringify({ records: [{}] }));
                fs.rmSync(collectionsApiFolderPath, { recursive: true });
                fs.symlinkSync(outsideFolderPath, collectionsApiFolderPath, 'dir');

                await openRenderedHistoryCockpit(temporaryWorkspaceRoot);
                await receivedMessageHandler({ command: 'loadDatasetRecordCounts', datasetFolderName: LEGACY_DATASET });

                expect(postedPanelMessages.filter(hostMessage => hostMessage.command === 'datasetRecordCounts')).toEqual([
                    expect.objectContaining({ recordCounts: [], failureMessage: expect.stringContaining('resolves outside the workspace') })
                ]);

            });

            describe('Run Faker', () => {

                const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';

                const writeDatasetMadeBy = (workspaceRoot: string, recipeFilePath: string) => {
                    const datasetSourceFolderPath = path.join(workspaceRoot, 'treecipe', 'FakeDataSets', 'dataset-2026-09-22T00-00-00', 'BaseArtifactFiles');
                    fs.mkdirSync(datasetSourceFolderPath, { recursive: true });
                    fs.writeFileSync(path.join(datasetSourceFolderPath, 'datasetSource.json'), JSON.stringify({
                        schemaVersion: 1,
                        origin: 'runFaker',
                        recipeRunFolderName: HISTORY_CURRENT_RUN,
                        recipeTreeFolderName: LEAD_TREE_KEY,
                        recipeFileName: path.basename(recipeFilePath),
                        fakerService: 'snowfakery',
                        generatedAt: '2026-09-22T00:00:00.000Z',
                        recordCountsByObject: { Lead: 1 }
                    }));
                };

                const runFakerStates = () => postedPanelMessages.filter(hostMessage => hostMessage.command === 'runFakerState');
                const reloadedLeadTree = () => postedPanelMessages.filter(hostMessage => hostMessage.command === 'recipeData').at(-1)
                    .recipe.trees.find((tree: any) => tree.treeKey === LEAD_TREE_KEY);

                it('hands the tree\'s recipe file to Run Faker by Recipe, then adds the data set it wrote to the card in place (#226)', async () => {

                    const temporaryWorkspaceRoot = copyHistoryWorkspace();
                    const leadRecipeFilePath = path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes', HISTORY_CURRENT_RUN, LEAD_TREE_KEY, 'recipe--Lead-ONLY-2026-09-20T10-00-00.yml');
                    (vscode.commands.executeCommand as jest.Mock).mockImplementation(async (commandName: string, recipeFilePath: string) => {
                        if ( commandName === RECIPE_COCKPIT_RUN_FAKER_COMMAND ) {
                            writeDatasetMadeBy(temporaryWorkspaceRoot, recipeFilePath);
                            return path.join(temporaryWorkspaceRoot, 'treecipe', 'FakeDataSets', 'dataset-2026-09-22T00-00-00');
                        }
                        return undefined;
                    });

                    await openRenderedHistoryCockpit(temporaryWorkspaceRoot);
                    const renderSequence = lastRenderSequence();
                    postedPanelMessages.length = 0;

                    await receivedMessageHandler({ command: 'runFaker', treeKey: LEAD_TREE_KEY });

                    expect(executedCommandsNamed(RECIPE_COCKPIT_RUN_FAKER_COMMAND)).toEqual([[RECIPE_COCKPIT_RUN_FAKER_COMMAND, leadRecipeFilePath]]);
                    expect(postedPanelMessages.map(hostMessage => hostMessage.command).filter(command => ['runFakerState', 'recipeData', 'datasetAdded'].includes(command)))
                        .toEqual(['runFakerState', 'datasetAdded', 'runFakerState']);
                    expect(runFakerStates()).toEqual([
                        { command: 'runFakerState', isRunning: true, treeKey: LEAD_TREE_KEY },
                        { command: 'runFakerState', isRunning: false, treeKey: LEAD_TREE_KEY }
                    ]);
                    expect(postedPanelMessages.find(hostMessage => hostMessage.command === 'datasetAdded')).toEqual({
                        command: 'datasetAdded',
                        treeKeys: [LEAD_TREE_KEY],
                        dataset: {
                            datasetFolderName: 'dataset-2026-09-22T00-00-00',
                            generatedAtLabel: '2026-09-22 00:00:00 UTC',
                            fakerService: 'snowfakery',
                            runFolderName: HISTORY_CURRENT_RUN,
                            recordCounts: [{ objectApiName: 'Lead', recordCount: 1 }]
                        },
                        renderSequence: renderSequence,
                        updateSequence: 1
                    });

                    // NOTHING IS LEFT IN FLIGHT: A REVEAL REPLAYS NO RUN BUT THE NEW DATA SET, AND A SECOND RUN IS ROUTED ONCE IT IS DRAWN
                    postedPanelMessages.length = 0;
                    await receivedMessageHandler({ command: 'ready' });
                    expect(runFakerStates()).toEqual([]);
                    expect(reloadedLeadTree().history.datasets[0]).toMatchObject({ datasetFolderName: 'dataset-2026-09-22T00-00-00', runFolderName: HISTORY_CURRENT_RUN });
                    await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                    await receivedMessageHandler({ command: 'runFaker', treeKey: LEAD_TREE_KEY });
                    expect(executedCommandsNamed(RECIPE_COCKPIT_RUN_FAKER_COMMAND)).toHaveLength(2);

                });

                it('reloads the run on the card\'s Previously Used Data Sets as before when the data set it wrote cannot be placed on a card', async () => {

                    const temporaryWorkspaceRoot = copyHistoryWorkspace();
                    const looseDatasetFolderPath = path.join(temporaryWorkspaceRoot, 'treecipe', 'FakeDataSets', 'dataset-2026-09-16T00-00-00');
                    (vscode.commands.executeCommand as jest.Mock).mockImplementation(async (commandName: string) => (
                        commandName === RECIPE_COCKPIT_RUN_FAKER_COMMAND ? looseDatasetFolderPath : undefined
                    ));

                    await openRenderedHistoryCockpit(temporaryWorkspaceRoot);
                    postedPanelMessages.length = 0;

                    await receivedMessageHandler({ command: 'runFaker', treeKey: LEAD_TREE_KEY });

                    expect(postedPanelMessages.some(hostMessage => hostMessage.command === 'datasetAdded')).toBe(false);
                    expect(postedPanelMessages.find(hostMessage => hostMessage.command === 'recipeData').focusTree).toEqual({ treeKey: LEAD_TREE_KEY, tab: 'datasets' });
                    expect(runFakerStates().at(-1)).toEqual({ command: 'runFakerState', isRunning: false, treeKey: LEAD_TREE_KEY });

                });

                it('refuses a second Run Faker while the first is running, and replays the running state to a reloaded document', async () => {

                    let finishRun: () => void;
                    (vscode.commands.executeCommand as jest.Mock).mockImplementation((commandName: string) => (
                        commandName === RECIPE_COCKPIT_RUN_FAKER_COMMAND ? new Promise<void>(resolveRun => { finishRun = resolveRun; }) : Promise.resolve()
                    ));

                    await openRenderedHistoryCockpit();
                    const firstRun = receivedMessageHandler({ command: 'runFaker', treeKey: LEAD_TREE_KEY });
                    await receivedMessageHandler({ command: 'runFaker', treeKey: ACCOUNT_TREE_KEY });

                    expect(executedCommandsNamed(RECIPE_COCKPIT_RUN_FAKER_COMMAND)).toHaveLength(1);

                    postedPanelMessages.length = 0;
                    await receivedMessageHandler({ command: 'ready' });
                    expect(runFakerStates()).toEqual([{ command: 'runFakerState', isRunning: true, treeKey: LEAD_TREE_KEY }]);

                    finishRun();
                    await firstRun;

                    expect(runFakerStates().at(-1)).toEqual({ command: 'runFakerState', isRunning: false, treeKey: LEAD_TREE_KEY });

                });

                it('given the command fails, still reloads the run and re-enables the buttons, then reports the failure', async () => {

                    const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
                    (vscode.commands.executeCommand as jest.Mock).mockImplementation(async (commandName: string) => {
                        if ( commandName === RECIPE_COCKPIT_RUN_FAKER_COMMAND ) {
                            throw new Error('snowfakery is not installed');
                        }
                    });

                    await openRenderedHistoryCockpit();
                    postedPanelMessages.length = 0;

                    await receivedMessageHandler({ command: 'runFaker', treeKey: LEAD_TREE_KEY });

                    expect(postedPanelMessages.some(hostMessage => hostMessage.command === 'recipeData')).toBe(true);
                    expect(runFakerStates().at(-1)).toEqual({ command: 'runFakerState', isRunning: false, treeKey: LEAD_TREE_KEY });
                    expect(handleCapturedErrorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'snowfakery is not installed' }), 'openRecipeCockpit');

                });

                it('given the modal is cancelled, writes no data set and still reloads with the buttons re-enabled', async () => {

                    (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);

                    await openRenderedHistoryCockpit();
                    const leadDatasetsBefore = postedPanelMessages.filter(hostMessage => hostMessage.command === 'recipeData').at(-1)
                        .recipe.trees.find((tree: any) => tree.treeKey === LEAD_TREE_KEY).history.datasets;
                    postedPanelMessages.length = 0;

                    await receivedMessageHandler({ command: 'runFaker', treeKey: LEAD_TREE_KEY });

                    expect(reloadedLeadTree().history.datasets).toEqual(leadDatasetsBefore);
                    expect(runFakerStates().at(-1)).toEqual({ command: 'runFakerState', isRunning: false, treeKey: LEAD_TREE_KEY });

                });

                it('given the recipe file deleted after the draw, says it no longer exists, runs nothing, and reloads the run', async () => {

                    const temporaryWorkspaceRoot = copyHistoryWorkspace();

                    await openRenderedHistoryCockpit(temporaryWorkspaceRoot);
                    fs.rmSync(path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes', HISTORY_CURRENT_RUN, LEAD_TREE_KEY, 'recipe--Lead-ONLY-2026-09-20T10-00-00.yml'));
                    postedPanelMessages.length = 0;

                    await receivedMessageHandler({ command: 'runFaker', treeKey: LEAD_TREE_KEY });

                    expect(executedCommandsNamed(RECIPE_COCKPIT_RUN_FAKER_COMMAND)).toEqual([]);
                    expect(showWarningMessageSpy).toHaveBeenCalledWith('The recipe file "recipe--Lead-ONLY-2026-09-20T10-00-00.yml" no longer exists in this workspace, so Run Faker did not run. The Recipe Cockpit has reloaded the run.');
                    expect(reloadedLeadTree()).not.toHaveProperty('runFakerRecipeFileName');
                    expect(runFakerStates().at(-1)).toEqual({ command: 'runFakerState', isRunning: false, treeKey: LEAD_TREE_KEY });

                });

                it('runs nothing from a document that reloaded and has not drawn the model again', async () => {

                    await openRenderedHistoryCockpit();
                    await receivedMessageHandler({ command: 'ready' });

                    await receivedMessageHandler({ command: 'runFaker', treeKey: LEAD_TREE_KEY });

                    expect(executedCommandsNamed(RECIPE_COCKPIT_RUN_FAKER_COMMAND)).toEqual([]);

                });

                // THE CLICK DISABLED EVERY BUTTON BEFORE IT WAS REFUSED -- WITHOUT AN ANSWER THEY STAY DISABLED
                it('given a click on cards a new model replaced before it was drawn, runs nothing and gives the buttons back', async () => {

                    await openRenderedHistoryCockpit();
                    await receivedMessageHandler({ command: 'selectRun', runFolderName: 'recipe-2026-09-01T00-00-00' });
                    postedPanelMessages.length = 0;

                    await receivedMessageHandler({ command: 'runFaker', treeKey: LEAD_TREE_KEY });

                    expect(executedCommandsNamed(RECIPE_COCKPIT_RUN_FAKER_COMMAND)).toEqual([]);
                    expect(postedPanelMessages).toEqual([{ command: 'runFakerState', isRunning: false, treeKey: LEAD_TREE_KEY }]);

                });

                it('reloads the run on screen when the run ends, not the one the click came from', async () => {

                    const OTHER_RUN = 'recipe-2026-09-01T00-00-00';
                    let finishRun: (datasetFolderPath: string) => void;
                    (vscode.commands.executeCommand as jest.Mock).mockImplementation((commandName: string) => (
                        commandName === RECIPE_COCKPIT_RUN_FAKER_COMMAND ? new Promise<string>(resolveRun => { finishRun = resolveRun; }) : Promise.resolve()
                    ));

                    await openRenderedHistoryCockpit();
                    const run = receivedMessageHandler({ command: 'runFaker', treeKey: LEAD_TREE_KEY });
                    await receivedMessageHandler({ command: 'selectRun', runFolderName: OTHER_RUN });
                    postedPanelMessages.length = 0;

                    // A DATA SET THE CLICKED RUN'S CARD WOULD HAVE LISTED: IT IS NOT ADDED OVER ANOTHER RUN'S CARDS (#226)
                    finishRun(path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'FakeDataSets', 'dataset-2026-09-21T00-00-00'));
                    await run;

                    expect(postedPanelMessages.some(hostMessage => hostMessage.command === 'datasetAdded')).toBe(false);
                    expect(postedPanelMessages.find(hostMessage => hostMessage.command === 'recipeData').recipe.selectedRunFolderName).toBe(OTHER_RUN);

                });

            });

        });

        describe('Generate Treecipe from the no-run empty state (#214)', () => {

            const EMPTY_WORKSPACE_ROOT = path.join(MOCK_WORKSPACE_ROOT, 'doesNotExist');
            const lastRecipe = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.recipe;

            const openRenderedEmptyCockpit = async () => {
                await RecipeCockpitService.openRecipeCockpitPanel(EMPTY_WORKSPACE_ROOT);
                await receivedMessageHandler({ command: 'ready' });
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            };

            beforeEach(() => {

                (vscode.commands.executeCommand as jest.Mock).mockReset();
                (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);

            });

            it('runs Generate Treecipe without its toast, then loads the run it wrote', async () => {

                const findGeneratedRecipeRuns = RecipeCockpitService.findGeneratedRecipeRuns.bind(RecipeCockpitService);
                let hasGenerated = false;
                (vscode.commands.executeCommand as jest.Mock).mockImplementation(async () => { hasGenerated = true; });
                // THE RUN "WRITTEN" IS THE FIXTURE WORKSPACE'S, FOUND ONLY ONCE GENERATION HAS FINISHED
                jest.spyOn(RecipeCockpitService, 'findGeneratedRecipeRuns').mockImplementation(generatedRecipesFolderPath => (
                    hasGenerated
                        ? findGeneratedRecipeRuns(path.join(MOCK_WORKSPACE_ROOT, path.relative(EMPTY_WORKSPACE_ROOT, generatedRecipesFolderPath)))
                        : []
                ));

                await openRenderedEmptyCockpit();
                expect(lastRecipe().runs).toEqual([]);

                await receivedMessageHandler({ command: 'generateTreecipe' });

                expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
                expect(vscode.commands.executeCommand).toHaveBeenCalledWith(RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND, { isCompletionNotificationSuppressed: true });
                expect(lastRecipe().runs.length).toBeGreaterThan(0);
                expect(lastRecipe().trees.length).toBeGreaterThan(0);
                expect([...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData').focusTree).toBeUndefined();

                // A RUN IS ON SCREEN NOW, SO THE EMPTY STATE'S BUTTON IS NO LONGER HONOURED
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                await receivedMessageHandler({ command: 'generateTreecipe' });
                expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);

            });

            it('given the panel has not confirmed drawing the empty state, does not generate', async () => {

                await RecipeCockpitService.openRecipeCockpitPanel(EMPTY_WORKSPACE_ROOT);
                await receivedMessageHandler({ command: 'ready' });

                await receivedMessageHandler({ command: 'generateTreecipe' });

                expect(vscode.commands.executeCommand).not.toHaveBeenCalled();

            });

            it('given a second click while Generate Treecipe runs, generates once', async () => {

                let finishGeneration: () => void = () => undefined;
                (vscode.commands.executeCommand as jest.Mock).mockImplementation(() => new Promise<void>(resolvePromise => { finishGeneration = resolvePromise; }));
                await openRenderedEmptyCockpit();

                const firstClick = receivedMessageHandler({ command: 'generateTreecipe' });
                await receivedMessageHandler({ command: 'generateTreecipe' });
                finishGeneration();
                await firstClick;

                expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);

            });

            it('given Generate Treecipe fails or writes nothing, reloads the empty state, which offers the button again, and reports the failure once', async () => {

                const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
                (vscode.commands.executeCommand as jest.Mock).mockRejectedValueOnce(new Error('no config'));
                await openRenderedEmptyCockpit();
                const emptyRenderSequence = lastRenderSequence();

                await receivedMessageHandler({ command: 'generateTreecipe' });

                expect(lastRenderSequence()).toBeGreaterThan(emptyRenderSequence);
                expect(lastRecipe().emptyStateMessage).toBe(RECIPE_COCKPIT_NO_RUN_MESSAGE);
                expect(handleCapturedErrorSpy).toHaveBeenCalledTimes(1);
                expect(handleCapturedErrorSpy.mock.calls[0][0]).toEqual(new Error('no config'));

                // CANCELLED OR FAILED, THE RELOADED EMPTY STATE CAN START GENERATION AGAIN ONCE IT IS DRAWN
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                await receivedMessageHandler({ command: 'generateTreecipe' });
                expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(2);

            });

            it('given the empty state failed to draw, honours nothing', async () => {

                jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
                await openRenderedEmptyCockpit();

                await receivedMessageHandler({ command: 'renderFailed', phase: 'render', message: 'boom', stack: '' });
                await receivedMessageHandler({ command: 'generateTreecipe' });

                expect(vscode.commands.executeCommand).not.toHaveBeenCalled();

            });

            // NOTHING IN FLIGHT MASKS THIS RESET: A MODEL WITH A RUN WAS POSTED, AND ITS "rendered" HAS NOT ARRIVED
            it('given a model with a run is posted over the drawn empty state, honours nothing before or after its ack', async () => {

                await openRenderedEmptyCockpit();

                (RecipeCockpitService as any).renderRecipeModel(createdWebviewPanel, RecipeCockpitService.loadRecipeRunByRuns(
                    RecipeCockpitService.findGeneratedRecipeRuns(path.join(MOCK_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes')),
                    MOCK_WORKSPACE_ROOT
                ));
                expect(lastRecipe().runs.length).toBeGreaterThan(0);

                await receivedMessageHandler({ command: 'generateTreecipe' });
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                await receivedMessageHandler({ command: 'generateTreecipe' });

                expect(vscode.commands.executeCommand).not.toHaveBeenCalled();

            });

            it('given the document reloads, honours nothing until the replayed empty state is drawn again', async () => {

                await openRenderedEmptyCockpit();

                await receivedMessageHandler({ command: 'ready' });
                await receivedMessageHandler({ command: 'generateTreecipe' });

                expect(vscode.commands.executeCommand).not.toHaveBeenCalled();

            });

        });

    });

    describe('the preview warning the feature flag is accepted through', () => {

        // A LABEL QUERY RATHER THAN ISSUE NUMBERS, WHICH GO STALE AS SLICES SPLIT
        it('points at every issue carrying the recipe-cockpit label in this repository', () => {

            expect(RECIPE_COCKPIT_ISSUES_URL).toStartWith('https://github.com/jdschleicher/Salesforce-Data-Treecipe/issues');
            expect(RECIPE_COCKPIT_ISSUES_URL).toContain('label%3Arecipe-cockpit');

        });

        // A MODAL RENDERS ITS DETAIL AS PLAIN TEXT, SO THE BUTTON IS THE LINK AND THIS LINE IS WHAT A READER CAN COPY
        it('names the url, the setting it writes, the scope it writes it at, and that it can write to a sandbox', () => {

            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain(RECIPE_COCKPIT_ISSUES_URL);
            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('salesforce-data-treecipe.recipeCockpitEnabled');
            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('THIS WORKSPACE');
            // A READER OPTING IN IS TOLD THE PANEL CAN INSERT RECORDS, AND ONLY INTO A SANDBOX
            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('It CAN WRITE TO AN ORG');
            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('only for an org that reports itself as a sandbox');
            // #266: THE COMPARE TAB IS GONE, SO THE OPT-IN NO LONGER PROMISES A COMPARISON WITH AN ORG
            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).not.toMatch(/compar/i);

        });

        it('is not reachable from the panel document, which loads and links nothing', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(actualShellHtml).not.toContain(RECIPE_COCKPIT_ISSUES_URL);
            expect(actualShellHtml).not.toContain('github.com');

        });

    });

});
