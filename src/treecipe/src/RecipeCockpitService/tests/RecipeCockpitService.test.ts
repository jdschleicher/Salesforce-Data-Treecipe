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
    RECIPE_COCKPIT_LOAD_PHASES,
    RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT,
    RECIPE_COCKPIT_AUTO_EXPAND_ROW_BUDGET,
    RECIPE_COCKPIT_DESCRIBE_ACTION_LABEL,
    RECIPE_COCKPIT_CHOOSE_ORG_ACTION_LABEL,
    RECIPE_COCKPIT_ORG_PICKER_PLACEHOLDER,
    RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND,
    RECIPE_COCKPIT_REGENERATE_ACTION_LABEL,
    RECIPE_COCKPIT_REGENERATE_NOTE,
    RECIPE_COCKPIT_DIFF_PICKLIST_VALUES_SHOWN,
    RECIPE_COCKPIT_PALETTE,
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
            expect(actualShellHtml).not.toMatch(/https?:\/\//);

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
            ['onAccent', 'accent']
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
                added: '#15803D', removed: '#B91C1C', changed: '#B45309'
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

        it('restyles the buttons with the accent and the diff badges with the added, removed and changed tokens', () => {

            const styleSheet = styleSheetOf(RecipeCockpitService.buildWebviewShellHtml('testNonce'));

            expect(styleSheet).toMatch(/\.toolbar button, \.treeCompare button \{[^}]*color: var\(--sdt-on-accent\);[^}]*background-color: var\(--sdt-accent\);/);
            expect(styleSheet).toContain('.diff-new-in-org { color: var(--sdt-added); }');
            expect(styleSheet).toContain('.diff-removed-from-org { color: var(--sdt-removed); }');
            expect(styleSheet).toContain('.diff-type-changed { color: var(--sdt-changed); }');
            expect(styleSheet).toContain('.diff-picklist-changed { color: var(--sdt-changed); }');
            expect(styleSheet).toMatch(/\.sourceLink \{[^}]*color: var\(--sdt-accent\);/);

        });

        // THE CHIP ALSO CARRIES .muted, SO ITS COLOUR MUST NOT DEPEND ON WHICH OF THE TWO RULES COMES LAST
        it('draws a field type as a chip whose rule outranks .muted', () => {

            const styleSheet = styleSheetOf(RecipeCockpitService.buildWebviewShellHtml('testNonce'));

            expect(styleSheet).toMatch(/\.treeFieldHeader \.fieldType \{[^}]*color: var\(--sdt-chip-text\);[^}]*background-color: var\(--sdt-chip-bg\);/);

        });

        it(`holds every text/background pair the stylesheet draws to at least ${MINIMUM_TEXT_CONTRAST_RATIO}:1`, () => {

            expect(TEXT_ON_BACKGROUND_PAIRS).toHaveLength(26);
            expect(findContrastFailures(RECIPE_COCKPIT_PALETTE)).toEqual([]);

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

    describe('normalizeObjectsWrapper, recipe picklist values for the metadata diff', () => {

        const wrapperWithPicklists = {
            ObjectToObjectInfoMap: {
                Account: {
                    Fields: [
                        {
                            fieldName: 'Industry',
                            type: 'Picklist',
                            picklistValues: [
                                { picklistOptionApiName: 'Agriculture', label: 'Agriculture' },
                                { picklistOptionApiName: 'Banking', label: 'Banking', isActive: false },
                                { picklistOptionApiName: 'Retail', label: 'Retail', isActive: true },
                                { label: 'No api name' },
                                'not a record'
                            ]
                        },
                        { fieldName: 'Status__c', type: 'Picklist', picklistValues: [] },
                        {
                            fieldName: 'Sub_Industry__c',
                            type: 'Picklist',
                            controllingField: 'Industry',
                            picklistValues: [ { picklistOptionApiName: 'Dairy', label: 'Dairy', isActive: true } ]
                        },
                        { fieldName: 'Legacy_Code__c', type: 'Text' }
                    ]
                }
            },
            RecipeFiles: [ { objects: ['Account'] } ]
        };

        it('records each picklist field\'s active values, keyed by object and field', () => {

            const normalizedWrapper = RecipeCockpitService.normalizeObjectsWrapper(wrapperWithPicklists);

            expect(normalizedWrapper.picklistValuesByObjectApiName).toEqual(new Map([
                ['Account', new Map([['Industry', ['Agriculture', 'Retail']], ['Status__c', []]])]
            ]));

        });

        it('records nothing for a dependent picklist, whose values may be only the ones its valueSettings name', () => {

            const normalizedWrapper = RecipeCockpitService.normalizeObjectsWrapper(wrapperWithPicklists);

            expect(normalizedWrapper.picklistValuesByObjectApiName.get('Account')?.has('Sub_Industry__c')).toBe(false);
            expect(normalizedWrapper.objects[0].fields.map(fieldViewModel => fieldViewModel.fieldApiName)).toContain('Sub_Industry__c');

        });

        it('records nothing for a field whose wrapper entry carries no picklist values', () => {

            const normalizedWrapper = RecipeCockpitService.normalizeObjectsWrapper(wrapperWithPicklists);

            expect(normalizedWrapper.picklistValuesByObjectApiName.get('Account')?.has('Legacy_Code__c')).toBe(false);

        });

        /*
            The Structure tab draws a picklist's values, and they are posted when its row is
            expanded: the row itself carries only isPicklist, because posting every value with the
            model measured past 60 MB at 120,000 fields. The diff's own copy is unchanged -- a
            dependent picklist is still absent from it, because its wrapper values cannot say
            whether they are the field's whole set.
        */
        it('marks a picklist row and keeps its active values for display beside the model, dependent picklists included', () => {

            const normalizedWrapper = RecipeCockpitService.normalizeObjectsWrapper(wrapperWithPicklists);
            const fieldsByApiName = new Map(normalizedWrapper.objects[0].fields.map(fieldViewModel => [fieldViewModel.fieldApiName, fieldViewModel]));
            const displayValuesOf = (fieldApiName: string) => normalizedWrapper.picklistDisplayValuesByObjectApiName.get('Account')?.get(fieldApiName);

            expect(fieldsByApiName.get('Industry')?.isPicklist).toBe(true);
            expect(Object.keys(fieldsByApiName.get('Legacy_Code__c'))).not.toContain('isPicklist');
            expect(JSON.stringify(normalizedWrapper.objects)).not.toContain('Agriculture');

            expect(displayValuesOf('Industry')).toEqual({ picklistValues: ['Agriculture', 'Retail'], recordTypePicklistValues: [] });
            expect(displayValuesOf('Status__c')?.picklistValues).toEqual([]);
            expect(displayValuesOf('Sub_Industry__c')?.picklistValues).toEqual(['Dairy']);
            expect(displayValuesOf('Legacy_Code__c')).toBeUndefined();

            expect(normalizedWrapper.picklistValuesByObjectApiName.get('Account')?.has('Sub_Industry__c')).toBe(false);

        });

        it('records nothing when the file is not an objects wrapper', () => {

            expect(RecipeCockpitService.normalizeObjectsWrapper({ unrelated: true }).picklistValuesByObjectApiName.size).toBe(0);

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
                ]
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
            // THE DESCRIBE IS DRAWN OVER THE MODEL IT DESCRIBED, SO IT CAN ONLY FOLLOW IT
            it('given a model and an org describe of it, replays the describe after the model and before a failure', () => {

                withRenderedRecipe();
                const orgDescribeMessage = RecipeCockpitService.buildOrgConnectionFailureMessage('Account-thru-Contact', 'devhub', new Error('expired'), 7);
                panelState.orgDescribeMessagesByTreeKey.set('Account-thru-Contact', orgDescribeMessage);
                panelState.loadFailedMessage = { command: 'loadFailed', message: 'it broke' };

                expect(RecipeCockpitService.routePanelMessage({ command: 'ready' }, panelState)).toEqual({
                    kind: 'replay',
                    hostMessages: [panelState.recipeDataMessage, orgDescribeMessage, panelState.loadFailedMessage]
                });

            });

            // A COMPARISON IS KEPT PER CARD, SO A RELOADED DOCUMENT GETS EVERY CARD'S ANSWER BACK
            it('given two cards were compared, replays both comparisons after the model', () => {

                withRenderedRecipe();
                const firstComparison = RecipeCockpitService.buildOrgConnectionFailureMessage('Account-thru-Contact', 'devhub', new Error('expired'), 7);
                const secondComparison = RecipeCockpitService.buildOrgDescribeMessage('Lead-ONLY', 'devhub', { outcomes: [], wasCancelled: false }, 7);
                panelState.orgDescribeMessagesByTreeKey.set('Account-thru-Contact', firstComparison);
                panelState.orgDescribeMessagesByTreeKey.set('Lead-ONLY', secondComparison);

                expect(RecipeCockpitService.routePanelMessage({ command: 'ready' }, panelState)).toEqual({
                    kind: 'replay',
                    hostMessages: [panelState.recipeDataMessage, firstComparison, secondComparison]
                });

            });

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

        describe('selectOrg', () => {

            it('given a tree of the rendered model with objects, asks the host to describe that tree', () => {

                withRenderedRecipe();
                panelState.describableObjectApiNamesByTreeKey = new Map([['Account-thru-Contact', ['Account', 'Contact']]]);

                expect(RecipeCockpitService.routePanelMessage({ command: 'selectOrg', treeKey: 'Account-thru-Contact' }, panelState)).toEqual({ kind: 'selectOrg', treeKey: 'Account-thru-Contact', isOrgChosenByReader: false });

            });

            // ONLY A LITERAL true ASKS FOR THE PICKER -- ANYTHING ELSE IS THE ORDINARY COMPARE
            it.each([
                [true, true],
                ['true', false],
                [1, false]
            ])('given chooseOrg %p, asks for the picker: %p', (chooseOrg, isOrgChosenByReader) => {

                withRenderedRecipe();
                panelState.describableObjectApiNamesByTreeKey = new Map([['Account-thru-Contact', ['Account']]]);

                expect(RecipeCockpitService.routePanelMessage({ command: 'selectOrg', treeKey: 'Account-thru-Contact', chooseOrg: chooseOrg }, panelState))
                    .toEqual({ kind: 'selectOrg', treeKey: 'Account-thru-Contact', isOrgChosenByReader: isOrgChosenByReader });

            });

            // WHICH OBJECTS ARE DESCRIBED IS THE HOST'S MODEL, SO NOTHING THE PANEL POSTS ALONGSIDE CAN WIDEN IT
            it('ignores any object names posted with it', () => {

                withRenderedRecipe();
                panelState.describableObjectApiNamesByTreeKey = new Map([['Account-thru-Contact', ['Account']]]);

                expect(RecipeCockpitService.routePanelMessage({ command: 'selectOrg', treeKey: 'Account-thru-Contact', objectApiNames: ['User'] } as any, panelState))
                    .toEqual({ kind: 'selectOrg', treeKey: 'Account-thru-Contact', isOrgChosenByReader: false });

            });

            it.each([
                ['no tree key', undefined],
                ['a tree key that is not a string', 7],
                ['a tree the rendered model does not offer', 'Lead-ONLY'],
                ['an inherited member name', '__proto__']
            ])('given %s, describes nothing', (unusedDescription, treeKey) => {

                withRenderedRecipe();
                panelState.describableObjectApiNamesByTreeKey = new Map([['Account-thru-Contact', ['Account']]]);

                expect(RecipeCockpitService.routePanelMessage({ command: 'selectOrg', treeKey: treeKey }, panelState)).toBeUndefined();

            });

            it('given the panel has not confirmed drawing the model, describes nothing', () => {

                withRenderedRecipe();
                panelState.pendingDescribableObjectApiNamesByTreeKey = new Map([['Account-thru-Contact', ['Account']]]);

                expect(RecipeCockpitService.routePanelMessage({ command: 'selectOrg', treeKey: 'Account-thru-Contact' }, panelState)).toBeUndefined();

            });

            it('given a describe is already picking or running, starts no second one', () => {

                withRenderedRecipe();
                panelState.describableObjectApiNamesByTreeKey = new Map([['Account-thru-Contact', ['Account']]]);
                panelState.isOrgDescribeInFlight = true;

                expect(RecipeCockpitService.routePanelMessage({ command: 'selectOrg', treeKey: 'Account-thru-Contact' }, panelState)).toBeUndefined();

            });

        });

        describe('collectDescribableObjectApiNamesByTreeKey', () => {

            it('keys each tree by its folder, with every object it has a recipe for once, and leaves out a tree with none', () => {

                const recipeViewModel = buildRecipeViewModel({
                    objects: [
                        { objectApiName: 'Account', recipeFilePath: '', fields: [] },
                        { objectApiName: 'Contact', recipeFilePath: '', fields: [] }
                    ],
                    trees: [
                        { treeKey: 'Account-thru-Contact', title: 'Relationship Tree 1', folderName: 'Account-thru-Contact', fieldCount: 0, objects: [
                            { objectApiName: 'Account', parentLookups: [] },
                            { objectApiName: 'User', parentLookups: [] },
                            { objectApiName: 'Contact', parentLookups: [] },
                            { objectApiName: 'Contact', parentLookups: [], iterationNickname: 'Contact_child_NickName' }
                        ] },
                        { treeKey: 'User-ONLY', title: 'Relationship Tree 2', folderName: 'User-ONLY', fieldCount: 0, objects: [{ objectApiName: 'User', parentLookups: [] }] }
                    ]
                });

                expect([...RecipeCockpitService.collectDescribableObjectApiNamesByTreeKey(recipeViewModel).entries()]).toEqual([
                    ['Account-thru-Contact', ['Account', 'Contact']]
                ]);

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

    describe('buildRecipeDiffViewModel', () => {

        const recipeObjects = () => RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT).objects;

        const describeResult = {
            outcomes: [
                { objectApiName: 'Account', describe: ACCOUNT_ORG_DESCRIBE, wasCached: false },
                { objectApiName: 'Contact', failureMessage: 'NOT_FOUND: The requested resource does not exist', wasCached: false }
            ],
            wasCancelled: false
        };

        it('posts each changed field with what changed, and leaves the unchanged ones implied', () => {

            const recipeDiff = RecipeCockpitService.buildRecipeDiffViewModel(recipeObjects(), describeResult, RECIPE_PICKLIST_VALUES);
            const [accountDiff] = recipeDiff.objects;

            expect(accountDiff.changedFields).toEqual([
                { fieldApiName: 'Industry', status: 'picklist-changed', recipeFieldType: 'Picklist', orgFieldType: 'picklist', addedPicklistValues: ['Retail'], removedPicklistValues: ['Banking'] },
                { fieldApiName: 'Legacy_Code__c', status: 'removed-from-org', recipeFieldType: 'Text', orgFieldType: '', addedPicklistValues: [], removedPicklistValues: [] },
                { fieldApiName: 'Number_of_Contacts__c', status: 'type-changed', recipeFieldType: 'Number', orgFieldType: 'string', addedPicklistValues: [], removedPicklistValues: [] },
                { fieldApiName: 'Rating__c', status: 'new-in-org', recipeFieldType: '', orgFieldType: 'picklist', addedPicklistValues: [], removedPicklistValues: [] }
            ]);
            expect(accountDiff.statusCounts).toEqual({ 'new-in-org': 1, 'removed-from-org': 1, 'type-changed': 1, 'picklist-changed': 1, 'unchanged': 2 });
            expect(accountDiff.uncreateableOrgOnlyFieldCount).toBe(1);

        });

        // THE DIFF READS ITS ORG SIDE AS WHAT THE ORG HAS -- A FAILED DESCRIBE PASSED IN WOULD REPORT EVERY FIELD REMOVED
        it('compares only the objects the org described, and counts nothing for the rest', () => {

            const recipeDiff = RecipeCockpitService.buildRecipeDiffViewModel(recipeObjects(), describeResult, RECIPE_PICKLIST_VALUES);

            expect(recipeDiff.objects.map(objectDiff => objectDiff.objectApiName)).toEqual(['Account']);
            expect(recipeDiff.statusCounts['removed-from-org']).toBe(1);

        });

        it('given a cancelled describe, compares what was described before the cancel', () => {

            const recipeDiff = RecipeCockpitService.buildRecipeDiffViewModel(recipeObjects(), {
                outcomes: [
                    { objectApiName: 'Account', describe: ACCOUNT_ORG_DESCRIBE, wasCached: true },
                    { objectApiName: 'Contact', failureMessage: ORG_DESCRIBE_CANCELLED_MESSAGE, wasCached: false }
                ],
                wasCancelled: true
            }, new Map());

            expect(recipeDiff.objects.map(objectDiff => objectDiff.objectApiName)).toEqual(['Account']);

        });

        // A FIELD THE RECIPE RECORDED NO VALUES FOR MAKES NO CLAIM ABOUT THEM
        it('given no recipe picklist values, makes no picklist claim', () => {

            const recipeDiff = RecipeCockpitService.buildRecipeDiffViewModel(recipeObjects(), describeResult, new Map());

            expect(recipeDiff.objects[0].changedFields.map(fieldDiff => fieldDiff.fieldApiName)).not.toContain('Industry');

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

        it('answers the posted model and, beside it, the diff\'s own copy of the picklist values, which is never posted', () => {

            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(MOCK_GENERATED_RECIPES_PATH);
            const loadedRecipe = RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, MOCK_WORKSPACE_ROOT);

            expect(loadedRecipe.recipeViewModel).toEqual(RecipeCockpitService.buildRecipeViewModelByRuns(recipeRuns, MOCK_WORKSPACE_ROOT));
            expect(loadedRecipe.recipePicklistValuesByObjectApiName).toBeInstanceOf(Map);
            expect(Object.keys(loadedRecipe.recipeViewModel)).not.toContain('recipePicklistValuesByObjectApiName');

        });

        it('given no run, answers no picklist values', () => {

            expect(RecipeCockpitService.loadRecipeRunByRuns([], MOCK_WORKSPACE_ROOT).recipePicklistValuesByObjectApiName.size).toBe(0);

        });

    });

    describe('routePanelMessage, regenerateRecipe', () => {

        const COMPARED_TREE_KEY = 'Account-thru-Contact';

        const comparedDescribe = (renderSequence: number) => RecipeCockpitService.buildOrgDescribeMessage(COMPARED_TREE_KEY, 'devhub', {
            outcomes: [{ objectApiName: 'Account', describe: ACCOUNT_ORG_DESCRIBE, wasCached: false }],
            wasCancelled: false
        }, renderSequence, RecipeCockpitService.buildRecipeDiffViewModel(
            RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT).objects,
            { outcomes: [{ objectApiName: 'Account', describe: ACCOUNT_ORG_DESCRIBE, wasCached: false }], wasCancelled: false },
            new Map()
        ));

        const buildComparedPanelState = (): IRecipeCockpitPanelState => ({
            ...RecipeCockpitService.buildInitialPanelState(MOCK_WORKSPACE_ROOT),
            recipeDataMessage: { command: 'recipeData', recipe: buildRecipeViewModel(), renderSequence: 2 },
            describableObjectApiNamesByTreeKey: new Map([[COMPARED_TREE_KEY, ['Account', 'Contact']], ['Lead-ONLY', ['Lead']]]),
            orgDescribeMessagesByTreeKey: new Map([[COMPARED_TREE_KEY, comparedDescribe(2)]])
        });

        it('given a comparison of the card on screen, regenerates from that card, ignoring any other payload', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'regenerateRecipe', treeKey: COMPARED_TREE_KEY, filePath: '/etc/passwd' }, buildComparedPanelState()))
                .toEqual({ kind: 'regenerateRecipe', treeKey: COMPARED_TREE_KEY });

        });

        it('given the panel has not confirmed drawing the model, regenerates nothing', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'regenerateRecipe', treeKey: COMPARED_TREE_KEY }, {
                ...buildComparedPanelState(),
                describableObjectApiNamesByTreeKey: new Map()
            })).toBeUndefined();

        });

        it('given nothing has been compared in that card, regenerates nothing', () => {

            const panelState = buildComparedPanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'regenerateRecipe', treeKey: COMPARED_TREE_KEY }, { ...panelState, orgDescribeMessagesByTreeKey: new Map() })).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'regenerateRecipe', treeKey: COMPARED_TREE_KEY }, {
                ...panelState,
                orgDescribeMessagesByTreeKey: new Map([[COMPARED_TREE_KEY, RecipeCockpitService.buildOrgConnectionFailureMessage(COMPARED_TREE_KEY, 'devhub', new Error('expired'), 2)]])
            })).toBeUndefined();
            // ANOTHER CARD'S COMPARISON DOES NOT ROUTE A REGENERATE FROM ONE THAT HAS NONE
            expect(RecipeCockpitService.routePanelMessage({ command: 'regenerateRecipe', treeKey: 'Lead-ONLY' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'regenerateRecipe' }, panelState)).toBeUndefined();

        });

        it('given a regeneration is already running, starts no second one', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'regenerateRecipe', treeKey: COMPARED_TREE_KEY }, {
                ...buildComparedPanelState(),
                isRegenerateInFlight: true
            })).toBeUndefined();

        });

        it('replays a comparison still in progress after the model and any earlier answer', () => {

            const panelState: IRecipeCockpitPanelState = {
                ...buildComparedPanelState(),
                orgProgressMessage: { command: 'orgProgress', treeKey: 'Lead-ONLY', message: 'Comparing with devhub: described 1 of 2 objects…', renderSequence: 2 }
            };

            expect(RecipeCockpitService.buildReplayMessages(panelState).map(hostMessage => hostMessage.command))
                .toEqual(['recipeData', 'orgDescribe', 'orgProgress']);

        });

    });

    describe('buildOrgLabel', () => {

        it('names the alias with the username it points at, or the username alone', () => {

            expect(RecipeCockpitService.buildOrgLabel({ targetOrgIdentifier: 'devhub', username: 'jd@example.com', alias: 'devhub' })).toBe('devhub (jd@example.com)');
            expect(RecipeCockpitService.buildOrgLabel({ targetOrgIdentifier: 'jd@example.com', username: 'jd@example.com' })).toBe('jd@example.com');

        });

    });

    describe('buildOrgDescribeMessage', () => {

        const accountDescribe = { objectApiName: 'Account', objectLabel: 'Account', isCreateable: true, fields: [] as any[] };

        it('given every object described, counts them and each one\'s fields', () => {

            const orgDescribeMessage = RecipeCockpitService.buildOrgDescribeMessage('Account-thru-Contact', 'devhub', {
                outcomes: [{ objectApiName: 'Account', describe: { ...accountDescribe, fields: [{}, {}, {}] as any[] }, wasCached: false }],
                wasCancelled: false
            }, 3);

            expect(orgDescribeMessage).toEqual({
                command: 'orgDescribe',
                treeKey: 'Account-thru-Contact',
                orgLabel: 'devhub',
                summary: 'Described in devhub: 1 of 1 object described.',
                isFailure: false,
                isCancelled: false,
                objects: [{ objectApiName: 'Account', isDescribed: true, describedFieldCount: 3, failureMessage: '' }],
                // A MESSAGE BUILT WITH NO COMPARISON CARRIES AN EMPTY ONE, NEVER AN ABSENT ONE THE PANEL WOULD HAVE TO GUARD
                diff: { objects: [], statusCounts: { 'new-in-org': 0, 'removed-from-org': 0, 'type-changed': 0, 'picklist-changed': 0, 'unchanged': 0 } },
                renderSequence: 3
            });

        });

        it('given some objects failed, says how many and carries each failure on its object', () => {

            const orgDescribeMessage = RecipeCockpitService.buildOrgDescribeMessage('Account-thru-Contact', 'devhub', {
                outcomes: [
                    { objectApiName: 'Account', describe: accountDescribe, wasCached: true },
                    { objectApiName: 'Widget__c', failureMessage: 'NOT_FOUND: The requested resource does not exist', wasCached: false },
                    { objectApiName: 'Gadget__c', wasCached: false }
                ],
                wasCancelled: false
            }, 3);

            expect(orgDescribeMessage.summary).toBe('Described in devhub: 1 of 3 objects described (1 from this session\'s cache). 2 could not be described.');
            expect(orgDescribeMessage.objects.map(objectSummary => objectSummary.failureMessage)).toEqual([
                '',
                'NOT_FOUND: The requested resource does not exist',
                'unknown error'
            ]);

        });

        it('given the describe was cancelled, says so rather than reporting the rest as failures', () => {

            const orgDescribeMessage = RecipeCockpitService.buildOrgDescribeMessage('Account-thru-Contact', 'devhub', {
                outcomes: [
                    { objectApiName: 'Account', describe: accountDescribe, wasCached: false },
                    { objectApiName: 'Contact', failureMessage: ORG_DESCRIBE_CANCELLED_MESSAGE, wasCached: false }
                ],
                wasCancelled: true
            }, 3);

            expect(orgDescribeMessage.summary).toBe('The describe in devhub was cancelled: 1 of 2 objects described.');
            expect(orgDescribeMessage.isCancelled).toBe(true);

        });

    });

    describe('buildOrgConnectionFailureMessage', () => {

        it('says the org could not be reached, why, and how to fix it', () => {

            expect(RecipeCockpitService.buildOrgConnectionFailureMessage('Account-thru-Contact', 'devhub', new Error('No authorization information found for devhub.'), 4)).toEqual({
                command: 'orgDescribe',
                treeKey: 'Account-thru-Contact',
                orgLabel: 'devhub',
                summary: 'Could not connect to devhub: No authorization information found for devhub.. Re-authorize the org with "sf org login web" and try again.',
                isFailure: true,
                isCancelled: false,
                objects: [],
                diff: { objects: [], statusCounts: { 'new-in-org': 0, 'removed-from-org': 0, 'type-changed': 0, 'picklist-changed': 0, 'unchanged': 0 } },
                renderSequence: 4
            });

        });

        it('given something thrown that is not an Error, still says what it was', () => {

            expect(RecipeCockpitService.buildOrgConnectionFailureMessage('Account-thru-Contact', 'devhub', 'ECONNRESET', 4).summary).toContain('Could not connect to devhub: ECONNRESET.');

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

        it('opens on Recipe Trees, and the view switch offers only Recipe Trees and Data-by-Org', () => {

            const { panel } = renderTreeRecipe();

            expect(panel.isHidden(viewOf(panel, 'treesView'))).toBe(false);
            expect(panel.isHidden(viewOf(panel, 'dataOrgView'))).toBe(true);
            expect(textOf(panel, panel.cockpitBodyElement.children[0], 'viewButton')).toEqual(['Recipe Trees', 'Data-by-Org']);
            expect(panel.findAll(panel.cockpitBodyElement.children[0], 'selected').map((element: any) => element.textContent)).toEqual(['Recipe Trees']);
            // THE CLASSIC LIST IS GONE, WITH EVERY NODE IT DREW
            ['classicView', 'classicControls', 'object', 'field', 'matchCount'].forEach(className => {
                expect(panel.findAll(panel.cockpitBodyElement, className)).toEqual([]);
            });
            // THE COMPARISON'S CONTROLS ARE IN THE CARDS, NOT IN THE TOOLBAR
            expect(panel.findAll(panel.cockpitBodyElement.children[0], 'describeInOrg')).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement.children[0], 'statusFilter')).toEqual([]);

        });

        it('keeps the chosen view when the next model is drawn', () => {

            const { panel, recipe } = renderTreeRecipe();

            clickNamed(panel, panel.cockpitBodyElement, 'viewButton', 'Data-by-Org');
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 2 });

            expect(panel.isHidden(viewOf(panel, 'dataOrgView'))).toBe(false);
            expect(panel.isHidden(viewOf(panel, 'treesView'))).toBe(true);

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
            expect(viewOf(panel, 'treeMatchCount').textContent).toBe('15 fields · 2 trees');

        });

        it('given a card is expanded, draws its tabs with Structure selected, and its objects in insert order with their lookups', () => {

            const { panel } = renderTreeRecipe();
            const [firstTreeCard] = treeCardsOf(panel);

            expandTree(panel, firstTreeCard);

            expect(panel.isHidden(treeBodyOf(firstTreeCard))).toBe(false);
            expect(textOf(panel, firstTreeCard, 'treeTab')).toEqual(['Structure', 'Previous Versions', 'Previous Fake Sets']);
            expect(panel.findAll(firstTreeCard, 'treeTab').map((tabElement: any) => tabElement.attributes['aria-selected'])).toEqual(['true', 'false', 'false']);
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

            expect(panel.postedHostMessages[panel.postedHostMessages.length - 1]).toEqual({ command: 'loadPicklistValues', objectApiName: 'Account', fieldApiName: 'Rating__c' });
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

            // A NEWER MODEL DROPS THE OLD ROW'S REQUEST, SO ITS LATE ANSWER DRAWS NOTHING EITHER
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 2 });
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

        it('given a search, opens the trees and objects that match and labels a tree with none rather than hiding it', () => {

            const { panel } = renderTreeRecipe();
            const [firstTreeCard, secondTreeCard] = treeCardsOf(panel);

            panel.typeIntoFilter('status');

            expect(panel.isHidden(secondTreeCard)).toBe(false);
            expect(panel.isHidden(treeBodyOf(secondTreeCard))).toBe(false);
            expect(textOf(panel, secondTreeCard, 'treeMatch')).toEqual(['1 matching field']);

            expect(panel.isHidden(firstTreeCard)).toBe(false);
            expect(panel.isHidden(treeBodyOf(firstTreeCard))).toBe(true);
            expect(textOf(panel, firstTreeCard, 'treeMatch')).toEqual(['no matches']);

            expect(viewOf(panel, 'treeMatchCount').textContent).toBe('1 of 15 fields · 1 of 2 trees');

            const leadElement = treeObjectNamed(panel, secondTreeCard, 'Lead');
            expect(panel.findAll(leadElement, 'treeField').filter((fieldElement: any) => !panel.isHidden(fieldElement))
                .map((fieldElement: any) => panel.findAll(fieldElement, 'treeFieldName')[0].textContent)).toEqual(['Status']);

        });

        it('given the 🔍 on a tree, searches only that tree and says so, and gives the rest back as the reader left them', () => {

            const { panel } = renderTreeRecipe();
            const [firstTreeCard, secondTreeCard] = treeCardsOf(panel);

            expandTree(panel, secondTreeCard);
            panel.findAll(firstTreeCard, 'treeScope')[0].dispatch('click');
            panel.typeIntoFilter('a');

            expect(panel.findAll(firstTreeCard, 'treeScope')[0].attributes['aria-pressed']).toBe('true');
            expect(panel.isHidden(viewOf(panel, 'treeScopeStatus'))).toBe(false);
            expect(textOf(panel, viewOf(panel, 'treeScopeStatus'), 'treeScopeText')).toEqual(['Searching only Relationship Tree 1 (Account-thru-OtherChildObject__c) ']);
            expect(textOf(panel, secondTreeCard, 'treeMatch')).toEqual(['not searched']);
            expect(panel.isHidden(treeBodyOf(secondTreeCard))).toBe(false);
            expect(viewOf(panel, 'treeMatchCount').textContent).toMatch(/^13 of 13 fields · 1 of 1 tree$/);

            panel.findAll(viewOf(panel, 'treeScopeStatus'), 'treeScopeClear')[0].dispatch('click');

            expect(panel.isHidden(viewOf(panel, 'treeScopeStatus'))).toBe(true);
            expect(panel.findAll(firstTreeCard, 'treeScope')[0].attributes['aria-pressed']).toBe('false');
            expect(viewOf(panel, 'treeMatchCount').textContent).toMatch(/ of 15 fields · 2 of 2 trees$/);

        });

        it('given the search is cleared, puts back the cards and objects the reader had open', () => {

            const { panel } = renderTreeRecipe();
            const [firstTreeCard, secondTreeCard] = treeCardsOf(panel);

            expandTree(panel, secondTreeCard);
            panel.typeIntoFilter('rating');
            expect(panel.isHidden(treeBodyOf(firstTreeCard))).toBe(false);
            expect(panel.isHidden(treeBodyOf(secondTreeCard))).toBe(true);

            panel.typeIntoFilter('');

            expect(panel.isHidden(treeBodyOf(firstTreeCard))).toBe(true);
            expect(panel.isHidden(treeBodyOf(secondTreeCard))).toBe(false);
            expect(panel.findAll(panel.cockpitBodyElement, 'treeMatch').every((element: any) => panel.isHidden(element))).toBe(true);

        });

        it('opens at most the auto-expand limit of matching objects across every tree', () => {

            const manyObjects = Array.from({ length: RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT + 5 }, (unusedValue, objectIndex) => ({
                objectApiName: `Object${objectIndex}__c`,
                recipeFilePath: '',
                fields: [{ fieldApiName: 'Shared__c', fieldLabel: '', fieldType: 'Text', fieldTypeWithSize: 'Text', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false }]
            }));
            const manyTrees = manyObjects.map(objectViewModel => ({
                treeKey: `${objectViewModel.objectApiName}-ONLY`,
                title: 'Relationship Tree',
                folderName: `${objectViewModel.objectApiName}-ONLY`,
                objects: [{ objectApiName: objectViewModel.objectApiName, parentLookups: [] }],
                fieldCount: 1
            }));

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', renderSequence: 1, recipe: buildRecipeViewModel({ objects: manyObjects, trees: manyTrees }) });

            panel.typeIntoFilter('shared');

            const openedTreeCards = treeCardsOf(panel).filter((treeCard: any) => !panel.isHidden(treeBodyOf(treeCard)));
            expect(openedTreeCards).toHaveLength(RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT);
            expect(textOf(panel, treeCardsOf(panel)[RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT], 'treeMatch')).toEqual(['1 matching field']);

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
        it('matches a field by the sized type the Structure tab draws', () => {

            const { panel } = renderTreeRecipe();

            panel.typeIntoFilter('text(50)');
            expect(viewOf(panel, 'treeMatchCount').textContent).toBe('1 of 15 fields · 1 of 2 trees');

        });

        it('builds no rows in Data-by-Org for a keystroke, and draws the matches when the reader switches back', () => {

            const { panel } = renderTreeRecipe();

            clickNamed(panel, panel.cockpitBodyElement, 'viewButton', 'Data-by-Org');
            clickNamed(panel, panel.cockpitBodyElement, 'viewButton', 'Recipe Trees');
            panel.typeIntoFilter('rating');

            expect(viewOf(panel, 'treeMatchCount').textContent).toBe('2 of 15 fields · 1 of 2 trees');
            expect(panel.visibleFieldNamesOf(treeObjectNamed(panel, treeCardsOf(panel)[0], 'Account'))).toEqual(['Rating__c', 'Sub_Rating__c']);

        });

        it('given a 🔍 scope and an empty find box, counts the scoped tree only', () => {

            const { panel } = renderTreeRecipe();

            panel.findAll(treeCardsOf(panel)[0], 'treeScope')[0].dispatch('click');

            expect(viewOf(panel, 'treeMatchCount').textContent).toBe('13 fields · 1 tree');

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

        // A REGENERATE RELOADS INTO THE CARDS WITH THE CARD IT WAS ASKED FROM OPEN ON ITS STRUCTURE TAB
        it('given a reload focused on a card\'s Structure tab, opens that card on Structure', () => {

            const panel = runPanelScript();
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            const recipe = RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME).recipeViewModel;
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1, focusTree: { treeKey: 'Lead-ONLY', tab: 'structure' } });

            const [firstTreeCard, leadTreeCard] = treeCardsOf(panel);

            expect(panel.isHidden(treeBodyOf(firstTreeCard))).toBe(true);
            expect(panel.isHidden(treeBodyOf(leadTreeCard))).toBe(false);
            expect(panel.findAll(leadTreeCard, 'selected').map((element: any) => element.textContent)).toEqual(['Structure']);
            expect(panel.findAll(leadTreeCard, 'describeInOrg')).toHaveLength(1);

        });

        it('given a model with objects and no trees, says so in the trees view', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', renderSequence: 1, recipe: buildRecipeViewModel({
                objects: [{ objectApiName: 'Lead', recipeFilePath: '', fields: [] }]
            }) });

            expect(textOf(panel, viewOf(panel, 'treesView'), 'emptyState')).toEqual(['This run has no relationship trees to show. Run "Generate Treecipe" again to draw its objects in relationship trees.']);
            expect(panel.findAll(panel.cockpitBodyElement, 'describeInOrg')).toEqual([]);

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

        it('given the recipe, draws the find box first, one collapsed card per tree, and acknowledges the draw', () => {

            const panel = renderFixtureRecipe();

            expect(panel.cockpitBodyElement.children[0].classList.contains('toolbar')).toBe(true);
            expect(panel.findAll(panel.cockpitBodyElement.children[0], 'filterInput')).toHaveLength(1);

            expect(panel.treeCards()).toHaveLength(1);
            expect(panel.findAll(panel.cockpitBodyElement, 'treeMatchCount')[0].textContent).toBe('7 fields · 1 tree');
            // A CARD'S OBJECTS ARE ATTACHED ON ITS FIRST EXPAND, AND THEIR ROWS ON THEIR OWN
            expect(panel.objectElements()).toEqual([]);

            panel.expandAllTrees();

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

            panel.typeIntoFilter('industry');

            const [accountElement, contactElement] = panel.objectElements();

            expect(panel.isHidden(panel.objectBodyOf(accountElement))).toBe(false);
            expect(panel.visibleFieldNamesOf(accountElement)).toEqual(['Industry', 'Industry_Group__c']);
            expect(panel.objectCountOf(accountElement)).toBe('2 of 5 fields');

            expect(panel.isHidden(contactElement)).toBe(false);
            expect(panel.isHidden(panel.objectBodyOf(contactElement))).toBe(true);
            expect(panel.objectCountOf(contactElement)).toBe('no matching fields');

            expect(panel.findAll(panel.cockpitBodyElement, 'treeMatchCount')[0].textContent).toBe('2 of 7 fields · 1 of 1 tree');

        });

        it('given a filter naming an object, shows all of that object\'s fields', () => {

            const panel = renderFixtureRecipe();

            panel.typeIntoFilter('  CONTACT ');

            const [, contactElement] = panel.objectElements();
            expect(panel.visibleFieldNamesOf(contactElement)).toEqual(['LastName', 'AccountId']);
            expect(panel.objectCountOf(contactElement)).toBe('2 fields');

        });

        it('matches a field by its faker expression, which the row draws', () => {

            const panel = renderFixtureRecipe();

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

        it('given no generated run, shows the empty state naming Generate Treecipe and no find box', () => {

            const panel = runPanelScript();

            panel.postToPanel({ command: 'recipeData', recipe: RecipeCockpitService.buildRecipeViewModel(path.join(MOCK_WORKSPACE_ROOT, 'doesNotExist')) });

            expect(panel.findAll(panel.cockpitBodyElement, 'emptyState')[0].textContent).toBe(RECIPE_COCKPIT_NO_RUN_MESSAGE);
            expect(panel.findAll(panel.cockpitBodyElement, 'filterInput')).toEqual([]);
            expect(panel.findAll(panel.cockpitBodyElement, 'runSelect')).toEqual([]);

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

    describe('the panel script, describing in an org', () => {

        const renderFixtureRecipe = (renderSequence = 1) => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT), renderSequence });
            panel.expandAllTrees();
            return panel;
        };

        const describedFixture = (renderSequence: number) => RecipeCockpitService.buildOrgDescribeMessage('Account-thru-Contact', 'devhub (jd@example.com)', {
            outcomes: [
                { objectApiName: 'Account', describe: { objectApiName: 'Account', objectLabel: 'Account', isCreateable: true, fields: [{}, {}, {}] as any[] }, wasCached: false },
                { objectApiName: 'Contact', failureMessage: 'NOT_FOUND: The requested resource does not exist', wasCached: false }
            ],
            wasCancelled: false
        }, renderSequence);

        const orgDescribeStatusOf = (panel: any, objectElement: any) => panel.findAll(objectElement.children[0], 'orgDescribeStatus')[0];

        it('offers the describe at the top of the card\'s Structure tab, and asks the host for that tree by its key alone', () => {

            const panel = renderFixtureRecipe();
            const [treeCard] = panel.treeCards();
            const structureElement = panel.findAll(treeCard, 'treeStructure')[0];
            const describeButtons = panel.findAll(panel.cockpitBodyElement, 'describeInOrg');

            expect(describeButtons).toHaveLength(1);
            expect(describeButtons[0].textContent).toBe(RECIPE_COCKPIT_DESCRIBE_ACTION_LABEL);
            expect(structureElement.children[0].classList.contains('treeCompare')).toBe(true);
            expect(panel.findAll(structureElement.children[0], 'describeInOrg')).toEqual(describeButtons);

            describeButtons[0].dispatch('click');

            expect(panel.postedHostMessages[panel.postedHostMessages.length - 1]).toEqual({ command: 'selectOrg', treeKey: 'Account-thru-Contact' });

            const [chooseOrgButton] = panel.findAll(structureElement.children[0], 'describeInChosenOrg');
            expect(chooseOrgButton.textContent).toBe(RECIPE_COCKPIT_CHOOSE_ORG_ACTION_LABEL);

            chooseOrgButton.dispatch('click');

            expect(panel.postedHostMessages[panel.postedHostMessages.length - 1]).toEqual({ command: 'selectOrg', treeKey: 'Account-thru-Contact', chooseOrg: true });

        });

        it('given a run with no objects, offers nothing to describe', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: buildRecipeViewModel({ emptyStateMessage: 'nothing here' }), renderSequence: 1 });

            expect(panel.findAll(panel.cockpitBodyElement, 'describeInOrg')).toEqual([]);

        });

        it('shows nothing about an org until one has been described', () => {

            const panel = renderFixtureRecipe();

            expect(panel.isHidden(panel.findAll(panel.cockpitBodyElement, 'orgStatus')[0])).toBe(true);
            expect(panel.objectElements().every((objectElement: any) => panel.isHidden(orgDescribeStatusOf(panel, objectElement)))).toBe(true);

        });

        it('given a describe of the rows on screen, draws its summary, each failure, and each object\'s answer on its header', () => {

            const panel = renderFixtureRecipe(4);
            panel.postToPanel(describedFixture(4));

            const orgStatusElement = panel.findAll(panel.cockpitBodyElement, 'orgStatus')[0];

            expect(panel.isHidden(orgStatusElement)).toBe(false);
            expect(orgStatusElement.classList.contains('failed')).toBe(false);
            expect(panel.findAll(orgStatusElement, 'orgDescribeSummary')[0].textContent)
                .toBe('Described in devhub (jd@example.com): 1 of 2 objects described. 1 could not be described.');
            expect(panel.findAll(orgStatusElement, 'orgDescribeFailure').map((failureElement: any) => failureElement.textContent))
                .toEqual(['Contact: NOT_FOUND: The requested resource does not exist']);

            expect(panel.objectElements().map((objectElement: any) => orgDescribeStatusOf(panel, objectElement).textContent))
                .toEqual(['org: 3 fields', 'not described in the org']);
            expect(panel.objectElements().every((objectElement: any) => !panel.isHidden(orgDescribeStatusOf(panel, objectElement)))).toBe(true);

        });

        it('given a connection failure, marks the summary as one', () => {

            const panel = renderFixtureRecipe(4);
            panel.postToPanel(RecipeCockpitService.buildOrgConnectionFailureMessage('Account-thru-Contact', 'devhub', new Error('expired'), 4));

            const orgStatusElement = panel.findAll(panel.cockpitBodyElement, 'orgStatus')[0];

            expect(orgStatusElement.classList.contains('failed')).toBe(true);
            expect(panel.objectElements().every((objectElement: any) => panel.isHidden(orgDescribeStatusOf(panel, objectElement)))).toBe(true);

        });

        // A DESCRIBE OF AN EARLIER RUN'S OBJECTS SAYS NOTHING ABOUT THESE ROWS
        it('given a describe of a model that is not the one on screen, draws nothing', () => {

            const panel = renderFixtureRecipe(5);
            panel.postToPanel(describedFixture(4));

            expect(panel.isHidden(panel.findAll(panel.cockpitBodyElement, 'orgStatus')[0])).toBe(true);
            expect(panel.objectElements().every((objectElement: any) => panel.isHidden(orgDescribeStatusOf(panel, objectElement)))).toBe(true);

        });

        it('given a describe before any model was drawn, draws nothing and does not throw', () => {

            const panel = runPanelScript();

            expect(() => panel.postToPanel(describedFixture(1))).not.toThrow();
            expect(panel.findAll(panel.cockpitBodyElement, 'orgStatus')).toEqual([]);

        });

    });

    describe('the panel script, comparing with an org', () => {

        const COMPARED_ORG_LABEL = 'devhub (jd@example.com)';
        const COMPARED_TREE_KEY = 'Account-thru-Contact';

        const renderFixture = (renderSequence = 1) => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT), renderSequence: renderSequence });
            panel.expandAllTrees();
            return panel;
        };

        const accountOnlyDescribeResult = {
            outcomes: [
                { objectApiName: 'Account', describe: ACCOUNT_ORG_DESCRIBE, wasCached: false },
                { objectApiName: 'Contact', failureMessage: 'NOT_FOUND: The requested resource does not exist', wasCached: false }
            ],
            wasCancelled: false
        };

        const buildComparison = (renderSequence: number, orgDescribe: INormalizedOrgObjectDescribe = ACCOUNT_ORG_DESCRIBE) => {
            const describeResult = { ...accountOnlyDescribeResult, outcomes: [{ ...accountOnlyDescribeResult.outcomes[0], describe: orgDescribe }, accountOnlyDescribeResult.outcomes[1]] };
            return RecipeCockpitService.buildOrgDescribeMessage(
                COMPARED_TREE_KEY,
                COMPARED_ORG_LABEL,
                describeResult,
                renderSequence,
                RecipeCockpitService.buildRecipeDiffViewModel(RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT).objects, describeResult, RECIPE_PICKLIST_VALUES)
            );
        };

        const renderComparedRecipe = () => {
            const panel = renderFixture();
            panel.postToPanel(buildComparison(1));
            return panel;
        };

        const expand = (panel: any, objectElement: any) => panel.expandObject(objectElement);

        const badgesOf = (panel: any, objectElement: any) => panel.findAll(panel.objectBodyOf(objectElement), 'treeField')
            .filter((fieldElement: any) => !panel.isHidden(fieldElement))
            .map((fieldElement: any) => [
                panel.findAll(fieldElement, 'treeFieldName')[0].textContent,
                panel.findAll(fieldElement, 'diffBadge').map((badgeElement: any) => badgeElement.textContent).join('')
            ]);

        const chooseStatus = (panel: any, statusValue: string) => {
            const statusFilterElement = panel.findAll(panel.cockpitBodyElement, 'statusFilter')[0];
            statusFilterElement.value = statusValue;
            statusFilterElement.dispatch('change');
        };

        const objectDiffTextOf = (panel: any, objectElement: any) => panel.findAll(objectElement.children[0], 'objectDiff')[0];

        it('marks every row of a compared object with its status, and adds a row for each field only the org has', () => {

            const panel = renderComparedRecipe();
            const [accountElement] = panel.objectElements();

            expand(panel, accountElement);

            expect(badgesOf(panel, accountElement)).toEqual([
                ['Name', 'unchanged'],
                ['Industry', 'picklist changed'],
                ['Industry_Group__c', 'unchanged'],
                ['Number_of_Contacts__c', 'type changed'],
                ['Legacy_Code__c', 'removed from org'],
                ['Rating__c', 'new in org']
            ]);

            // A FIELD ONLY THE ORG HAS IS NOT IN ANY RECIPE FILE, SO THERE IS NO LINE TO OPEN
            const ratingRow = panel.findAll(accountElement, 'treeField')[5];
            expect(panel.findAll(ratingRow, 'treeFieldSource')).toEqual([]);
            expect(panel.findAll(ratingRow, 'picklistToggle')).toEqual([]);
            expect(panel.findAll(ratingRow, 'fieldType')[0].textContent).toBe('picklist');

        });

        it('says what changed on a row, not only that something did', () => {

            const panel = renderComparedRecipe();
            const [accountElement] = panel.objectElements();

            expand(panel, accountElement);

            const detailsOf = (rowIndex: number) => panel.findAll(panel.findAll(accountElement, 'treeField')[rowIndex], 'diffDetail').map((detailElement: any) => detailElement.textContent);

            expect(detailsOf(1)).toEqual([
                '1 value active in the org and not in the recipe: Retail',
                '1 value in the recipe and not active in the org: Banking'
            ]);
            expect(detailsOf(3)).toEqual(['recipe: Number · org: string']);
            expect(detailsOf(0)).toEqual([]);

        });

        it('names only the first picklist values on a row, and counts the rest', () => {

            const manyValues = Array.from({ length: RECIPE_COCKPIT_DIFF_PICKLIST_VALUES_SHOWN + 3 }, (unusedValue, valueIndex) => `Value_${String(valueIndex).padStart(2, '0')}`);
            const panel = renderFixture();
            panel.postToPanel(buildComparison(1, {
                ...ACCOUNT_ORG_DESCRIBE,
                fields: ACCOUNT_ORG_DESCRIBE.fields.map(orgField => orgField.fieldApiName === 'Industry'
                    ? { ...orgField, picklistValues: ['Agriculture', 'Banking', ...manyValues].map(value => buildOrgPicklistValue(value)) }
                    : orgField)
            }));

            const [accountElement] = panel.objectElements();
            expand(panel, accountElement);
            const [industryDetail] = panel.findAll(panel.findAll(accountElement, 'treeField')[1], 'diffDetail');

            expect(industryDetail.textContent).toStartWith(`${manyValues.length} values active in the org and not in the recipe: Value_00, `);
            expect(industryDetail.textContent).toEndWith(`Value_${String(RECIPE_COCKPIT_DIFF_PICKLIST_VALUES_SHOWN - 1).padStart(2, '0')} and 3 more`);

        });

        // A FAILED DESCRIBE IS NOT AN ORG WITHOUT THE OBJECT
        it('says an object that could not be described was not compared, and marks none of its rows', () => {

            const panel = renderComparedRecipe();
            const [accountElement, contactElement] = panel.objectElements();

            expect(objectDiffTextOf(panel, accountElement).textContent).toBe('1 new in org · 1 removed from org · 1 type changed · 1 picklist changed');
            expect(objectDiffTextOf(panel, accountElement).attributes.title).toBe('1 org field a recipe cannot write (system and formula fields) are not listed');
            expect(objectDiffTextOf(panel, contactElement).textContent).toBe('not compared');

            expand(panel, contactElement);
            expect(panel.findAll(contactElement, 'diffBadge')).toEqual([]);

        });

        it('sums the comparison under the describe summary, and offers to regenerate with what that can and cannot do', () => {

            const panel = renderComparedRecipe();
            const orgStatusElement = panel.findAll(panel.cockpitBodyElement, 'orgStatus')[0];

            expect(panel.findAll(orgStatusElement, 'diffSummary')[0].textContent)
                .toBe('Compared 1 object: 1 new in org · 1 removed from org · 1 type changed · 1 picklist changed · 2 unchanged');

            const [regenerateButton] = panel.findAll(orgStatusElement, 'regenerateRecipe');
            expect(regenerateButton.textContent).toBe(RECIPE_COCKPIT_REGENERATE_ACTION_LABEL);
            expect(panel.findAll(orgStatusElement, 'regenerateNote')[0].textContent).toBe(RECIPE_COCKPIT_REGENERATE_NOTE);
            expect(RECIPE_COCKPIT_REGENERATE_NOTE).toContain('not from the org');

            regenerateButton.dispatch('click');

            expect(panel.postedHostMessages[panel.postedHostMessages.length - 1]).toEqual({ command: 'regenerateRecipe', treeKey: COMPARED_TREE_KEY });
            expect(regenerateButton.disabled).toBe(true);

        });

        it('offers no status filter and no regenerate until something has been compared', () => {

            const panel = renderFixture();

            expect(panel.isHidden(panel.findAll(panel.cockpitBodyElement, 'statusFilter')[0])).toBe(true);

            panel.postToPanel(RecipeCockpitService.buildOrgDescribeMessage(COMPARED_TREE_KEY, COMPARED_ORG_LABEL, {
                outcomes: accountOnlyDescribeResult.outcomes.map(describeOutcome => ({ objectApiName: describeOutcome.objectApiName, failureMessage: 'NOT_FOUND', wasCached: false })),
                wasCancelled: false
            }, 1));

            expect(panel.isHidden(panel.findAll(panel.cockpitBodyElement, 'statusFilter')[0])).toBe(true);
            expect(panel.findAll(panel.cockpitBodyElement, 'regenerateRecipe')).toEqual([]);
            expect(panel.objectElements().map((objectElement: any) => objectDiffTextOf(panel, objectElement).textContent)).toEqual(['not compared', 'not compared']);

        });

        it('given "changed fields only", shows only the rows that differ, and hides every row of an object not compared', () => {

            const panel = renderComparedRecipe();
            const [accountElement, contactElement] = panel.objectElements();

            expect(panel.isHidden(panel.findAll(panel.cockpitBodyElement, 'statusFilter')[0])).toBe(false);

            chooseStatus(panel, 'changed');

            expect(panel.visibleFieldNamesOf(accountElement)).toEqual(['Industry', 'Number_of_Contacts__c', 'Legacy_Code__c', 'Rating__c']);
            expect(panel.objectCountOf(accountElement)).toBe('4 of 6 fields');
            expect(panel.objectCountOf(contactElement)).toBe('no matching fields');
            expect(panel.isHidden(contactElement)).toBe(false);
            expect(panel.findAll(panel.cockpitBodyElement, 'treeMatchCount')[0].textContent).toBe('4 of 8 fields · 1 of 1 tree');

        });

        it('narrows to one status, and combines with the text filter', () => {

            const panel = renderComparedRecipe();
            const [accountElement] = panel.objectElements();

            chooseStatus(panel, 'removed-from-org');
            expect(panel.visibleFieldNamesOf(accountElement)).toEqual(['Legacy_Code__c']);

            chooseStatus(panel, 'unchanged');
            panel.typeIntoFilter('industry');
            expect(panel.visibleFieldNamesOf(accountElement)).toEqual(['Industry_Group__c']);

            // A STATUS STILL NARROWS AN OBJECT NAMED IN THE FIND BOX
            panel.typeIntoFilter('account');
            expect(panel.visibleFieldNamesOf(accountElement)).toEqual(['Name', 'Industry_Group__c']);
            expect(panel.objectCountOf(accountElement)).toBe('2 of 6 fields');

        });

        it('given every filter is cleared, shows every row and puts back what the reader had open', () => {

            const panel = renderComparedRecipe();
            const [accountElement, contactElement] = panel.objectElements();

            expand(panel, contactElement);
            chooseStatus(panel, 'changed');
            chooseStatus(panel, 'all');

            expect(panel.isHidden(panel.objectBodyOf(accountElement))).toBe(true);
            expect(panel.isHidden(panel.objectBodyOf(contactElement))).toBe(false);
            expect(panel.objectCountOf(accountElement)).toBe('6 fields');

        });

        it('given a later comparison, rebuilds the rows from it rather than keeping the previous org\'s', () => {

            const panel = renderComparedRecipe();
            const [accountElement] = panel.objectElements();
            expand(panel, accountElement);

            panel.postToPanel(buildComparison(1, { ...ACCOUNT_ORG_DESCRIBE, fields: ACCOUNT_ORG_DESCRIBE.fields.filter(orgField => orgField.fieldApiName !== 'Rating__c') }));

            expect(badgesOf(panel, accountElement).map(([fieldApiName]: string[]) => fieldApiName)).not.toContain('Rating__c');
            expect(panel.findAll(accountElement, 'treeField')).toHaveLength(5);

        });

        it('given the next comparison cannot connect, clears every status and the filter rather than leaving the old answer', () => {

            const panel = renderComparedRecipe();
            const [accountElement] = panel.objectElements();
            chooseStatus(panel, 'changed');

            panel.postToPanel(RecipeCockpitService.buildOrgConnectionFailureMessage(COMPARED_TREE_KEY, COMPARED_ORG_LABEL, new Error('expired'), 1));

            expand(panel, accountElement);
            expect(panel.findAll(accountElement, 'diffBadge')).toEqual([]);
            expect(panel.visibleFieldNamesOf(accountElement)).toHaveLength(5);
            expect(panel.isHidden(panel.findAll(panel.cockpitBodyElement, 'statusFilter')[0])).toBe(true);
            expect(panel.isHidden(objectDiffTextOf(panel, accountElement))).toBe(true);
            expect(panel.findAll(panel.cockpitBodyElement, 'regenerateRecipe')).toEqual([]);

        });

        it('given a new model, starts it with every field shown whatever status was chosen before', () => {

            const panel = renderComparedRecipe();
            chooseStatus(panel, 'new-in-org');

            panel.postToPanel({ command: 'recipeData', recipe: RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT), renderSequence: 2 });
            panel.expandAllTrees();

            const [accountElement] = panel.objectElements();
            expand(panel, accountElement);
            expect(panel.visibleFieldNamesOf(accountElement)).toHaveLength(5);
            expect(panel.findAll(panel.cockpitBodyElement, 'statusFilter')[0].value).toBe('all');

        });

        it('shows where a comparison is while it runs, and replaces it with the answer', () => {

            const panel = renderFixture();
            const orgProgressElement = panel.findAll(panel.cockpitBodyElement, 'orgProgress')[0];

            expect(panel.isHidden(orgProgressElement)).toBe(true);

            panel.postToPanel({ command: 'orgProgress', treeKey: COMPARED_TREE_KEY, message: 'Comparing with devhub: described 1 of 2 objects…', renderSequence: 1 });
            expect(panel.isHidden(orgProgressElement)).toBe(false);
            expect(orgProgressElement.textContent).toBe('Comparing with devhub: described 1 of 2 objects…');

            panel.postToPanel(buildComparison(1));
            expect(panel.isHidden(orgProgressElement)).toBe(true);

        });

        it('given the comparison ended with no answer, hides its progress line', () => {

            const panel = renderFixture();
            const orgProgressElement = panel.findAll(panel.cockpitBodyElement, 'orgProgress')[0];

            panel.postToPanel({ command: 'orgProgress', treeKey: COMPARED_TREE_KEY, message: 'Comparing with devhub: described 2 of 2 objects…', renderSequence: 1 });
            panel.postToPanel({ command: 'orgProgress', treeKey: COMPARED_TREE_KEY, message: '', renderSequence: 1 });

            expect(panel.isHidden(orgProgressElement)).toBe(true);

        });

        it('says why an object was not compared, in the describe\'s own words', () => {

            const panel = renderFixture();
            const cancelledDescribeResult = {
                outcomes: [
                    { objectApiName: 'Account', describe: ACCOUNT_ORG_DESCRIBE, wasCached: false },
                    { objectApiName: 'Contact', failureMessage: ORG_DESCRIBE_CANCELLED_MESSAGE, wasCached: false }
                ],
                wasCancelled: true
            };
            panel.postToPanel(RecipeCockpitService.buildOrgDescribeMessage(COMPARED_TREE_KEY, COMPARED_ORG_LABEL, cancelledDescribeResult, 1,
                RecipeCockpitService.buildRecipeDiffViewModel(RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT).objects, cancelledDescribeResult, new Map())));

            const [, contactElement] = panel.objectElements();

            expect(objectDiffTextOf(panel, contactElement).attributes.title).toBe(`Not compared: ${ORG_DESCRIBE_CANCELLED_MESSAGE}`);

        });

        it('given progress of a comparison of another model, draws nothing', () => {

            const panel = renderFixture(2);

            panel.postToPanel({ command: 'orgProgress', treeKey: COMPARED_TREE_KEY, message: 'Comparing…', renderSequence: 1 });

            expect(panel.isHidden(panel.findAll(panel.cockpitBodyElement, 'orgProgress')[0])).toBe(true);
            expect(() => runPanelScript().postToPanel({ command: 'orgProgress', treeKey: COMPARED_TREE_KEY, message: 'Comparing…', renderSequence: 1 })).not.toThrow();

        });


        // A CARD COLLAPSED WHEN ITS ANSWER ARRIVES STILL HAS IT WHEN THE READER OPENS IT
        it('given a comparison of a card that is not open, draws it when the card is opened', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT), renderSequence: 1 });
            panel.postToPanel(buildComparison(1));

            panel.expandAllTrees();
            const [accountElement] = panel.objectElements();
            expand(panel, accountElement);

            expect(panel.findAll(panel.findAll(panel.cockpitBodyElement, 'orgStatus')[0], 'diffSummary')).toHaveLength(1);
            expect(badgesOf(panel, accountElement)).toContainEqual(['Rating__c', 'new in org']);

        });

        /*
            The model split into two cards, Account's and Contact's: a comparison and a status filter
            belong to the card they were asked from, and the other card's rows are left as they were.
        */
        describe('given two cards', () => {

            const buildTwoTreeRecipe = (): IRecipeCockpitRecipeViewModel => ({
                ...RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT),
                trees: [
                    { treeKey: 'Account-ONLY', title: 'Relationship Tree 1', folderName: 'Account-ONLY', fieldCount: 5, objects: [{ objectApiName: 'Account', parentLookups: [] }] },
                    { treeKey: 'Contact-ONLY', title: 'Relationship Tree 2', folderName: 'Contact-ONLY', fieldCount: 2, objects: [{ objectApiName: 'Contact', parentLookups: [] }] }
                ]
            });

            const renderTwoTrees = () => {
                const panel = runPanelScript();
                panel.postToPanel({ command: 'recipeData', recipe: buildTwoTreeRecipe(), renderSequence: 1 });
                panel.expandAllTrees();
                panel.postToPanel({ ...buildComparison(1), treeKey: 'Account-ONLY' });
                return panel;
            };

            it('draws a comparison only in the card it names, and offers Compare in each card', () => {

                const panel = renderTwoTrees();
                const [accountCard, contactCard] = panel.treeCards();
                const [accountElement, contactElement] = panel.objectElements();

                expect(panel.findAll(panel.cockpitBodyElement, 'describeInOrg')).toHaveLength(2);
                expect(panel.isHidden(panel.findAll(accountCard, 'orgStatus')[0])).toBe(false);
                expect(panel.isHidden(panel.findAll(contactCard, 'orgStatus')[0])).toBe(true);
                expect(panel.isHidden(objectDiffTextOf(panel, accountElement))).toBe(false);
                // NOT "not compared": THIS CARD WAS NEVER COMPARED, SO IT SAYS NOTHING ABOUT AN ORG
                expect(panel.isHidden(objectDiffTextOf(panel, contactElement))).toBe(true);
                expect(panel.isHidden(panel.findAll(contactCard, 'statusFilter')[0])).toBe(true);

                panel.findAll(contactCard, 'describeInOrg')[0].dispatch('click');
                expect(panel.postedHostMessages[panel.postedHostMessages.length - 1]).toEqual({ command: 'selectOrg', treeKey: 'Contact-ONLY' });

            });

            it('narrows only the card whose status filter was chosen, and keeps that card open', () => {

                const panel = renderTwoTrees();
                const [accountCard, contactCard] = panel.treeCards();
                const [accountElement, contactElement] = panel.objectElements();
                expand(panel, contactElement);

                const statusFilterElement = panel.findAll(accountCard, 'statusFilter')[0];
                statusFilterElement.value = 'removed-from-org';
                statusFilterElement.dispatch('change');

                expect(panel.visibleFieldNamesOf(accountElement)).toEqual(['Legacy_Code__c']);
                expect(panel.isHidden(panel.findAll(accountCard, 'treeBody')[0])).toBe(false);
                expect(panel.visibleFieldNamesOf(contactElement)).toEqual(['LastName', 'AccountId']);
                expect(panel.objectCountOf(contactElement)).toBe('2 fields');

                // A STATUS NO ROW HAS STILL LEAVES THE CARD THE FILTER IS IN ON SCREEN
                statusFilterElement.value = 'new-in-org';
                statusFilterElement.dispatch('change');
                statusFilterElement.value = 'type-changed';
                statusFilterElement.dispatch('change');
                panel.postToPanel({ ...buildComparison(1, { ...ACCOUNT_ORG_DESCRIBE, fields: ACCOUNT_ORG_DESCRIBE.fields.filter(orgField => orgField.fieldApiName !== 'Number_of_Contacts__c') }), treeKey: 'Account-ONLY' });
                expect(statusFilterElement.value).toBe('type-changed');
                expect(panel.isHidden(panel.findAll(accountCard, 'treeBody')[0])).toBe(false);
                expect(panel.isHidden(panel.findAll(contactCard, 'treeBody')[0])).toBe(false);

            });

            // THE HOST RUNS ONE REGENERATE AT A TIME, SO A SECOND CARD'S CLICK WOULD BE REFUSED AND ITS BUTTON LEFT "Regenerating…"
            it('given Regenerate is clicked in one card, disables Regenerate in every card', () => {

                const panel = renderTwoTrees();
                const [accountCard, contactCard] = panel.treeCards();
                panel.postToPanel({ ...buildComparison(1), treeKey: 'Contact-ONLY', objects: [], diff: { ...buildComparison(1).diff } });

                const [accountRegenerate] = panel.findAll(accountCard, 'regenerateRecipe');
                const [contactRegenerate] = panel.findAll(contactCard, 'regenerateRecipe');
                accountRegenerate.dispatch('click');

                expect(accountRegenerate.disabled).toBe(true);
                expect(accountRegenerate.textContent).toBe('Regenerating…');
                expect(contactRegenerate.disabled).toBe(true);
                expect(contactRegenerate.textContent).toBe(RECIPE_COCKPIT_REGENERATE_ACTION_LABEL);
                expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'regenerateRecipe')).toEqual([{ command: 'regenerateRecipe', treeKey: 'Account-ONLY' }]);

            });

            it('given the find box is scoped to one card, still counts another card its own status filter narrows', () => {

                const panel = renderTwoTrees();
                const [accountCard, contactCard] = panel.treeCards();

                panel.findAll(contactCard, 'treeScope')[0].dispatch('click');
                const statusFilterElement = panel.findAll(accountCard, 'statusFilter')[0];
                statusFilterElement.value = 'removed-from-org';
                statusFilterElement.dispatch('change');

                expect(panel.findAll(accountCard, 'treeMatch')[0].textContent).toBe('1 matching field');
                expect(panel.findAll(panel.cockpitBodyElement, 'treeMatchCount')[0].textContent).toBe('3 of 8 fields · 2 of 2 trees');

            });

            it('given a comparison naming a card the model does not draw, draws nothing and does not throw', () => {

                const panel = renderTwoTrees();

                expect(() => panel.postToPanel({ ...buildComparison(1), treeKey: 'Lead-ONLY' })).not.toThrow();
                expect(() => panel.postToPanel({ command: 'orgProgress', treeKey: 'Lead-ONLY', message: 'Comparing…', renderSequence: 1 })).not.toThrow();

            });

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

            it('lists every run carrying the tree\'s folder, newest first by timestamp rather than by name, marking the current one and a backend change', () => {

                const { historiesByTreeKey } = RecipeCockpitTreeHistory.groupTreeHistories(KNOWN_RUNS, [], TREES, 'recipe-2026-09-20T10-00-00');

                expect(historiesByTreeKey.get('Lead-ONLY').versions).toEqual([
                    { runFolderName: 'recipe-2026-09-20T10-00-00', generatedAtLabel: '2026-09-20 10:00:00 UTC', fakerService: 'snowfakery', isCurrent: true, isBackendDifferent: false, isDiffable: false },
                    { runFolderName: 'recipe-fakerjs-2026-09-10T00-00-00', generatedAtLabel: '2026-09-10 00:00:00 UTC', fakerService: 'faker-js', isCurrent: false, isBackendDifferent: true, isDiffable: false },
                    { runFolderName: 'recipe-2026-09-01T00-00-00', generatedAtLabel: '2026-09-01 00:00:00 UTC', fakerService: 'snowfakery', isCurrent: false, isBackendDifferent: false, isDiffable: false }
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

            it('summarizes a version whose run has no objects wrapper from nothing, so it reads as unavailable', () => {

                const { targets } = RecipeCockpitTreeHistory.buildTreeHistories(
                    HISTORY_GENERATED_RECIPES_PATH,
                    path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'FakeDataSets'),
                    HISTORY_WORKSPACE_ROOT,
                    HISTORY_CURRENT_RUN,
                    [{ treeKey: 'Lead-ONLY', folderName: 'Lead-ONLY' }],
                    new Map()
                );

                expect(targets.summarySourcesByTreeKey.get('Lead-ONLY').runs.map(summaryRun => summaryRun.objectsWrapperFilePath)).toEqual(['', '', '']);
                expect(RecipeCockpitService.readRunFieldCounts('', HISTORY_WORKSPACE_ROOT)).toBeUndefined();

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

        describe('version summaries, tested pure', () => {

            it('words a version\'s field count against the current one, from the version\'s side', () => {

                expect(RecipeCockpitTreeHistory.formatFieldCountChange(12, 10)).toBe('+2 fields');
                expect(RecipeCockpitTreeHistory.formatFieldCountChange(9, 10)).toBe('−1 field');
                expect(RecipeCockpitTreeHistory.formatFieldCountChange(10, 10)).toBe('same field count');

            });

            it('claims no change for the current version, an unavailable one, or any version when the current one is unavailable', () => {

                const summarySource = {
                    treeFolderName: 'Lead-ONLY',
                    currentRunFolderName: 'current',
                    runs: ['current', 'older', 'unreadable'].map(runFolderName => ({ runFolderName, objectsWrapperFilePath: '', treeFolderPath: '' }))
                };

                expect(RecipeCockpitTreeHistory.buildVersionSummaries(summarySource, new Map([['current', 4], ['older', 6], ['unreadable', undefined]]))).toEqual([
                    { runFolderName: 'current', isSummaryAvailable: true, fieldCount: 4, changeText: '' },
                    { runFolderName: 'older', isSummaryAvailable: true, fieldCount: 6, changeText: '+2 fields' },
                    { runFolderName: 'unreadable', isSummaryAvailable: false, fieldCount: 0, changeText: '' }
                ]);
                expect(RecipeCockpitTreeHistory.buildVersionSummaries(summarySource, new Map([['older', 6]])).map(summary => summary.changeText)).toEqual(['', '', '']);

            });

            it('reads a run\'s tree field count from its RecipeFiles, or through the tree\'s recipe file when it has none, and nothing from an unreadable wrapper', () => {

                const fieldCountOf = (runFolderName: string, treeFolderName: string) => {
                    const runFolderPath = path.join(HISTORY_GENERATED_RECIPES_PATH, runFolderName);
                    const objectsWrapperFileName = fs.readdirSync(runFolderPath).find(fileName => fileName.endsWith('.json'));
                    return RecipeCockpitService.readTreeFieldCount(
                        RecipeCockpitService.readRunFieldCounts(path.join(runFolderPath, objectsWrapperFileName), HISTORY_WORKSPACE_ROOT),
                        treeFolderName,
                        path.join(runFolderPath, treeFolderName),
                        HISTORY_WORKSPACE_ROOT
                    );
                };

                expect(fieldCountOf(HISTORY_CURRENT_RUN, 'Account-thru-OtherChildObject__c')).toBe(12);
                expect(fieldCountOf(HISTORY_CURRENT_RUN, 'Lead-ONLY')).toBe(2);
                expect(fieldCountOf(HISTORY_CURRENT_RUN, 'Not-A-Tree')).toBeUndefined();
                expect(fieldCountOf('recipe-2026-09-01T00-00-00', 'Lead-ONLY')).toBe(3);
                expect(fieldCountOf('recipe-fakerjs-2026-09-10T00-00-00', 'Lead-ONLY')).toBeUndefined();
                expect(fieldCountOf('recipe-2026-09-01T00-00-00', 'Not-A-Tree')).toBeUndefined();
                expect(RecipeCockpitService.readRunFieldCounts('', HISTORY_WORKSPACE_ROOT)).toBeUndefined();

            });

            it('reads nothing from a JSON file that is not an objects wrapper, or from a tree recipe that cannot be read', () => {

                const temporaryWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-summary-'));

                try {

                    const notAWrapperFilePath = path.join(temporaryWorkspaceRoot, 'notAWrapper.json');
                    fs.writeFileSync(notAWrapperFilePath, JSON.stringify({ something: 'else' }));

                    expect(RecipeCockpitService.readRunFieldCounts(notAWrapperFilePath, temporaryWorkspaceRoot)).toBeUndefined();

                    const leadTreeFolderPath = path.join(HISTORY_GENERATED_RECIPES_PATH, 'recipe-2026-09-01T00-00-00', 'Lead-ONLY');
                    const runFieldCounts = { fieldCountsByObjectApiName: new Map([['Lead', 3]]), fieldCountsByTreeFolderName: new Map<string, number>(), hasTreeData: false };
                    // AN OBJECT THE TREE'S RECIPE CARRIES AND THE WRAPPER DOES NOT ADDS NO FIELDS, RATHER THAN MAKING THE COUNT NaN
                    expect(RecipeCockpitService.readTreeFieldCount({ ...runFieldCounts, fieldCountsByObjectApiName: new Map() }, 'Lead-ONLY', leadTreeFolderPath, HISTORY_WORKSPACE_ROOT)).toBe(0);

                    // THE TREE'S RECIPE IS READ ONLY WHILE IT IS INSIDE THE WORKSPACE IT IS READ FOR
                    expect(RecipeCockpitService.readTreeFieldCount(runFieldCounts, 'Lead-ONLY', leadTreeFolderPath, temporaryWorkspaceRoot)).toBeUndefined();

                    jest.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('EACCES'); });

                    expect(RecipeCockpitService.readTreeFieldCount(runFieldCounts, 'Lead-ONLY', leadTreeFolderPath, HISTORY_WORKSPACE_ROOT)).toBeUndefined();

                } finally {
                    jest.restoreAllMocks();
                    fs.rmSync(temporaryWorkspaceRoot, { recursive: true, force: true });
                }

            });

        });

        describe('loadRecipeRunByRuns, with data sets on disk', () => {

            it('gives each card with a tree folder its versions and data sets, and counts the unmatched data sets in one notice', () => {

                const { recipeViewModel } = loadHistoryRecipe();
                const leadTree = recipeViewModel.trees.find(tree => tree.treeKey === LEAD_TREE_KEY);
                const accountTree = recipeViewModel.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY);

                expect(leadTree.history.versions.map(version => [version.runFolderName, version.isCurrent, version.isDiffable])).toEqual([
                    [HISTORY_CURRENT_RUN, true, false],
                    ['recipe-fakerjs-2026-09-10T00-00-00', false, true],
                    ['recipe-2026-09-01T00-00-00', false, true]
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
                expect([...treeHistoryTargets.diffTargetsByKey.keys()]).toEqual([
                    RecipeCockpitTreeHistory.buildDiffKey(LEAD_TREE_KEY, 'recipe-fakerjs-2026-09-10T00-00-00'),
                    RecipeCockpitTreeHistory.buildDiffKey(LEAD_TREE_KEY, 'recipe-2026-09-01T00-00-00')
                ]);

            });

            it('leaves out a data set, and a version\'s diff, whose path resolves outside the workspace', () => {

                const realIsPathContainedInWorkspace = SfdxProjectService.isPathContainedInWorkspace.bind(SfdxProjectService);
                jest.spyOn(SfdxProjectService, 'isPathContainedInWorkspace').mockImplementation((candidatePath: string, workspaceRoot: string) => (
                    !candidatePath.includes('dataset-2026-09-21T00-00-00') && !candidatePath.includes('recipe-2026-09-01T00-00-00')
                    && realIsPathContainedInWorkspace(candidatePath, workspaceRoot)
                ));

                const { recipeViewModel, treeHistoryTargets } = loadHistoryRecipe();
                const leadTree = recipeViewModel.trees.find(tree => tree.treeKey === LEAD_TREE_KEY);

                expect(leadTree.history.datasets.map(dataset => dataset.datasetFolderName)).not.toContain('dataset-2026-09-21T00-00-00');
                expect(treeHistoryTargets.datasetFolderPathsByName.has('dataset-2026-09-21T00-00-00')).toBe(false);
                expect(leadTree.history.versions.find(version => version.runFolderName === 'recipe-2026-09-01T00-00-00').isDiffable).toBe(false);

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

                expect([...allowLists.summaryTreeKeys]).toEqual([ACCOUNT_TREE_KEY, LEAD_TREE_KEY]);
                expect([...allowLists.countableDatasetFolderNames]).toEqual(['dataset-2026-09-02T00-00-00']);
                expect([...allowLists.openableDatasetFolderNames].sort()).toEqual([
                    'dataset-2026-09-02T00-00-00', 'dataset-2026-09-15T00-00-00', 'dataset-2026-09-21T00-00-00', 'dataset-2026-09-21T00-00-00-2'
                ]);
                expect(allowLists.insertableDatasetFolderNames).toEqual(allowLists.openableDatasetFolderNames);
                expect(allowLists.diffKeys.size).toBe(2);

            });

            it('offers nothing from a card that has no history', () => {

                const { recipeViewModel } = loadHistoryRecipe();
                recipeViewModel.trees.forEach(tree => { delete tree.history; });

                const allowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipeViewModel);

                expect([allowLists.summaryTreeKeys, allowLists.diffKeys, allowLists.openableDatasetFolderNames, allowLists.countableDatasetFolderNames].map(allowList => allowList.size))
                    .toEqual([0, 0, 0, 0]);

            });

            it('answers nothing for an allow-listed name the host holds no target for', () => {

                const panelState = buildHistoryPanelState();
                panelState.treeHistoryTargets = RecipeCockpitTreeHistory.buildEmptyTargets();

                [
                    { command: 'loadVersionSummaries', treeKey: LEAD_TREE_KEY },
                    { command: 'loadDatasetRecordCounts', datasetFolderName: 'dataset-2026-09-02T00-00-00' },
                    { command: 'diffTreeVersion', treeKey: LEAD_TREE_KEY, runFolderName: 'recipe-2026-09-01T00-00-00' },
                    { command: 'openDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00' }
                ].forEach(panelMessage => expect(RecipeCockpitService.routePanelMessage(panelMessage, panelState)).toBeUndefined());

            });

            it('routes every history action only once the model is confirmed drawn', () => {

                const panelState = buildHistoryPanelState(false);

                [
                    { command: 'loadVersionSummaries', treeKey: LEAD_TREE_KEY },
                    { command: 'loadDatasetRecordCounts', datasetFolderName: 'dataset-2026-09-02T00-00-00' },
                    { command: 'diffTreeVersion', treeKey: LEAD_TREE_KEY, runFolderName: 'recipe-2026-09-01T00-00-00' },
                    { command: 'openDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00' },
                    { command: 'insertDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00' }
                ].forEach(panelMessage => expect(RecipeCockpitService.routePanelMessage(panelMessage, panelState)).toBeUndefined());

            });

            it('resolves a posted name through the host\'s own map, never a posted path', () => {

                const panelState = buildHistoryPanelState();
                const datasetFolderPath = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'FakeDataSets', 'dataset-2026-09-21T00-00-00');

                expect(RecipeCockpitService.routePanelMessage({ command: 'openDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00', filePath: '/etc' }, panelState))
                    .toEqual({ kind: 'openDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00', datasetFolderPath: datasetFolderPath });
                expect(RecipeCockpitService.routePanelMessage({ command: 'insertDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00', treeKey: LEAD_TREE_KEY, tab: 'versions' }, panelState))
                    .toEqual({ kind: 'insertDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00', datasetFolderPath: datasetFolderPath, focusTree: { treeKey: LEAD_TREE_KEY, tab: 'versions' } });
                expect(RecipeCockpitService.routePanelMessage({ command: 'loadVersionSummaries', treeKey: LEAD_TREE_KEY }, panelState))
                    .toMatchObject({ kind: 'loadVersionSummaries', treeKey: LEAD_TREE_KEY, renderSequence: 7, summarySource: { treeFolderName: 'Lead-ONLY', currentRunFolderName: HISTORY_CURRENT_RUN } });
                expect(RecipeCockpitService.routePanelMessage({ command: 'loadDatasetRecordCounts', datasetFolderName: 'dataset-2026-09-02T00-00-00' }, panelState))
                    .toEqual({ kind: 'loadDatasetRecordCounts', datasetFolderName: 'dataset-2026-09-02T00-00-00', datasetFolderPath: path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'FakeDataSets', 'dataset-2026-09-02T00-00-00'), renderSequence: 7 });
                expect(RecipeCockpitService.routePanelMessage({ command: 'diffTreeVersion', treeKey: LEAD_TREE_KEY, runFolderName: 'recipe-2026-09-01T00-00-00' }, panelState))
                    .toMatchObject({ kind: 'diffTreeVersion', versionRecipeFilePath: expect.stringContaining('recipe--Lead-ONLY-2026-09-01T00-00-00.yml') });

            });

            it('answers nothing for a name the rendered model did not offer, a payload of the wrong type, or a focus it did not draw', () => {

                const panelState = buildHistoryPanelState();

                [
                    { command: 'loadVersionSummaries', treeKey: 'Opportunity-ONLY' },
                    { command: 'loadVersionSummaries', treeKey: 42 },
                    { command: 'loadDatasetRecordCounts', datasetFolderName: 'dataset-2026-09-21T00-00-00' },
                    { command: 'loadDatasetRecordCounts', datasetFolderName: 'dataset-2026-09-16T00-00-00' },
                    { command: 'diffTreeVersion', treeKey: LEAD_TREE_KEY, runFolderName: HISTORY_CURRENT_RUN },
                    { command: 'diffTreeVersion', treeKey: ACCOUNT_TREE_KEY, runFolderName: 'recipe-2026-09-01T00-00-00' },
                    { command: 'diffTreeVersion', treeKey: LEAD_TREE_KEY, runFolderName: ['recipe-2026-09-01T00-00-00'] },
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

            it('draws Previous Versions newest first, with date, backend, the current one marked, a backend change and Diff only where it can', () => {

                const { panel } = renderHistoryRecipe();
                const leadCard = openTab(panel, 'Lead-ONLY', 'Previous Versions');

                expect(panel.isHidden(panel.findAll(leadCard, 'treeStructure')[0])).toBe(true);
                expect(panel.isHidden(panel.findAll(leadCard, 'treeVersions')[0])).toBe(false);
                expect(textOf(panel, leadCard, 'treeVersionDate')).toEqual(['2026-09-20 10:00:00 UTC', '2026-09-10 00:00:00 UTC', '2026-09-01 00:00:00 UTC']);
                expect(textOf(panel, leadCard, 'treeVersionBackend')).toEqual(['snowfakery', 'faker-js', 'snowfakery']);
                expect(textOf(panel, leadCard, 'treeVersionCurrent')).toEqual(['current']);
                expect(textOf(panel, leadCard, 'treeVersionBackendChange')).toEqual(['backend ≠']);
                expect(textOf(panel, leadCard, 'treeVersionDiff')).toEqual(['Diff', 'Diff']);
                expect(textOf(panel, leadCard, 'treeVersionFields')).toEqual(['Loading summary…', 'Loading summary…', 'Loading summary…']);

                panel.findAll(leadCard, 'treeVersionDiff')[1].dispatch('click');

                expect(postedNamed(panel, 'diffTreeVersion')).toEqual([{ command: 'diffTreeVersion', treeKey: LEAD_TREE_KEY, runFolderName: 'recipe-2026-09-01T00-00-00' }]);

            });

            it('asks for the summaries once, when the tab is first opened, and draws the answer for the model on screen only', () => {

                const { panel } = renderHistoryRecipe(4);
                const leadCard = openTab(panel, 'Lead-ONLY', 'Previous Versions');
                clickNamed(panel, leadCard, 'treeTab', 'Structure');
                clickNamed(panel, leadCard, 'treeTab', 'Previous Versions');

                expect(postedNamed(panel, 'loadVersionSummaries')).toEqual([{ command: 'loadVersionSummaries', treeKey: LEAD_TREE_KEY }]);

                const summaries = [
                    { runFolderName: HISTORY_CURRENT_RUN, isSummaryAvailable: true, fieldCount: 2, changeText: '' },
                    { runFolderName: 'recipe-fakerjs-2026-09-10T00-00-00', isSummaryAvailable: false, fieldCount: 0, changeText: '' },
                    { runFolderName: 'recipe-2026-09-01T00-00-00', isSummaryAvailable: true, fieldCount: 3, changeText: '+1 field' }
                ];

                panel.postToPanel({ command: 'versionSummaries', treeKey: LEAD_TREE_KEY, summaries: summaries, renderSequence: 3 });
                expect(textOf(panel, leadCard, 'treeVersionFields')).toEqual(['Loading summary…', 'Loading summary…', 'Loading summary…']);

                panel.postToPanel({ command: 'versionSummaries', treeKey: LEAD_TREE_KEY, summaries: summaries, renderSequence: 4 });
                expect(textOf(panel, leadCard, 'treeVersionFields')).toEqual(['2 fields', 'summary unavailable', '3 fields']);
                expect(textOf(panel, leadCard, 'treeVersionChange')).toEqual(['', '', '+1 field']);

            });

            it('expands a version to the data sets made from it, asking for a legacy data set\'s counts and drawing a recorded one\'s', () => {

                const { panel } = renderHistoryRecipe(2);
                const leadCard = openTab(panel, 'Lead-ONLY', 'Previous Versions');
                const versionToggles = panel.findAll(leadCard, 'treeVersionToggle');

                versionToggles[0].dispatch('click');
                versionToggles[1].dispatch('click');
                versionToggles[2].dispatch('click');

                const versionBodies = panel.findAll(leadCard, 'treeVersionBody');

                expect(textOf(panel, versionBodies[0], 'treeDatasetFolder')).toEqual(['dataset-2026-09-21T00-00-00']);
                expect(textOf(panel, versionBodies[0], 'treeDatasetCounts')).toEqual(['Lead: 5 records']);
                expect(textOf(panel, versionBodies[1], 'treeEmpty')).toEqual(['No data sets were made from this version.']);
                expect(textOf(panel, versionBodies[2], 'treeDatasetCounts')).toEqual(['Loading record counts…']);
                expect(postedNamed(panel, 'loadDatasetRecordCounts')).toEqual([{ command: 'loadDatasetRecordCounts', datasetFolderName: 'dataset-2026-09-02T00-00-00' }]);

                panel.postToPanel({
                    command: 'datasetRecordCounts', datasetFolderName: 'dataset-2026-09-02T00-00-00',
                    recordCounts: [{ objectApiName: 'Lead', recordCount: 3 }], failureMessage: 'Could not count the records in collectionsApi-Broken.json.', renderSequence: 2
                });

                expect(textOf(panel, versionBodies[2], 'treeDatasetCounts')).toEqual(['Lead: 3 records · Could not count the records in collectionsApi-Broken.json.']);

            });

            it('lists every data set of the tree newest first on Previous Fake Sets, tagged with its version or "version unknown"', () => {

                const { panel } = renderHistoryRecipe();
                const leadCard = openTab(panel, 'Lead-ONLY', 'Previous Fake Sets');

                expect(textOf(panel, leadCard, 'treeDatasetDate')).toEqual(['2026-09-21 00:00:00 UTC', '2026-09-15 00:00:00 UTC', '2026-09-02 00:00:00 UTC']);
                expect(textOf(panel, leadCard, 'treeDatasetVersion')).toEqual(['current version', 'version unknown', 'version of 2026-09-01 00:00:00 UTC']);
                expect(textOf(panel, leadCard, 'treeDatasetCounts')).toEqual(['Lead: 5 records', 'Lead: 7 records', '']);

            });

            it('reads a legacy data set\'s counts on the Fake Sets tab only when the reader asks for them', () => {

                const { panel } = renderHistoryRecipe(3);
                const leadCard = openTab(panel, 'Lead-ONLY', 'Previous Fake Sets');

                expect(postedNamed(panel, 'loadDatasetRecordCounts')).toEqual([]);
                expect(textOf(panel, leadCard, 'treeDatasetCountsLoad')).toEqual(['Show record counts']);

                panel.findAll(leadCard, 'treeDatasetCountsLoad')[0].dispatch('click');

                expect(postedNamed(panel, 'loadDatasetRecordCounts')).toEqual([{ command: 'loadDatasetRecordCounts', datasetFolderName: 'dataset-2026-09-02T00-00-00' }]);
                expect(textOf(panel, leadCard, 'treeDatasetCounts')[2]).toBe('Loading record counts…');

                panel.postToPanel({ command: 'datasetRecordCounts', datasetFolderName: 'dataset-2026-09-02T00-00-00', recordCounts: [{ objectApiName: 'Lead', recordCount: 3 }], failureMessage: '', renderSequence: 3 });

                expect(textOf(panel, leadCard, 'treeDatasetCounts')[2]).toBe('Lead: 3 records');

            });

            it('posts Open and Insert by data set name, with the card and tab they came from', () => {

                const { panel } = renderHistoryRecipe();
                const accountCard = openTab(panel, ACCOUNT_TREE_KEY, 'Previous Fake Sets');

                panel.findAll(accountCard, 'treeDatasetOpen')[0].dispatch('click');
                panel.findAll(accountCard, 'treeDatasetInsert')[0].dispatch('click');

                expect(textOf(panel, accountCard, 'treeDatasetCounts')).toEqual(['Account: 2 records · Contact: 4 records · OtherChildObject__c: 0 records']);
                expect(postedNamed(panel, 'openDataset')).toEqual([{ command: 'openDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00-2', treeKey: ACCOUNT_TREE_KEY, tab: 'datasets' }]);
                expect(postedNamed(panel, 'insertDataset')).toEqual([{ command: 'insertDataset', datasetFolderName: 'dataset-2026-09-21T00-00-00-2', treeKey: ACCOUNT_TREE_KEY, tab: 'datasets' }]);

            });

            it('asks for a legacy data set\'s counts once, however many rows show it, and answers every one', () => {

                const { panel } = renderHistoryRecipe(5);
                const leadCard = openTab(panel, 'Lead-ONLY', 'Previous Fake Sets');
                panel.findAll(leadCard, 'treeDatasetCountsLoad')[0].dispatch('click');
                clickNamed(panel, leadCard, 'treeTab', 'Previous Versions');
                panel.findAll(leadCard, 'treeVersionToggle')[2].dispatch('click');

                expect(postedNamed(panel, 'loadDatasetRecordCounts')).toHaveLength(1);

                panel.postToPanel({ command: 'datasetRecordCounts', datasetFolderName: 'dataset-2026-09-02T00-00-00', recordCounts: [], failureMessage: '', renderSequence: 5 });

                expect(textOf(panel, leadCard, 'treeDatasetCounts').filter((countsText: string) => countsText === 'no records')).toHaveLength(2);

            });

            it('lists a tree\'s data sets from every run, whichever run is on screen, and draws no history tabs on a card with no history', () => {

                const panel = runPanelScript();
                const loadedRecipe = loadHistoryRecipe('recipe-2026-09-01T00-00-00');
                panel.postToPanel({ command: 'recipeData', recipe: loadedRecipe.recipeViewModel, renderSequence: 1 });

                const leadCard = openTab(panel, 'Lead-ONLY', 'Previous Fake Sets');
                expect(textOf(panel, leadCard, 'treeDatasetVersion')).toEqual(['version of 2026-09-20 10:00:00 UTC', 'version unknown', 'current version']);

                const withoutHistory = JSON.parse(JSON.stringify(loadedRecipe.recipeViewModel));
                withoutHistory.trees.forEach((tree: any) => { delete tree.history; });
                panel.postToPanel({ command: 'recipeData', recipe: withoutHistory, renderSequence: 2 });

                const bareCard = treeCardFolded(panel, 'Lead-ONLY');
                panel.findAll(bareCard, 'treeToggle')[0].dispatch('click');
                expect(textOf(panel, bareCard, 'treeTab')).toEqual(['Structure']);

            });

            it('says when a tree has no data sets at all', () => {

                const panel = runPanelScript();
                const loadedRecipe = loadHistoryRecipe();
                loadedRecipe.recipeViewModel.trees.forEach(tree => { tree.history.datasets = []; });
                panel.postToPanel({ command: 'recipeData', recipe: loadedRecipe.recipeViewModel, renderSequence: 1 });

                const leadCard = openTab(panel, 'Lead-ONLY', 'Previous Fake Sets');
                expect(textOf(panel, leadCard, 'treeEmpty')).toEqual(['No data sets were made from this tree.']);

            });

            it('re-opens the card and tab a refresh names, and asks for its summaries only after acknowledging the draw', () => {

                const { panel } = renderHistoryRecipe(9, { treeKey: LEAD_TREE_KEY, tab: 'versions' });
                const leadCard = treeCardFolded(panel, 'Lead-ONLY');
                const panelCommands = panel.postedHostMessages.map((hostMessage: any) => hostMessage.command);

                expect(panel.isHidden(panel.findAll(leadCard, 'treeVersions')[0])).toBe(false);
                expect(panelCommands.indexOf('rendered')).toBeLessThan(panelCommands.indexOf('loadVersionSummaries'));

            });

            it('switches a card back to Structure when a search opens its rows', () => {

                const { panel } = renderHistoryRecipe();
                const leadCard = openTab(panel, 'Lead-ONLY', 'Previous Versions');

                panel.typeIntoFilter('company');

                expect(panel.isHidden(panel.findAll(leadCard, 'treeStructure')[0])).toBe(false);
                expect(panel.isHidden(panel.findAll(leadCard, 'treeVersions')[0])).toBe(true);

            });

            it('draws ▶ Run Faker on each card that has a recipe, naming the file in its tooltip, and none on a card without one', () => {

                const panel = runPanelScript();
                const loadedRecipe = loadHistoryRecipe();
                delete loadedRecipe.recipeViewModel.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY).runFakerRecipeFileName;
                panel.postToPanel({ command: 'recipeData', recipe: loadedRecipe.recipeViewModel, renderSequence: 1 });

                const leadButtons = panel.findAll(treeCardFolded(panel, 'Lead-ONLY'), 'treeRunFaker');

                expect(leadButtons.map((button: any) => button.textContent)).toEqual([RECIPE_COCKPIT_RUN_FAKER_ACTION_LABEL]);
                expect(leadButtons[0].attributes.title).toBe('Run Faker by Recipe on recipe--Lead-ONLY-2026-09-20T10-00-00.yml');
                expect(panel.findAll(treeCardFolded(panel, ACCOUNT_TREE_KEY), 'treeRunFaker')).toEqual([]);

            });

            it('posts the tree key on a click and disables every Run Faker until the host says the run ended', () => {

                const { panel } = renderHistoryRecipe(3);
                const leadButton = panel.findAll(treeCardFolded(panel, 'Lead-ONLY'), 'treeRunFaker')[0];
                const accountButton = panel.findAll(treeCardFolded(panel, ACCOUNT_TREE_KEY), 'treeRunFaker')[0];

                leadButton.dispatch('click');
                accountButton.dispatch('click');
                leadButton.dispatch('click');

                expect(postedNamed(panel, 'runFaker')).toEqual([{ command: 'runFaker', treeKey: LEAD_TREE_KEY }]);
                expect([leadButton.disabled, accountButton.disabled]).toEqual([true, true]);
                expect([leadButton.textContent, accountButton.textContent]).toEqual([RECIPE_COCKPIT_RUN_FAKER_RUNNING_LABEL, RECIPE_COCKPIT_RUN_FAKER_ACTION_LABEL]);

                // THE HOST RELOADS THE RUN BEFORE IT SAYS THE RUN ENDED: THE RELOADED CARDS ARE STILL DISABLED
                panel.postToPanel({ command: 'recipeData', recipe: loadHistoryRecipe().recipeViewModel, renderSequence: 4 });
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

                const runFakerButtons = panel.findAll(panel.cockpitBodyElement, 'treeRunFaker');
                expect(runFakerButtons.map((button: any) => [button.disabled, button.textContent])).toEqual([
                    [true, RECIPE_COCKPIT_RUN_FAKER_RUNNING_LABEL],
                    [true, RECIPE_COCKPIT_RUN_FAKER_ACTION_LABEL]
                ]);

            });

            it('writes every name from disk as text, so a data set folder named like markup stays text', () => {

                const panel = runPanelScript();
                const loadedRecipe = loadHistoryRecipe();
                const leadTree = loadedRecipe.recipeViewModel.trees.find(tree => tree.treeKey === LEAD_TREE_KEY);
                leadTree.history.datasets[0].datasetFolderName = '<img src=x onerror=alert(1)>';
                panel.postToPanel({ command: 'recipeData', recipe: loadedRecipe.recipeViewModel, renderSequence: 1 });

                const leadCard = openTab(panel, 'Lead-ONLY', 'Previous Fake Sets');

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

            expect(postedPanelMessages).toEqual([{
                command: 'recipeData',
                recipe: RecipeCockpitService.buildRecipeViewModel(MOCK_WORKSPACE_ROOT),
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

        describe('describing the recipe in an org', () => {

            const ORG_DETAIL = { targetOrgIdentifier: 'devhub', username: 'jd@example.com', alias: 'devhub' };

            let describeSource: { describe: jest.Mock };
            let promptForAuthorizedOrgSpy: jest.SpyInstance;
            let getConnectionSpy: jest.SpyInstance;
            let showWarningMessageSpy: jest.SpyInstance;

            const postedOrgDescribes = () => postedPanelMessages.filter(hostMessage => hostMessage.command === 'orgDescribe');
            const lastRecipe = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.recipe;
            // EACH ASKS FROM THE FIRST CARD OF THE MODEL LAST POSTED, AS A CLICK ON THE PANEL ON SCREEN WOULD
            const selectOrgMessage = () => ({ command: 'selectOrg', treeKey: lastRecipe().trees[0].treeKey });
            const regenerateMessage = () => ({ command: 'regenerateRecipe', treeKey: lastRecipe().trees[0].treeKey });

            const openRenderedCockpit = async () => {
                await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
                await receivedMessageHandler({ command: 'ready' });
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            };

            beforeEach(() => {

                SalesforceOrgService.clearDescribeCache();

                describeSource = {
                    describe: jest.fn().mockImplementation(async (objectApiName: string) => {
                        if ( objectApiName === 'Contact' ) {
                            throw Object.assign(new Error('The requested resource does not exist'), { errorCode: 'NOT_FOUND' });
                        }
                        return { name: objectApiName, label: objectApiName, fields: [{ name: 'Id', type: 'id' }, { name: 'Name', type: 'string' }] };
                    })
                };

                promptForAuthorizedOrgSpy = jest.spyOn(SalesforceOrgService, 'promptForAuthorizedOrg').mockResolvedValue(ORG_DETAIL);
                getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection').mockResolvedValue(describeSource as any);
                showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

                // ON THE MODULE FACTORY RATHER THAN A SPY, SO restoreMocks DOES NOT RESET IT BETWEEN TESTS
                (vscode.window.withProgress as jest.Mock).mockReset();
                (vscode.window.withProgress as jest.Mock).mockImplementation(async (progressOptions: any, progressTask: Function) => (
                    progressTask({ report: jest.fn() }, { isCancellationRequested: false })
                ));

            });

            it('given no org picked in Data-by-Org, describes every object of the card in the org chosen from the picker, under a cancellable progress notification', async () => {

                await openRenderedCockpit();

                await receivedMessageHandler(selectOrgMessage());

                expect(promptForAuthorizedOrgSpy).toHaveBeenCalledWith(RECIPE_COCKPIT_ORG_PICKER_PLACEHOLDER);
                // BY USERNAME, THE IDENTITY THE CACHE IS KEYED BY, NOT BY AN ALIAS THAT CAN BE RE-POINTED
                expect(getConnectionSpy).toHaveBeenCalledWith('jd@example.com');
                expect(describeSource.describe.mock.calls.map(([objectApiName]) => objectApiName).sort()).toEqual(['Account', 'Contact']);
                expect(vscode.window.withProgress).toHaveBeenCalledWith(
                    expect.objectContaining({ location: vscode.ProgressLocation.Notification, cancellable: true }),
                    expect.any(Function)
                );

                expect(postedOrgDescribes()).toEqual([{
                    command: 'orgDescribe',
                    treeKey: 'Account-thru-Contact',
                    orgLabel: 'devhub (jd@example.com)',
                    summary: 'Described in devhub (jd@example.com): 1 of 2 objects described. 1 could not be described.',
                    isFailure: false,
                    isCancelled: false,
                    objects: [
                        { objectApiName: 'Account', isDescribed: true, describedFieldCount: 2, failureMessage: '' },
                        { objectApiName: 'Contact', isDescribed: false, describedFieldCount: 0, failureMessage: 'NOT_FOUND: The requested resource does not exist' }
                    ],
                    // CONTACT'S DESCRIBE FAILED, SO IT IS NOT COMPARED -- NEVER REPORTED AS EVERY FIELD REMOVED
                    diff: expect.objectContaining({ objects: [expect.objectContaining({ objectApiName: 'Account' })] }),
                    renderSequence: lastRenderSequence()
                }]);

            });

            it('given an object the org could not describe, tells the reader outside the panel too', async () => {

                await openRenderedCockpit();

                await receivedMessageHandler(selectOrgMessage());

                expect(showWarningMessageSpy).toHaveBeenCalledWith(postedOrgDescribes()[0].summary);

            });

            it('given every object described, raises no warning', async () => {

                describeSource.describe.mockImplementation(async (objectApiName: string) => ({ name: objectApiName, fields: [] }));
                await openRenderedCockpit();

                await receivedMessageHandler(selectOrgMessage());

                expect(showWarningMessageSpy).not.toHaveBeenCalled();
                expect(postedOrgDescribes()[0].summary).toBe('Described in devhub (jd@example.com): 2 of 2 objects described.');

            });

            it('answers a repeat request from the session cache, without connecting or describing again', async () => {

                describeSource.describe.mockImplementation(async (objectApiName: string) => ({ name: objectApiName, fields: [] }));
                await openRenderedCockpit();

                await receivedMessageHandler(selectOrgMessage());
                await receivedMessageHandler(selectOrgMessage());

                expect(getConnectionSpy).toHaveBeenCalledTimes(1);
                expect(describeSource.describe).toHaveBeenCalledTimes(2);
                expect(postedOrgDescribes()[1].summary).toBe('Described in devhub (jd@example.com): 2 of 2 objects described (2 from this session\'s cache).');

            });

            it('given the panel has not confirmed drawing the recipe, does not even offer the picker', async () => {

                await RecipeCockpitService.openRecipeCockpitPanel(MOCK_WORKSPACE_ROOT);
                await receivedMessageHandler({ command: 'ready' });

                await receivedMessageHandler(selectOrgMessage());

                expect(promptForAuthorizedOrgSpy).not.toHaveBeenCalled();

            });

            it('given the picker is dismissed, connects to nothing and posts nothing', async () => {

                promptForAuthorizedOrgSpy.mockResolvedValue(undefined);
                await openRenderedCockpit();

                await receivedMessageHandler(selectOrgMessage());

                expect(getConnectionSpy).not.toHaveBeenCalled();
                expect(postedOrgDescribes()).toEqual([]);

            });

            it('given the org cannot be connected to, says so in the panel and outside it, and the panel stays usable', async () => {

                getConnectionSpy.mockRejectedValue(new Error('No authorization information found for devhub.'));
                await openRenderedCockpit();

                await receivedMessageHandler(selectOrgMessage());

                expect(postedOrgDescribes()).toEqual([expect.objectContaining({ isFailure: true, objects: [] })]);
                expect(postedOrgDescribes()[0].summary).toContain('No authorization information found for devhub.');
                expect(showWarningMessageSpy).toHaveBeenCalledWith(postedOrgDescribes()[0].summary);

                getConnectionSpy.mockResolvedValue(describeSource as any);
                await receivedMessageHandler(selectOrgMessage());

                expect(postedOrgDescribes()).toHaveLength(2);
                expect(postedOrgDescribes()[1].isFailure).toBe(false);

            });

            it('given a second request while the picker is still open, starts no second describe', async () => {

                let resolvePicker: (orgDetail: typeof ORG_DETAIL) => void = () => undefined;
                promptForAuthorizedOrgSpy.mockImplementation(() => new Promise(resolvePromise => { resolvePicker = resolvePromise; }));
                await openRenderedCockpit();

                const firstRequest = receivedMessageHandler(selectOrgMessage());
                await receivedMessageHandler(selectOrgMessage());
                resolvePicker(ORG_DETAIL);
                await firstRequest;

                expect(promptForAuthorizedOrgSpy).toHaveBeenCalledTimes(1);
                expect(postedOrgDescribes()).toHaveLength(1);

            });

            // EVERY REVEAL RELOADS THE DOCUMENT, AND THE DESCRIBE IS PART OF WHAT WAS ON SCREEN
            it('replays the describe after the recipe when the panel reloads', async () => {

                await openRenderedCockpit();
                await receivedMessageHandler(selectOrgMessage());
                postedPanelMessages.length = 0;

                await receivedMessageHandler({ command: 'ready' });

                expect(postedPanelMessages.map(hostMessage => hostMessage.command)).toEqual(['recipeData', 'orgDescribe']);

            });

            it('given another run is loaded, drops the describe of the previous one', async () => {

                await openRenderedCockpit();
                await receivedMessageHandler(selectOrgMessage());

                await receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });
                postedPanelMessages.length = 0;
                await receivedMessageHandler({ command: 'ready' });

                expect(postedPanelMessages.map(hostMessage => hostMessage.command)).toEqual(['recipeData']);

            });

            // THE READER ASKED ABOUT THE RECIPE THAT WAS ON SCREEN, AND IT IS NOT ON SCREEN ANY MORE
            it('given the run is switched while the picker is open, describes the recipe it was asked about and draws nothing over the new one', async () => {

                await openRenderedCockpit();

                promptForAuthorizedOrgSpy.mockImplementation(async () => {
                    await receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });
                    return ORG_DETAIL;
                });

                await receivedMessageHandler(selectOrgMessage());

                expect(describeSource.describe.mock.calls.map(([objectApiName]) => objectApiName).sort()).toEqual(['Account', 'Contact']);
                expect(postedOrgDescribes()).toEqual([]);

                postedPanelMessages.length = 0;
                await receivedMessageHandler({ command: 'ready' });

                expect(postedPanelMessages.map(hostMessage => hostMessage.command)).toEqual(['recipeData']);

            });

            /*
                A new run's model is posted before the panel acks drawing it. A click in that gap must
                not describe the PREVIOUS run's objects and tag the answer with the new model -- the
                panel would draw it over rows it says nothing about.
            */
            it('given another run was posted but not yet drawn, describes nothing until it is', async () => {

                await openRenderedCockpit();

                await receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });
                await receivedMessageHandler(selectOrgMessage());

                expect(promptForAuthorizedOrgSpy).not.toHaveBeenCalled();

                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                await receivedMessageHandler(selectOrgMessage());

                const newRunObjectApiNames = [...RecipeCockpitService.collectDescribableObjectApiNamesByTreeKey(lastRecipe()).get(lastRecipe().trees[0].treeKey)].sort();

                expect(promptForAuthorizedOrgSpy).toHaveBeenCalledTimes(1);
                expect(describeSource.describe.mock.calls.map(([objectApiName]) => objectApiName).sort()).toEqual(newRunObjectApiNames);
                expect(newRunObjectApiNames).not.toEqual(['Account', 'Contact']);

            });

            it('given the reader cancels the describe, draws what it got without a warning they did not need', async () => {

                (vscode.window.withProgress as jest.Mock).mockImplementation(async (progressOptions: any, progressTask: Function) => (
                    progressTask({ report: jest.fn() }, { isCancellationRequested: true })
                ));
                await openRenderedCockpit();

                await receivedMessageHandler(selectOrgMessage());

                expect(postedOrgDescribes()[0]).toEqual(expect.objectContaining({ isCancelled: true }));
                expect(showWarningMessageSpy).not.toHaveBeenCalled();

            });

            it('given the answer arrives for a run no longer on screen, raises no warning about it', async () => {

                await openRenderedCockpit();

                promptForAuthorizedOrgSpy.mockImplementation(async () => {
                    await receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });
                    return ORG_DETAIL;
                });

                await receivedMessageHandler(selectOrgMessage());

                expect(showWarningMessageSpy).not.toHaveBeenCalled();

            });

            it('given the panel is closed while the describe runs, posts nothing into it', async () => {

                await openRenderedCockpit();

                promptForAuthorizedOrgSpy.mockImplementation(async () => {
                    registeredDisposeHandler();
                    return ORG_DETAIL;
                });

                await receivedMessageHandler(selectOrgMessage());

                expect(postedOrgDescribes()).toEqual([]);

            });

            describe('comparing and regenerating', () => {

                const postedOrgProgress = () => postedPanelMessages.filter(hostMessage => hostMessage.command === 'orgProgress');

                // THE RECIPE'S PICKLIST VALUES ARE READ FROM THE RUN ON THE HOST, AND NEVER POSTED
                const withRecipePicklistValues = () => {
                    const loadRecipeRunByRuns = RecipeCockpitService.loadRecipeRunByRuns.bind(RecipeCockpitService);
                    jest.spyOn(RecipeCockpitService, 'loadRecipeRunByRuns').mockImplementation((recipeRuns, workspaceRoot, requestedRunFolderName) => ({
                        ...loadRecipeRunByRuns(recipeRuns, workspaceRoot, requestedRunFolderName),
                        recipePicklistValuesByObjectApiName: RECIPE_PICKLIST_VALUES
                    }));
                };

                beforeEach(() => {

                    describeSource.describe.mockImplementation(async (objectApiName: string) => {
                        if ( objectApiName === 'Contact' ) {
                            throw Object.assign(new Error('The requested resource does not exist'), { errorCode: 'NOT_FOUND' });
                        }
                        return {
                            name: 'Account',
                            label: 'Account',
                            fields: [
                                { name: 'Id', type: 'id', createable: false },
                                { name: 'Name', type: 'string', createable: true },
                                { name: 'Industry', type: 'picklist', createable: true, picklistValues: [{ value: 'Agriculture', active: true }, { value: 'Retail', active: true }] },
                                { name: 'Number_of_Contacts__c', type: 'string', createable: true },
                                { name: 'Rating__c', type: 'picklist', createable: true }
                            ]
                        };
                    });

                    (vscode.commands.executeCommand as jest.Mock).mockReset();
                    (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);

                });

                it('compares the described objects against the recipe, with the picklist values the run recorded', async () => {

                    withRecipePicklistValues();
                    await openRenderedCockpit();

                    await receivedMessageHandler(selectOrgMessage());

                    const [orgDescribe] = postedOrgDescribes();
                    expect(orgDescribe.diff.objects.map((objectDiff: any) => objectDiff.objectApiName)).toEqual(['Account']);
                    expect(orgDescribe.diff.objects[0].changedFields.map((fieldDiff: any) => [fieldDiff.fieldApiName, fieldDiff.status])).toEqual([
                        ['Industry', 'picklist-changed'],
                        ['Industry_Group__c', 'removed-from-org'],
                        ['Legacy_Code__c', 'removed-from-org'],
                        ['Number_of_Contacts__c', 'type-changed'],
                        ['Rating__c', 'new-in-org']
                    ]);
                    expect(orgDescribe.diff.objects[0].changedFields[0]).toEqual(expect.objectContaining({ addedPicklistValues: ['Retail'], removedPicklistValues: ['Banking'] }));

                });

                it('reports progress in the panel while it describes, and stops replaying it once answered', async () => {

                    await openRenderedCockpit();

                    await receivedMessageHandler(selectOrgMessage());

                    expect(postedOrgProgress().map(progressMessage => progressMessage.message)).toEqual([
                        'Comparing with devhub (jd@example.com): describing 2 objects…',
                        'Comparing with devhub (jd@example.com): described 1 of 2 objects…',
                        'Comparing with devhub (jd@example.com): described 2 of 2 objects…'
                    ]);
                    expect(postedOrgProgress().every(progressMessage => progressMessage.renderSequence === lastRenderSequence() && progressMessage.treeKey === 'Account-thru-Contact')).toBe(true);

                    const commands = postedPanelMessages.map(hostMessage => hostMessage.command);
                    expect(commands.lastIndexOf('orgProgress')).toBeLessThan(commands.indexOf('orgDescribe'));

                    postedPanelMessages.length = 0;
                    await receivedMessageHandler({ command: 'ready' });
                    expect(postedPanelMessages.map(hostMessage => hostMessage.command)).toEqual(['recipeData', 'orgDescribe']);

                });

                // A REVEAL MID-DESCRIBE RELOADS THE DOCUMENT, WHICH HAS TO SAY THE COMPARISON IS STILL RUNNING
                it('given the panel reloads mid-describe, replays where the comparison is', async () => {

                    let replayedCommands: string[] = [];
                    await openRenderedCockpit();

                    promptForAuthorizedOrgSpy.mockImplementation(async () => ORG_DETAIL);
                    getConnectionSpy.mockImplementation(async () => {
                        postedPanelMessages.length = 0;
                        await receivedMessageHandler({ command: 'ready' });
                        replayedCommands = postedPanelMessages.map(hostMessage => hostMessage.command);
                        return describeSource;
                    });

                    await receivedMessageHandler(selectOrgMessage());

                    expect(replayedCommands).toEqual(['recipeData', 'orgProgress']);

                });

                it('given the comparison itself throws, reports it as the extension\'s failure rather than the org\'s, and stops replaying progress', async () => {

                    const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
                    jest.spyOn(RecipeCockpitService, 'buildRecipeDiffViewModel').mockImplementation(() => { throw new TypeError('diff broke'); });
                    await openRenderedCockpit();

                    await receivedMessageHandler(selectOrgMessage());

                    expect(handleCapturedErrorSpy).toHaveBeenCalledTimes(1);
                    expect(handleCapturedErrorSpy.mock.calls[0][0]).toEqual(new TypeError('diff broke'));
                    expect(postedOrgDescribes()).toEqual([]);
                    expect(showWarningMessageSpy).not.toHaveBeenCalled();

                    // NO ANSWER IS COMING TO REPLACE THE PROGRESS LINE, SO THE PANEL IS TOLD TO DROP IT
                    expect(postedOrgProgress().pop()).toEqual({ command: 'orgProgress', treeKey: 'Account-thru-Contact', message: '', renderSequence: lastRenderSequence() });

                    postedPanelMessages.length = 0;
                    await receivedMessageHandler({ command: 'ready' });
                    expect(postedPanelMessages.map(hostMessage => hostMessage.command)).toEqual(['recipeData']);

                    // AND THE NEXT REQUEST IS NOT REFUSED AS ONE STILL IN FLIGHT
                    (RecipeCockpitService.buildRecipeDiffViewModel as jest.Mock).mockRestore();
                    await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                    await receivedMessageHandler(selectOrgMessage());
                    expect(postedOrgDescribes()).toHaveLength(1);

                });

                it('given an answer was posted, sends no clearing message after it', async () => {

                    await openRenderedCockpit();

                    await receivedMessageHandler(selectOrgMessage());

                    expect(postedPanelMessages[postedPanelMessages.length - 1].command).toBe('orgDescribe');
                    expect(postedOrgProgress().every(progressMessage => !!progressMessage.message)).toBe(true);

                });

                it('given the picker is dismissed, reports no progress', async () => {

                    promptForAuthorizedOrgSpy.mockResolvedValue(undefined);
                    await openRenderedCockpit();

                    await receivedMessageHandler(selectOrgMessage());

                    expect(postedOrgProgress()).toEqual([]);

                });

                it('given the run is switched mid-describe, reports no progress over the new run', async () => {

                    await openRenderedCockpit();

                    getConnectionSpy.mockImplementation(async () => {
                        await receivedMessageHandler({ command: 'selectRun', runFolderName: FAKER_JS_RUN_FOLDER_NAME });
                        postedPanelMessages.length = 0;
                        return describeSource;
                    });

                    await receivedMessageHandler(selectOrgMessage());

                    expect(postedOrgProgress()).toEqual([]);

                });

                it('hands off to Generate Treecipe, then loads the run it wrote into the cards, the card it came from open on Structure', async () => {

                    const executeCommand = vscode.commands.executeCommand as jest.Mock;
                    await openRenderedCockpit();
                    await receivedMessageHandler(selectOrgMessage());
                    const comparedRenderSequence = lastRenderSequence();

                    await receivedMessageHandler(regenerateMessage());

                    expect(executeCommand).toHaveBeenCalledTimes(1);
                    expect(executeCommand).toHaveBeenCalledWith(RECIPE_COCKPIT_GENERATE_TREECIPE_COMMAND);
                    expect(lastRenderSequence()).toBeGreaterThan(comparedRenderSequence);
                    expect([...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData').focusTree)
                        .toEqual({ treeKey: 'Account-thru-Contact', tab: 'structure' });

                    // THE COMPARISON WAS OF THE PREVIOUS RUN, SO IT IS NOT REPLAYED OVER THE REGENERATED ONE
                    postedPanelMessages.length = 0;
                    await receivedMessageHandler({ command: 'ready' });
                    expect(postedPanelMessages.map(hostMessage => hostMessage.command)).toEqual(['recipeData']);

                });

                it('given nothing has been compared, does not regenerate', async () => {

                    await openRenderedCockpit();

                    await receivedMessageHandler(regenerateMessage());

                    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();

                });

                it('given a second click while Generate Treecipe runs, regenerates once', async () => {

                    let finishGeneration: () => void = () => undefined;
                    (vscode.commands.executeCommand as jest.Mock).mockImplementation(() => new Promise<void>(resolvePromise => { finishGeneration = resolvePromise; }));
                    await openRenderedCockpit();
                    await receivedMessageHandler(selectOrgMessage());

                    const firstClick = receivedMessageHandler(regenerateMessage());
                    await receivedMessageHandler(regenerateMessage());
                    finishGeneration();
                    await firstClick;

                    expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);

                });

                it('given the panel is closed while Generate Treecipe runs, loads nothing into it', async () => {

                    await openRenderedCockpit();
                    await receivedMessageHandler(selectOrgMessage());
                    const loadSpy = jest.spyOn(RecipeCockpitService, 'loadRecipeRunByRuns');
                    const statusBarItemCountBefore = createdStatusBarItems.length;
                    (vscode.commands.executeCommand as jest.Mock).mockImplementation(async () => { registeredDisposeHandler(); });

                    await receivedMessageHandler(regenerateMessage());

                    // NOT EVEN STARTED: A LOAD WOULD PUT A STATUS BAR ITEM UP FOR A PANEL THAT IS GONE
                    expect(loadSpy).not.toHaveBeenCalled();
                    expect(createdStatusBarItems).toHaveLength(statusBarItemCountBefore);

                });

                /*
                    The panel disables its button on the click and only a render gives one back, so a
                    failure that skipped the reload would leave a button that can never be pressed.
                */
                it('given Generate Treecipe fails, still reloads the panel, and reports the failure once', async () => {

                    const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
                    (vscode.commands.executeCommand as jest.Mock).mockRejectedValueOnce(new Error('no config'));
                    await openRenderedCockpit();
                    await receivedMessageHandler(selectOrgMessage());
                    const comparedRenderSequence = lastRenderSequence();

                    await receivedMessageHandler(regenerateMessage());

                    expect(lastRenderSequence()).toBeGreaterThan(comparedRenderSequence);
                    expect(handleCapturedErrorSpy).toHaveBeenCalledTimes(1);
                    expect(handleCapturedErrorSpy.mock.calls[0][0]).toEqual(new Error('no config'));

                });

                // THE COMPARISON THAT ROUTES THE ACTION IS REPLACED ONLY WHEN THE RELOADED MODEL RENDERS
                it('given a second request after Generate Treecipe finishes but before the reload has, regenerates once', async () => {

                    await openRenderedCockpit();
                    await receivedMessageHandler(selectOrgMessage());

                    const loadRecipeRunByRuns = RecipeCockpitService.loadRecipeRunByRuns.bind(RecipeCockpitService);
                    jest.spyOn(RecipeCockpitService, 'loadRecipeRunByRuns').mockImplementation((recipeRuns, workspaceRoot, requestedRunFolderName) => {
                        void receivedMessageHandler(regenerateMessage());
                        return loadRecipeRunByRuns(recipeRuns, workspaceRoot, requestedRunFolderName);
                    });

                    await receivedMessageHandler(regenerateMessage());

                    expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);

                });

            });

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

            it('diffs a previous version against the current one only once the panel has confirmed drawing it', async () => {

                await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT);
                await receivedMessageHandler({ command: 'ready' });

                await receivedMessageHandler({ command: 'diffTreeVersion', treeKey: LEAD_TREE_KEY, runFolderName: OLDEST_LEAD_RUN });
                expect(executedCommandsNamed('vscode.diff')).toEqual([]);

                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                await receivedMessageHandler({ command: 'diffTreeVersion', treeKey: LEAD_TREE_KEY, runFolderName: OLDEST_LEAD_RUN });

                expect(executedCommandsNamed('vscode.diff')).toEqual([[
                    'vscode.diff',
                    vscode.Uri.file(path.join(HISTORY_GENERATED_RECIPES_PATH, OLDEST_LEAD_RUN, 'Lead-ONLY', 'recipe--Lead-ONLY-2026-09-01T00-00-00.yml')),
                    vscode.Uri.file(path.join(HISTORY_GENERATED_RECIPES_PATH, HISTORY_CURRENT_RUN, 'Lead-ONLY', 'recipe--Lead-ONLY-2026-09-20T10-00-00.yml')),
                    'Lead-ONLY: 2026-09-01 00:00:00 UTC ↔ current (2026-09-20 10:00:00 UTC)'
                ]]);

            });

            it('posts each version\'s summary from its wrapper, with the change against the current version and an unreadable wrapper unavailable', async () => {

                await openRenderedHistoryCockpit(copyHistoryWorkspace());
                await receivedMessageHandler({ command: 'loadVersionSummaries', treeKey: LEAD_TREE_KEY });

                const postedSummaries = postedPanelMessages.filter(hostMessage => hostMessage.command === 'versionSummaries');

                // THE CURRENT RUN IS ANSWERED AT ONCE FROM THE LOAD, AND EVERY OTHER WRAPPER IS POSTED AS IT IS READ, ONE PER POST
                expect(postedSummaries.map(versionSummaries => versionSummaries.summaries.map((summary: any) => summary.runFolderName))).toEqual([
                    [HISTORY_CURRENT_RUN],
                    [HISTORY_CURRENT_RUN, FAKER_JS_LEAD_RUN],
                    [HISTORY_CURRENT_RUN, FAKER_JS_LEAD_RUN, OLDEST_LEAD_RUN]
                ]);
                expect(postedSummaries.at(-1)).toEqual({
                    command: 'versionSummaries',
                    treeKey: LEAD_TREE_KEY,
                    summaries: [
                        { runFolderName: HISTORY_CURRENT_RUN, isSummaryAvailable: true, fieldCount: 2, changeText: '' },
                        { runFolderName: FAKER_JS_LEAD_RUN, isSummaryAvailable: false, fieldCount: 0, changeText: '' },
                        { runFolderName: OLDEST_LEAD_RUN, isSummaryAvailable: true, fieldCount: 3, changeText: '+1 field' }
                    ],
                    renderSequence: lastRenderSequence()
                });

            });

            it('reads each wrapper once, the current run\'s never, and none again after a reload of the same run', async () => {

                const temporaryWorkspaceRoot = copyHistoryWorkspace();
                const readFileSync = fs.readFileSync;
                const readWrapperPaths: string[] = [];
                jest.spyOn(fs, 'readFileSync').mockImplementation(((filePath: fs.PathOrFileDescriptor, options?: any) => {
                    if ( String(filePath).includes('treecipeObjectsWrapper-') ) {
                        readWrapperPaths.push(path.basename(String(filePath)));
                    }
                    return readFileSync(filePath, options);
                }) as typeof fs.readFileSync);

                await openRenderedHistoryCockpit(temporaryWorkspaceRoot);
                expect(readWrapperPaths).toEqual(['treecipeObjectsWrapper-2026-09-20T10-00-00.json']);

                await receivedMessageHandler({ command: 'loadVersionSummaries', treeKey: LEAD_TREE_KEY });
                expect(readWrapperPaths.slice(1).sort()).toEqual(['treecipeObjectsWrapper-2026-09-01T00-00-00.json', 'treecipeObjectsWrapper-2026-09-10T00-00-00.json']);

                await receivedMessageHandler({ command: 'selectRun', runFolderName: HISTORY_CURRENT_RUN });
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                readWrapperPaths.length = 0;
                postedPanelMessages.length = 0;

                await receivedMessageHandler({ command: 'loadVersionSummaries', treeKey: LEAD_TREE_KEY });

                expect(readWrapperPaths).toEqual([]);
                expect(postedPanelMessages.filter(hostMessage => hostMessage.command === 'versionSummaries')).toHaveLength(1);

                // A WRAPPER GONE SINCE IT WAS CACHED IS NOT CACHED ANY MORE, AND A RUN WITH NO WRAPPER NEVER IS
                const oldestWrapperFilePath = path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes', OLDEST_LEAD_RUN, 'treecipeObjectsWrapper-2026-09-01T00-00-00.json');
                expect(RecipeCockpitService.isRunFieldCountCached(oldestWrapperFilePath)).toBe(true);
                fs.rmSync(oldestWrapperFilePath);
                expect(RecipeCockpitService.isRunFieldCountCached(oldestWrapperFilePath)).toBe(false);
                expect(RecipeCockpitService.isRunFieldCountCached('')).toBe(false);

            });

            it('stops reading wrappers once the panel it was asked from is closed', async () => {

                await openRenderedHistoryCockpit(copyHistoryWorkspace());
                postedPanelMessages.length = 0;

                const summariesRequest = receivedMessageHandler({ command: 'loadVersionSummaries', treeKey: LEAD_TREE_KEY });
                registeredDisposeHandler();
                await summariesRequest;

                expect(postedPanelMessages.filter(hostMessage => hostMessage.command === 'versionSummaries')).toHaveLength(1);

            });

            it('still diffs a version whose wrapper could not be read', async () => {

                await openRenderedHistoryCockpit();
                await receivedMessageHandler({ command: 'diffTreeVersion', treeKey: LEAD_TREE_KEY, runFolderName: FAKER_JS_LEAD_RUN });

                expect(executedCommandsNamed('vscode.diff')).toHaveLength(1);

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
                await receivedMessageHandler({ command: 'diffTreeVersion', treeKey: LEAD_TREE_KEY, runFolderName: OLDEST_LEAD_RUN });
                await receivedMessageHandler({ command: 'loadVersionSummaries', treeKey: LEAD_TREE_KEY });
                await receivedMessageHandler({ command: 'loadDatasetRecordCounts', datasetFolderName: LEGACY_DATASET });

                expect((vscode.commands.executeCommand as jest.Mock).mock.calls).toEqual([]);
                expect(postedPanelMessages.filter(hostMessage => ['versionSummaries', 'datasetRecordCounts'].includes(hostMessage.command))).toEqual([]);

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

                await receivedMessageHandler({ command: 'openDataset', datasetFolderName: RECORDED_DATASET, treeKey: LEAD_TREE_KEY, tab: 'structure' });

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

            it('escapes a recipe file name in the warning, so a name shaped like a link cannot run a command', async () => {

                const temporaryWorkspaceRoot = copyHistoryWorkspace();
                const leadTreeFolderPath = path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes', OLDEST_LEAD_RUN, 'Lead-ONLY');
                const linkShapedRecipeFilePath = path.join(leadTreeFolderPath, '[Fix](command:workbench.action.quit).yml');
                fs.renameSync(path.join(leadTreeFolderPath, 'recipe--Lead-ONLY-2026-09-01T00-00-00.yml'), linkShapedRecipeFilePath);

                await openRenderedHistoryCockpit(temporaryWorkspaceRoot);
                fs.rmSync(linkShapedRecipeFilePath);
                await receivedMessageHandler({ command: 'diffTreeVersion', treeKey: LEAD_TREE_KEY, runFolderName: OLDEST_LEAD_RUN });

                const warningText = showWarningMessageSpy.mock.calls[0][0];

                expect(warningText).not.toContain('[Fix](command:');
                expect(warningText).toContain('\\u005bFix\\u005d\\u0028command:workbench.action.quit\\u0029.yml');

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

                it('hands the tree\'s recipe file to Run Faker by Recipe, then reloads the run on the card\'s Previous Fake Sets with the new data set', async () => {

                    const temporaryWorkspaceRoot = copyHistoryWorkspace();
                    const leadRecipeFilePath = path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes', HISTORY_CURRENT_RUN, LEAD_TREE_KEY, 'recipe--Lead-ONLY-2026-09-20T10-00-00.yml');
                    (vscode.commands.executeCommand as jest.Mock).mockImplementation(async (commandName: string, recipeFilePath: string) => {
                        if ( commandName === RECIPE_COCKPIT_RUN_FAKER_COMMAND ) {
                            writeDatasetMadeBy(temporaryWorkspaceRoot, recipeFilePath);
                        }
                    });

                    await openRenderedHistoryCockpit(temporaryWorkspaceRoot);
                    postedPanelMessages.length = 0;

                    await receivedMessageHandler({ command: 'runFaker', treeKey: LEAD_TREE_KEY });

                    expect(executedCommandsNamed(RECIPE_COCKPIT_RUN_FAKER_COMMAND)).toEqual([[RECIPE_COCKPIT_RUN_FAKER_COMMAND, leadRecipeFilePath]]);
                    expect(postedPanelMessages.map(hostMessage => hostMessage.command).filter(command => ['runFakerState', 'recipeData'].includes(command)))
                        .toEqual(['runFakerState', 'recipeData', 'runFakerState']);
                    expect(runFakerStates()).toEqual([
                        { command: 'runFakerState', isRunning: true, treeKey: LEAD_TREE_KEY },
                        { command: 'runFakerState', isRunning: false, treeKey: LEAD_TREE_KEY }
                    ]);
                    expect(postedPanelMessages.find(hostMessage => hostMessage.command === 'recipeData').focusTree).toEqual({ treeKey: LEAD_TREE_KEY, tab: 'datasets' });
                    expect(reloadedLeadTree().history.datasets[0]).toMatchObject({ datasetFolderName: 'dataset-2026-09-22T00-00-00', runFolderName: HISTORY_CURRENT_RUN });

                    // NOTHING IS LEFT IN FLIGHT: A REVEAL REPLAYS NO RUN, AND A SECOND RUN IS ROUTED ONCE THE RELOAD IS DRAWN
                    postedPanelMessages.length = 0;
                    await receivedMessageHandler({ command: 'ready' });
                    expect(runFakerStates()).toEqual([]);
                    await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
                    await receivedMessageHandler({ command: 'runFaker', treeKey: LEAD_TREE_KEY });
                    expect(executedCommandsNamed(RECIPE_COCKPIT_RUN_FAKER_COMMAND)).toHaveLength(2);

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
                    let finishRun: () => void;
                    (vscode.commands.executeCommand as jest.Mock).mockImplementation((commandName: string) => (
                        commandName === RECIPE_COCKPIT_RUN_FAKER_COMMAND ? new Promise<void>(resolveRun => { finishRun = resolveRun; }) : Promise.resolve()
                    ));

                    await openRenderedHistoryCockpit();
                    const run = receivedMessageHandler({ command: 'runFaker', treeKey: LEAD_TREE_KEY });
                    await receivedMessageHandler({ command: 'selectRun', runFolderName: OTHER_RUN });
                    postedPanelMessages.length = 0;

                    finishRun();
                    await run;

                    expect(postedPanelMessages.find(hostMessage => hostMessage.command === 'recipeData').recipe.selectedRunFolderName).toBe(OTHER_RUN);

                });

            });

            it('given a recipe file deleted after the draw, says so rather than opening a diff', async () => {

                const temporaryWorkspaceRoot = copyHistoryWorkspace();

                await openRenderedHistoryCockpit(temporaryWorkspaceRoot);
                fs.rmSync(path.join(temporaryWorkspaceRoot, 'treecipe', 'GeneratedRecipes', OLDEST_LEAD_RUN, 'Lead-ONLY', 'recipe--Lead-ONLY-2026-09-01T00-00-00.yml'));

                await receivedMessageHandler({ command: 'diffTreeVersion', treeKey: LEAD_TREE_KEY, runFolderName: OLDEST_LEAD_RUN });

                expect(executedCommandsNamed('vscode.diff')).toEqual([]);
                expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('"recipe--Lead-ONLY-2026-09-01T00-00-00.yml" no longer exists'));

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

        });

        it('is not reachable from the panel document, which loads and links nothing', () => {

            const actualShellHtml = RecipeCockpitService.buildWebviewShellHtml('testNonce');

            expect(actualShellHtml).not.toContain(RECIPE_COCKPIT_ISSUES_URL);
            expect(actualShellHtml).not.toContain('github.com');

        });

    });

});
