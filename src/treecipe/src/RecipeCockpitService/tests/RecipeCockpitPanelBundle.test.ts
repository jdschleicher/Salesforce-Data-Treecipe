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
import { RecipeCockpitService } from '../RecipeCockpitService';
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
        expect(html.indexOf(`${PANEL_MODULES_NAME}.renderConfirmRequest`)).toBeGreaterThan(bundleStart);

    });

    it('holds no closing script tag and loads nothing from outside the document', () => {

        expect(RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT).not.toMatch(/<\/script/i);
        expect(RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT).not.toMatch(/\brequire\(|\bimport\(|https?:\/\//);

    });

    it('refuses a script holding a closing script tag, in any case, and says what to do', () => {

        expect(() => PanelBundler.refuseClosingScriptTag('var label = "</SCRIPT>";')).toThrow('which would end the panel\'s <script> element early. Build that text from parts instead.');
        expect(PanelBundler.refuseClosingScriptTag('var label = "<script";')).toBe('var label = "<script";');

    });

});
