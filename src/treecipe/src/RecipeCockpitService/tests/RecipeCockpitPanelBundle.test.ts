import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
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
import * as RecipeCockpitServiceModule from '../RecipeCockpitService';
import {
    RECIPE_COCKPIT_CUSTOM_PROPERTIES,
    RECIPE_COCKPIT_VERB_BUTTON_VERBS
} from '../RecipeCockpitShell';
import * as RecipeCockpitDatasetsTabConstants from '../RecipeCockpitDatasetsTabConstants';
import * as RecipeCockpitRecordTypesConstants from '../RecipeCockpitRecordTypesConstants';
import * as RecipeCockpitQueryTabConstants from '../RecipeCockpitQueryTabConstants';
import * as RecipeCockpitAdapterConstants from '../RecipeCockpitAdapterConstants';
import * as RecipeCockpitTroubleshootingConstants from '../RecipeCockpitTroubleshootingConstants';
import * as RecipeCockpitTreecipeFieldEditorConstants from '../RecipeCockpitTreecipeFieldEditorConstants';
import * as RecipeCockpitDataOrgConstants from '../RecipeCockpitDataOrgConstants';
import * as RecipeCockpitFieldRowsConstants from '../RecipeCockpitFieldRowsConstants';
import * as RecipeCockpitNavigationConstants from '../RecipeCockpitNavigationConstants';
import * as RecipeCockpitHelpConstants from '../RecipeCockpitHelpConstants';
import * as RecipeCockpitShellConstants from '../RecipeCockpitShellConstants';
import * as RecipeCockpitObjectRefreshConstants from '../RecipeCockpitObjectRefreshConstants';
import * as RecipeCockpitObjectRefreshModule from '../RecipeCockpitObjectRefresh';
import * as RecipeCockpitPanelConstants from '../RecipeCockpitPanelConstants';
import * as RecipeCockpitCustomTreecipeConstants from '../RecipeCockpitCustomTreecipeConstants';
import { YAML_NON_STRING_PLAIN_SCALAR_PATTERN } from '../../RecipeWriter/RecipeCockpitRecipeWriter';
import { REFERENCE_ID_REQUIRED_TODO } from '../../RelationshipService/ReferenceIdRequiredTodo';
import { RelationshipService } from '../../RelationshipService/RelationshipService';
import * as RecipeCockpitOrgAuthorizeModule from '../RecipeCockpitOrgAuthorize';
import { RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT } from '../RecipeCockpitPanelBundle.generated';
import { RECIPE_COCKPIT_PANEL_STYLESHEET } from '../RecipeCockpitPanelStylesheet.generated';
import { CockpitKitStylesheet } from '../../CockpitKit/CockpitKitStylesheet';
import { CockpitPalette } from '../../CockpitKit/CockpitPalette';
import { RecipeCockpitShell } from '../RecipeCockpitShell';

const { PanelBundler, PANEL_BUNDLE_FILE, STYLESHEET_FILE, REGENERATE_COMMAND } = require('../../../../../esbuild.panel.js');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../../..');

// THE GENERATED FILE'S export const, RUN AS JAVASCRIPT, SO THE TEST READS WHAT THE TEMPLATE LITERAL REALLY HOLDS
const evaluateGeneratedFileText = (generatedFileText: string): string =>
    new Function(generatedFileText.replace(/^export const \w+ = /m, 'return '))();

/*
    #637: the panel modules reach the webview only through the committed bundle, so a module
    changed without npm run bundle-panel would ship the old panel while every module test passed.
*/
describe('RecipeCockpitPanelBundle (#637)', () => {

    it('is what esbuild.panel.js builds from the panel modules today', async () => {

        const committedFileText = fs.readFileSync(path.join(REPOSITORY_ROOT, PANEL_BUNDLE_FILE), 'utf8');
        const builtFileText = PanelBundler.buildGeneratedFileText(await PanelBundler.buildScript());

        expect({ isBundleCurrent: committedFileText === builtFileText, toRegenerate: REGENERATE_COMMAND })
            .toEqual({ isBundleCurrent: true, toRegenerate: 'npm run bundle-panel' });

    });

    it('writes the script into a template literal that gives back every backslash, backtick and ${ unchanged', () => {

        const script = 'const pattern = /^\\s/;\nconst quoted = `a ${1} b`;\nconst escaped = "\\u2028";';

        expect(evaluateGeneratedFileText(PanelBundler.buildGeneratedFileText(script))).toBe(script);
        expect(evaluateGeneratedFileText(fs.readFileSync(path.join(REPOSITORY_ROOT, PANEL_BUNDLE_FILE), 'utf8'))).toBe(RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT);

    });

    // #644: THE STYLESHEET IS .css FILES; A .css FILE CHANGED WITHOUT npm run bundle-panel WOULD SHIP THE OLD LOOK
    it('holds the stylesheet esbuild.panel.js builds from the .css files today (#644)', () => {

        const committedFileText = fs.readFileSync(path.join(REPOSITORY_ROOT, STYLESHEET_FILE), 'utf8');
        const builtFileText = PanelBundler.buildGeneratedStylesheetFileText(PanelBundler.buildStylesheet());

        expect({ isStylesheetCurrent: committedFileText === builtFileText, toRegenerate: REGENERATE_COMMAND })
            .toEqual({ isStylesheetCurrent: true, toRegenerate: 'npm run bundle-panel' });
        expect(evaluateGeneratedFileText(committedFileText)).toBe(RECIPE_COCKPIT_PANEL_STYLESHEET);

    });

    it('is the shell\'s whole <style> after :root, and :root holds the palette and the values the .css reads, nothing else (#644)', () => {

        const html = RecipeCockpitShell.buildWebviewShellHtml('bundleNonce');
        const styleOpeningTag = '<style nonce="bundleNonce">';
        const styleText = html.substring(html.indexOf(styleOpeningTag) + styleOpeningTag.length, html.indexOf('</style>'));
        const rootBlock = ['    :root {', CockpitPalette.buildCustomProperties(), CockpitKitStylesheet.buildCustomProperties(),
            CockpitKitStylesheet.buildCustomProperties(RECIPE_COCKPIT_CUSTOM_PROPERTIES), '        color-scheme: light;', '    }'].join('\n');

        expect(html.split(styleOpeningTag)).toHaveLength(2);
        expect(styleText).toBe(`\n${rootBlock}\n${RECIPE_COCKPIT_PANEL_STYLESHEET}`);

    });

    // A .css FILE NO INCLUDE NAMES WOULD BE LEFT OUT OF THE PANEL WITH EVERY OTHER SUITE STILL PASSING
    it('includes every .css file under RecipeCockpitService/panel/ and CockpitKit/panel/ exactly once (#644)', () => {

        const entryFileName = 'RecipeCockpitPanel.css';
        const cssFilePaths = ['RecipeCockpitService/panel', 'CockpitKit/panel'].flatMap(panelDirectory =>
            (fs.readdirSync(path.join(REPOSITORY_ROOT, 'src/treecipe/src', panelDirectory), { recursive: true }) as string[])
                .filter(fileName => fileName.endsWith('.css') && path.basename(fileName) !== entryFileName)
                .map(fileName => path.join(REPOSITORY_ROOT, 'src/treecipe/src', panelDirectory, fileName)));

        expect(cssFilePaths.map(cssFilePath => path.basename(cssFilePath))).toEqual(expect.arrayContaining(['ObjectRefreshDialog.css', 'CockpitConfirmDialog.css']));
        cssFilePaths.forEach(cssFilePath => {
            const cssText = fs.readFileSync(cssFilePath, 'utf8').replace(/\n$/, '');
            expect({ cssFile: path.basename(cssFilePath), count: RECIPE_COCKPIT_PANEL_STYLESHEET.split(cssText).length - 1 })
                .toEqual({ cssFile: path.basename(cssFilePath), count: 1 });
        });

    });

    it('holds no template, file, address or other stylesheet in its .css, and one depth rule per level and one emoji rule per verb button (#644)', () => {

        const verbButtonVerbs: Record<string, string> = RECIPE_COCKPIT_VERB_BUTTON_VERBS;
        const depthRules = RECIPE_COCKPIT_PANEL_STYLESHEET.match(/\.treeObject\.treeObjectDepth(\d+) \{ margin-left: calc\(var\(--sdt-nesting-indent\) \* \1\); \}/g) ?? [];

        ['${', 'url(', '@import', '<link', '</style', '<!--', '/* include:'].forEach(forbiddenText =>
            expect({ forbiddenText, isHeld: RECIPE_COCKPIT_PANEL_STYLESHEET.includes(forbiddenText) }).toEqual({ forbiddenText, isHeld: false }));
        expect(depthRules).toHaveLength(RecipeCockpitShellConstants.RECIPE_COCKPIT_MAX_DRAWN_NESTING_DEPTH);
        Object.entries(verbButtonVerbs).forEach(([className, verb]) =>
            expect(RECIPE_COCKPIT_PANEL_STYLESHEET).toContain(`    .sdtButton.${className}::before { content: var(--sdt-verb-emoji-${verb}) / ''; margin-right: 0.35em; }`));
        expect(RECIPE_COCKPIT_CUSTOM_PROPERTIES['--sdt-verb-emoji-generateData'])
            .toBe(`'${RecipeCockpitPanelConstants.RECIPE_COCKPIT_ACTION_VERB_EMOJI.generateData}'`);

    });

    // #657: THE TEMPLATE-LITERAL SCRIPT AND ITS BRIDGE ARE GONE; THE BUNDLE STARTS THE PANEL ITSELF AND LEAVES NOTHING ON window
    it('is the shell\'s whole script, and starts the panel itself with nothing left on window (#657)', () => {

        const html = RecipeCockpitShell.buildWebviewShellHtml('bundleNonce');
        const scriptOpeningTag = '<script nonce="bundleNonce">';
        const scriptText = html.substring(html.indexOf(scriptOpeningTag) + scriptOpeningTag.length, html.indexOf('</script>'));

        expect(html.split(scriptOpeningTag)).toHaveLength(2);
        expect(scriptText).toBe(`\n${RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT}`);
        expect(RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT.startsWith('(() => {')).toBe(true);
        expect(RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT.trimEnd().endsWith('startRecipeCockpitPanel();\n})();')).toBe(true);

    });

    it('holds no panel module that declares a name from a script around it: each imports what it reads (#657)', () => {

        // EVERY FOLDER UNDER A panel/ FOLDER, SO A NEW ONE IS READ WITHOUT BEING LISTED HERE
        const panelModulePaths = ['CockpitKit/panel', 'RecipeCockpitService/panel'].flatMap(panelDirectory =>
            (fs.readdirSync(path.join(REPOSITORY_ROOT, 'src/treecipe/src', panelDirectory), { recursive: true }) as string[]).filter(fileName => fileName.endsWith('.ts')).map(fileName => path.join(REPOSITORY_ROOT, 'src/treecipe/src', panelDirectory, fileName)));
        const ambientNames = panelModulePaths.flatMap(panelModulePath =>
            Array.from(fs.readFileSync(panelModulePath, 'utf8').matchAll(/^declare (?:const|let|function) ([A-Za-z_$][\w$]*)/gm), match => ({ panelModule: path.basename(panelModulePath), ambientName: match[1] })));

        expect(panelModulePaths.map(panelModulePath => path.basename(panelModulePath))).toEqual(expect.arrayContaining(['RecipeCockpitPanelHost.ts', 'PanelRender.ts', 'PanelPlace.ts', 'TreeCard.ts', 'ObjectRefreshDialog.ts']));
        // THE WEBVIEW DEFINES acquireVsCodeApi, AND ONLY THE CONNECTION CALLS IT
        expect(ambientNames).toEqual([{ panelModule: 'RecipeCockpitPanelConnection.ts', ambientName: 'acquireVsCodeApi' }]);

    });

    it('holds no function or arrow in any template literal of the service or its shell, and no JSON.stringify in the shell\'s, so no panel logic or injected value is left in a string (#657, #671)', () => {

        const templateTexts: string[] = [];
        const rawTemplateTexts: string[] = [];
        // THE SHELL'S DOCUMENT LIVES IN RecipeCockpitShell.ts (#671); THE HUB'S OWN TEMPLATES ARE HELD TO THE SAME RULE
        ['RecipeCockpitService.ts', 'RecipeCockpitShell.ts'].forEach(fileName => {
            const servicePath = path.join(REPOSITORY_ROOT, 'src/treecipe/src/RecipeCockpitService', fileName);
            const sourceFile = ts.createSourceFile(servicePath, fs.readFileSync(servicePath, 'utf8'), ts.ScriptTarget.Latest, true);
            const visit = (node: ts.Node) => {
                if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) { rawTemplateTexts.push(node.getText(sourceFile)); }
                // THE LITERAL TEXT ONLY: AN EXPRESSION INSIDE ${…} IS THE HOST'S OWN CHECKED CODE
                if (ts.isNoSubstitutionTemplateLiteral(node)) { templateTexts.push(node.text); }
                if (ts.isTemplateExpression(node)) { templateTexts.push([node.head.text, ...node.templateSpans.map(span => span.literal.text)].join('${…}')); }
                ts.forEachChild(node, visit);
            };
            visit(sourceFile);
        });

        expect(templateTexts.some(templateText => templateText.includes('<script nonce='))).toBe(true);
        expect(templateTexts.filter(templateText => /\bfunction\b[\s\w$]*\(|=>/.test(templateText))).toEqual([]);
        // THE SHELL'S OWN ${…} EXPRESSIONS TOO: A VALUE STRINGIFIED INTO THE DOCUMENT IS AN INJECTION, WHEREVER IN IT
        expect(rawTemplateTexts.filter(rawTemplateText => rawTemplateText.includes('<script nonce=') && rawTemplateText.includes('JSON.stringify('))).toEqual([]);
        const shellTemplate = templateTexts.find(templateText => templateText.includes('<script nonce=')) as string;
        expect(shellTemplate.substring(shellTemplate.indexOf('<script nonce='))).toBe('<script nonce="${…}">\n${…}</script>\n</body>\n</html>\n');

    });

    // CALLERS AND TESTS IMPORT A TAB'S PANEL CONSTANTS FROM THE FILE THAT HOLDS THEM, NEVER THROUGH THE SERVICE (#671)
    it('re-exports from the service none of the constants the panel modules import for the Troubleshooting, Query, Treecipe Adapter and Data Sets tabs, the Record types section, the field editor, Target Org Manager, the field rows, navigation, help, the frame, the shared glyphs and action words, and Customize and create new recipe (#671)', () => {

        const tabConstants: Record<string, unknown> = { ...RecipeCockpitTroubleshootingConstants, ...RecipeCockpitQueryTabConstants, ...RecipeCockpitAdapterConstants, ...RecipeCockpitDatasetsTabConstants, ...RecipeCockpitTreecipeFieldEditorConstants, ...RecipeCockpitRecordTypesConstants, ...RecipeCockpitDataOrgConstants, ...RecipeCockpitFieldRowsConstants, ...RecipeCockpitNavigationConstants, ...RecipeCockpitHelpConstants, ...RecipeCockpitShellConstants, ...RecipeCockpitPanelConstants, ...RecipeCockpitCustomTreecipeConstants };
        const constantNames = Object.keys(tabConstants);
        const serviceExports: Record<string, unknown> = RecipeCockpitServiceModule;

        expect(constantNames).toEqual(expect.arrayContaining(['RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS', 'RECIPE_COCKPIT_HISTORY_STATUS_DISPLAY', 'RECIPE_COCKPIT_ASSIGN_PERMISSION_SETS_TITLE', 'RECIPE_COCKPIT_QUERY_INTRO',
            'RECIPE_COCKPIT_UPDATER_INTRO', 'RECIPE_COCKPIT_ADAPTER_APPLY_LABEL', 'RECIPE_COCKPIT_UPDATER_LOOKUP_REASON', 'RECIPE_COCKPIT_RECORD_LINK_TITLE',
            'RECIPE_COCKPIT_DATASET_INSERT_STATUS_DISPLAY', 'RECIPE_COCKPIT_FAVORITE_TREE_LABEL',
            'RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH', 'RECIPE_COCKPIT_GEOLOCATION_COMPONENT_RANGES', 'RECIPE_COCKPIT_PICKLIST_RESET_LABEL', 'RECIPE_COCKPIT_CREATE_PARENT_REFUSAL_TEXTS', 'RECIPE_COCKPIT_WIRE_ALL_LOOKUPS_ACTION_LABEL',
            'RECIPE_COCKPIT_NO_DATA_ORG_INSERT_REASON', 'RECIPE_COCKPIT_INSERT_REASON_TROUBLESHOOTING_LINKS', 'RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL',
            'RECIPE_COCKPIT_MANAGE_RECORD_TYPES_LABEL', 'RECIPE_COCKPIT_NO_OBJECT_TODOS_NOTE',
            'RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON', 'RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_FIELD_TYPES', 'RECIPE_COCKPIT_HIDE_UNSELECTED_FIELDS_LABEL', 'RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_LINK_PREFIX',
            'RECIPE_COCKPIT_AUTO_EXPAND_ROW_BUDGET', 'RECIPE_COCKPIT_TREE_PICKER_OBJECTS_LABEL', 'RECIPE_COCKPIT_TREECIPES_SEARCH_PLACEHOLDER', 'RECIPE_COCKPIT_FRIENDS_MENU_HINT',
            'RECIPE_COCKPIT_QUERY_MAX_LENGTH', 'RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH', 'RECIPE_COCKPIT_HELP_SECTIONS', 'RECIPE_COCKPIT_PANEL_PLACE_VERSION', 'RECIPE_COCKPIT_TREE_TABS', 'RECIPE_COCKPIT_NO_FAVORITES_MESSAGE', 'RECIPE_COCKPIT_RESET_SELECTION_LABEL',
            'RECIPE_COCKPIT_ACTION_VERB_EMOJI', 'RECIPE_COCKPIT_CUSTOMIZE_TREE_LABEL']));
        expect(constantNames.filter(constantName => constantName in serviceExports)).toEqual([]);

    });

    // THE OBJECT REFRESH DIALOG'S WORDS ARE THE PANEL'S TOO (#657); RecipeCockpitObjectRefresh GIVES ITS KINDS, AND THE SERVICE NONE OF THEM (#671)
    it('gives the Object refresh kinds from RecipeCockpitObjectRefresh as the same values the panel draws, and none of its words from the service (#657, #671)', () => {

        const serviceExports: Record<string, unknown> = RecipeCockpitServiceModule;
        const objectRefreshExports: Record<string, unknown> = RecipeCockpitObjectRefreshModule;
        const objectRefreshConstants: Record<string, unknown> = RecipeCockpitObjectRefreshConstants;

        expect(Object.keys(objectRefreshConstants).filter(constantName => constantName in serviceExports)).toEqual([]);
        ['OBJECT_REFRESH_KINDS', 'OBJECT_REFRESH_KIND_LABELS'].forEach(constantName =>
            expect({ constantName, isSameValue: objectRefreshExports[constantName] === objectRefreshConstants[constantName] }).toEqual({ constantName, isSameValue: true }));

    });

    // THE WRITER IMPORTS NOTHING, SO THE PANEL SPELLS THE NICKNAME RULE OUT; THE TWO MUST NOT DRIFT (#657)
    it('holds the panel\'s nickname pattern to the recipe writer\'s, and the reference TODO to RelationshipService\'s (#657)', () => {

        expect(RecipeCockpitNavigationConstants.RECIPE_COCKPIT_YAML_NON_STRING_NICKNAME_PATTERN.source).toBe(YAML_NON_STRING_PLAIN_SCALAR_PATTERN.source);
        expect(RecipeCockpitNavigationConstants.RECIPE_COCKPIT_YAML_NON_STRING_NICKNAME_PATTERN.flags).toBe(YAML_NON_STRING_PLAIN_SCALAR_PATTERN.flags);
        expect(REFERENCE_ID_REQUIRED_TODO).toBe(RelationshipService.referenceIdRequiredTodo);

    });

    // RecipeCockpitOrgAuthorize's NOTIFICATIONS QUOTE THE BUTTON'S WORDS, SO ITS IMPORTERS KEEP READING THEM THERE (#654)
    it('gives the Authorize org words from RecipeCockpitOrgAuthorize as the same values the panel draws (#654)', () => {

        const orgAuthorizeExports: Record<string, unknown> = RecipeCockpitOrgAuthorizeModule;

        ['RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL', 'RECIPE_COCKPIT_AUTHORIZE_ORG_RUNNING_LABEL', 'RECIPE_COCKPIT_AUTHORIZE_ORG_TOOLTIP'].forEach(constantName =>
            expect({ constantName, isSameValue: orgAuthorizeExports[constantName] === (RecipeCockpitDataOrgConstants as Record<string, unknown>)[constantName] })
                .toEqual({ constantName, isSameValue: true }));

    });

    it('holds no closing script tag and loads nothing from outside the document', () => {

        expect(RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT).not.toMatch(/<\/script|<!--/i);
        // THE ONE URL IN IT IS THE SVG NAMESPACE createElementNS NAMES, WHICH LOADS NOTHING
        expect(RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT.split('"http://www.w3.org/2000/svg"').join('')).not.toMatch(/\brequire\(|\bimport\(|https?:\/\//);

    });

    it('refuses a script holding a closing script tag or a comment opener, in any case, and says what to do', () => {

        expect(() => PanelBundler.refuseClosingScriptTag('var label = "</SCRIPT>";')).toThrow('holding "</script", which can end the panel\'s <script> element early. Build that text from parts instead.');
        expect(() => PanelBundler.refuseClosingScriptTag('var label = "<!-- <script>";')).toThrow('holding "<!--"');
        expect(PanelBundler.refuseClosingScriptTag('var label = "<script";')).toBe('var label = "<script";');

    });

});
