import * as fs from 'fs';
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
import * as RecipeCockpitServiceModule from '../RecipeCockpitService';
import { RecipeCockpitService } from '../RecipeCockpitService';
import * as RecipeCockpitDatasetsTabConstants from '../RecipeCockpitDatasetsTabConstants';
import * as RecipeCockpitQueryTabConstants from '../RecipeCockpitQueryTabConstants';
import * as RecipeCockpitTroubleshootingConstants from '../RecipeCockpitTroubleshootingConstants';
import { RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT } from '../RecipeCockpitPanelBundle.generated';

const { PanelBundler, PANEL_BUNDLE_FILE, PANEL_MODULES_NAME, REGENERATE_COMMAND } = require('../../../../../esbuild.panel.js');

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

    it('is inlined once, inside the nonced script\'s outer function, before the cockpit reads its exports', () => {

        const html = RecipeCockpitService.buildWebviewShellHtml('bundleNonce');
        const scriptStart = html.indexOf('<script nonce="bundleNonce">');
        const outerFunctionStart = html.indexOf('(function () {', scriptStart);
        const bundleStart = html.indexOf(RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT);

        expect(html.split(RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT)).toHaveLength(2);
        expect(scriptStart).toBeGreaterThan(-1);
        expect(bundleStart).toBeGreaterThan(outerFunctionStart);
        expect(bundleStart).toBeLessThan(html.indexOf('</script>', scriptStart));
        expect(RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT.startsWith(`var ${PANEL_MODULES_NAME} = (() => {`)).toBe(true);
        expect(html.indexOf(`} = ${PANEL_MODULES_NAME};`)).toBeGreaterThan(bundleStart);

    });

    it('binds every export of the bundle under its own name, and no moved function is defined again in the script (#638)', () => {

        const html = RecipeCockpitService.buildWebviewShellHtml('bundleNonce');
        const exportedNames = Object.keys(new Function(`${RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT}\nreturn ${PANEL_MODULES_NAME};`)()).sort();
        const bridge = /const \{([^}]*)\} = recipeCockpitPanelModules;/.exec(html);
        const scriptOutsideBundle = html.substring(html.indexOf('<script nonce="bundleNonce">'), html.indexOf('</script>')).replace(RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT, '');

        expect(exportedNames).toEqual(expect.arrayContaining(['buildActionCard', 'buildRowTable', 'buildTabSearch', 'createButton', 'createElement', 'renderConfirmRequest', 'setShownWithMotion']));
        expect(bridge).not.toBeNull();
        expect((bridge as RegExpExecArray)[1].split(',').map(boundName => boundName.trim()).filter(Boolean).sort()).toEqual(exportedNames);
        exportedNames.forEach(exportedName =>
            expect({ exportedName, isDefinedAgain: new RegExp(`function ${exportedName}\\(`).test(scriptOutsideBundle) }).toEqual({ exportedName, isDefinedAgain: false }));

    });

    it('finds every name a panel module declares from the script around it declared in that script (#638)', () => {

        const html = RecipeCockpitService.buildWebviewShellHtml('bundleNonce');
        const scriptOutsideBundle = html.substring(html.indexOf('<script nonce="bundleNonce">'), html.indexOf('</script>')).replace(RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT, '');
        // EVERY FOLDER UNDER A panel/ FOLDER, SO A NEW ONE (#639's troubleshooting/) IS READ WITHOUT BEING LISTED HERE
        const panelModulePaths = ['CockpitKit/panel', 'RecipeCockpitService/panel'].flatMap(panelDirectory =>
            (fs.readdirSync(path.join(REPOSITORY_ROOT, 'src/treecipe/src', panelDirectory), { recursive: true }) as string[]).filter(fileName => fileName.endsWith('.ts')).map(fileName => path.join(REPOSITORY_ROOT, 'src/treecipe/src', panelDirectory, fileName)));
        const ambientNames = panelModulePaths.flatMap(panelModulePath =>
            Array.from(fs.readFileSync(panelModulePath, 'utf8').matchAll(/^declare (?:const|let|function) ([A-Za-z_$][\w$]*)/gm), match => ({ panelModule: path.basename(panelModulePath), ambientName: match[1] })));

        expect(panelModulePaths.map(panelModulePath => path.basename(panelModulePath))).toEqual(expect.arrayContaining(['TroubleshootingTab.ts', 'TroubleshootingHistory.ts']));
        expect(ambientNames.map(ambient => ambient.ambientName)).toEqual(expect.arrayContaining(['displayTitleOf', 'savePanelPlace', 'vscodeApi', 'confirmDialog', 'findTreeState', 'versionLabelOf', 'isMetadataDeployRunning', 'isTreeQueryRunning', 'QUERY_MAX_LENGTH', 'buildRecordTable', 'answeredDatasetCounts', 'buildNameEditor', 'isDataOrgChecking']));
        ambientNames.forEach(ambient =>
            expect({ ...ambient, isDeclared: new RegExp(`(?:function ${ambient.ambientName}\\(|(?:const|let) ${ambient.ambientName}\\b)`).test(scriptOutsideBundle) })
                .toEqual({ ...ambient, isDeclared: true }));

    });

    // A MOVED FUNCTION, EXPORTED OR NOT, LEFT IN THE STRING TOO WOULD SHADOW OR BE SHADOWED UNCHECKED (#639, #640, #642)
    it('defines no function of the bundle again in the script around it, the Troubleshooting, Query and Data Sets tabs\' included (#639, #640, #642)', () => {

        const html = RecipeCockpitService.buildWebviewShellHtml('bundleNonce');
        const scriptOutsideBundle = html.substring(html.indexOf('<script nonce="bundleNonce">'), html.indexOf('</script>')).replace(RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT, '');
        const definedFunctionNamesOf = (scriptText: string): string[] => Array.from(scriptText.matchAll(/function ([A-Za-z_$][\w$]*)\(/g), match => match[1]);
        const bundleFunctionNames = definedFunctionNamesOf(RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT);
        const scriptFunctionNames = new Set(definedFunctionNamesOf(scriptOutsideBundle));

        expect(bundleFunctionNames).toEqual(expect.arrayContaining(['buildTroubleshootingTab', 'buildRemovedTodos', 'buildDeployAction', 'buildValidationRuleRow', 'sortTroubleshootingHistory',
            'buildQueryTab', 'buildTreeQuery', 'describeQueryRefusal', 'renderTreeQueryResult', 'applyQueryFilter',
            'buildDatasetsTab', 'buildDatasetRowState', 'drawDatasetJourney', 'buildDatasetLastInsertElements', 'formatDatasetRecordTypes', 'applyRowSearch']));
        expect(bundleFunctionNames.filter(functionName => scriptFunctionNames.has(functionName))).toEqual([]);

    });

    // CALLERS AND TESTS STILL IMPORT A TAB'S PANEL CONSTANTS FROM THE SERVICE (#639, #640, #642)
    it('re-exports from the service every constant the panel modules import for the Troubleshooting, Query and Data Sets tabs, as the same value (#639, #640, #642)', () => {

        const tabConstants: Record<string, unknown> = { ...RecipeCockpitTroubleshootingConstants, ...RecipeCockpitQueryTabConstants, ...RecipeCockpitDatasetsTabConstants };
        const constantNames = Object.keys(tabConstants);
        const serviceExports: Record<string, unknown> = RecipeCockpitServiceModule;

        expect(constantNames).toEqual(expect.arrayContaining(['RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS', 'RECIPE_COCKPIT_HISTORY_STATUS_DISPLAY', 'RECIPE_COCKPIT_ASSIGN_PERMISSION_SETS_TITLE', 'RECIPE_COCKPIT_QUERY_INTRO', 'RECIPE_COCKPIT_DATASET_INSERT_STATUS_DISPLAY', 'RECIPE_COCKPIT_FAVORITE_TREE_LABEL']));
        constantNames.forEach(constantName =>
            expect({ constantName, isSameValue: serviceExports[constantName] === tabConstants[constantName] })
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
