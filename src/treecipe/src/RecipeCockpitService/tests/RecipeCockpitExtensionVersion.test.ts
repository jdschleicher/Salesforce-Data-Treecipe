import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: jest.fn().mockReturnValue({ get: jest.fn(), update: jest.fn(), inspect: jest.fn() }),
        fs: { readDirectory: jest.fn(), readFile: jest.fn() }
    },
    env: { openExternal: jest.fn() },
    window: {
        createWebviewPanel: jest.fn(),
        createQuickPick: jest.fn(),
        withProgress: jest.fn(),
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        showErrorMessage: jest.fn(),
        showQuickPick: jest.fn(),
        showInputBox: jest.fn(),
        createOutputChannel: jest.fn(),
        createStatusBarItem: jest.fn().mockImplementation(() => ({ text: '', show: jest.fn(), dispose: jest.fn() }))
    },
    commands: { registerCommand: jest.fn(), executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15, Window: 10 },
    ConfigurationTarget: { Workspace: 2 },
    FileType: { Directory: 2, File: 1, SymbolicLink: 64 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }), parse: (uriValue: string, isStrict?: boolean) => ({ parsedFrom: uriValue, isStrict: isStrict, toString: () => uriValue }) }
}), { virtual: true });

jest.mock('@salesforce/core', () => ({
    AuthInfo: { listAllAuthorizations: jest.fn() },
    StateAggregator: { clearInstance: jest.fn() },
    Org: { create: jest.fn() }
}));

import {
    IRecipeCockpitPanelMessage,
    RecipeCockpitService,
    RECIPE_COCKPIT_CHANGELOG_LINK_LABEL,
    RECIPE_COCKPIT_CHANGELOG_NOT_OPENED_MESSAGE,
    RECIPE_COCKPIT_CHANGELOG_URL,
    RECIPE_COCKPIT_GITHUB_GLYPH_PATH,
    RECIPE_COCKPIT_GITHUB_GLYPH_VIEW_BOX,
    RECIPE_COCKPIT_NO_RUN_MESSAGE
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');

const loadTreeRecipe = () => {
    const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
    return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, 'recipe-2026-09-20T10-00-00').recipeViewModel;
};

const NO_RUN_RECIPE = { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: RECIPE_COCKPIT_NO_RUN_MESSAGE };

describe('RecipeCockpitService, the version and the CHANGELOG link at the top right (#333)', () => {

    afterEach(() => {
        RecipeCockpitService.setExtensionVersion(undefined);
    });

    describe('readExtensionVersion', () => {

        it.each(['3.90.0', '0.0.1', '10.20.30', '3.90.0-beta.1', '3.90.0-rc-2'])('accepts %s', (candidateVersion) => {

            expect(RecipeCockpitService.readExtensionVersion(candidateVersion)).toBe(candidateVersion);

        });

        it.each([
            ['an empty string', ''],
            ['two parts', '3.90'],
            ['a leading v', 'v3.90.0'],
            ['markup', '3.90.0-<img src=x>'],
            ['a line break', '3.90.0\n4.0.0'],
            ['a trailing space', '3.90.0 '],
            ['a number', 3.9],
            ['undefined', undefined],
            ['an object', { version: '3.90.0' }]
        ])('refuses %s', (_description, candidateVersion) => {

            expect(RecipeCockpitService.readExtensionVersion(candidateVersion)).toBeUndefined();

        });

    });

    describe('what a (re)loaded document is sent', () => {

        it('sends extensionInfo FIRST, carrying the version set at activation', () => {

            RecipeCockpitService.setExtensionVersion('3.90.0');
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.loadPhaseMessage = 'Finding generated recipe runs…';

            expect(panelState.extensionVersion).toBe('3.90.0');
            expect(RecipeCockpitService.buildReplayMessages(panelState)).toEqual([
                { command: 'extensionInfo', version: '3.90.0' },
                { command: 'loadPhase', message: 'Finding generated recipe runs…' }
            ]);

        });

        it('sends no extensionInfo when the version was not one, and the panel state carries none', () => {

            RecipeCockpitService.setExtensionVersion('3.90.0\n<b>');
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');

            expect(panelState).not.toHaveProperty('extensionVersion');
            expect(RecipeCockpitService.buildReplayMessages(panelState).map(hostMessage => hostMessage.command)).not.toContain('extensionInfo');

        });

        it('replays it through the router on every ready', () => {

            RecipeCockpitService.setExtensionVersion('3.90.0');
            const panelAction = RecipeCockpitService.routePanelMessage({ command: 'ready' }, RecipeCockpitService.buildInitialPanelState('/workspace'));

            expect(panelAction).toEqual({ kind: 'replay', hostMessages: [{ command: 'extensionInfo', version: '3.90.0' }] });

        });

    });

    describe('routePanelMessage', () => {

        it('routes openChangelog before any model is on screen', () => {

            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');

            expect(panelState.recipeDataMessage).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'openChangelog' }, panelState)).toEqual({ kind: 'openChangelog' });

        });

        it('reads nothing a forged message carries: the action names no address', () => {

            const forgedMessage = { command: 'openChangelog', url: 'https://example.com/elsewhere', filePath: '/etc/passwd' } as IRecipeCockpitPanelMessage;

            expect(RecipeCockpitService.routePanelMessage(forgedMessage, RecipeCockpitService.buildInitialPanelState('/workspace'))).toEqual({ kind: 'openChangelog' });

        });

    });

    describe('openChangelogInBrowser', () => {

        it('hands the CONSTANT address to the browser, parsed strictly', async () => {

            (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            await RecipeCockpitService.openChangelogInBrowser();

            expect(RECIPE_COCKPIT_CHANGELOG_URL).toBe('https://github.com/jdschleicher/Salesforce-Data-Treecipe/blob/main/CHANGELOG.md');
            expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
            expect((vscode.env.openExternal as jest.Mock).mock.calls[0][0]).toMatchObject({ parsedFrom: RECIPE_COCKPIT_CHANGELOG_URL, isStrict: true });
            expect(warningSpy).not.toHaveBeenCalled();

        });

        it('warns with fixed text when the browser does not accept the address', async () => {

            (vscode.env.openExternal as jest.Mock).mockResolvedValue(false);
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            await RecipeCockpitService.openChangelogInBrowser();

            expect(warningSpy).toHaveBeenCalledExactlyOnceWith(RECIPE_COCKPIT_CHANGELOG_NOT_OPENED_MESSAGE);

        });

        it('warns with the same fixed text, quoting nothing of the error, when opening throws', async () => {

            (vscode.env.openExternal as jest.Mock).mockRejectedValue(new Error('secret detail from the platform'));
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            await expect(RecipeCockpitService.openChangelogInBrowser()).resolves.toBeUndefined();

            expect(warningSpy).toHaveBeenCalledExactlyOnceWith(RECIPE_COCKPIT_CHANGELOG_NOT_OPENED_MESSAGE);
            expect(RECIPE_COCKPIT_CHANGELOG_NOT_OPENED_MESSAGE).not.toMatch(/[[\]()]/);

        });

    });

    describe('the host, through the panel subscription', () => {

        let temporaryRoot: string;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-version-'));
            fs.cpSync(TREE_WORKSPACE_ROOT, temporaryRoot, { recursive: true });
            postedPanelMessages = [];

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;
            (vscode.env.openExternal as jest.Mock).mockReset();
            (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => ({
                reveal: jest.fn(),
                onDidDispose: jest.fn(),
                webview: {
                    html: '',
                    postMessage: jest.fn().mockImplementation((hostMessage: any) => { postedPanelMessages.push(hostMessage); return Promise.resolve(true); }),
                    onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: any) => {
                        receivedMessageHandler = messageHandler;
                        return { dispose: jest.fn() };
                    })
                }
            }));
            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation(() => ({ text: '', dispose: jest.fn() }) as any);

        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('posts the version first on ready, and opens the CHANGELOG before the model is acknowledged', async () => {

            RecipeCockpitService.setExtensionVersion('3.90.0');
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            await RecipeCockpitService.openRecipeCockpitPanel(temporaryRoot, { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) });
            await receivedMessageHandler({ command: 'ready' });

            expect(postedPanelMessages[0]).toEqual({ command: 'extensionInfo', version: '3.90.0' });
            expect(postedPanelMessages.map(hostMessage => hostMessage.command)).toContain('recipeData');

            await receivedMessageHandler({ command: 'openChangelog', url: 'https://example.com/elsewhere' });

            expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
            expect((vscode.env.openExternal as jest.Mock).mock.calls[0][0]).toMatchObject({ parsedFrom: RECIPE_COCKPIT_CHANGELOG_URL, isStrict: true });
            expect(warningSpy).not.toHaveBeenCalled();

        });

    });

    describe('the shell', () => {

        const shellHtml = () => RecipeCockpitService.buildWebviewShellHtml('testNonce');
        const styleSheet = () => shellHtml().substring(shellHtml().indexOf('<style nonce="testNonce">'), shellHtml().indexOf('</style>'));

        it('puts the title and the top-right slot in one row, outside the body every render replaces', () => {

            expect(shellHtml()).toContain('<div class="cockpitHeader">\n<h1>Recipe Cockpit</h1>\n<div id="cockpitMeta" class="cockpitMeta"></div>\n</div>\n<div id="loadStatus"');
            // #434: THE ROW IS ALSO THE NAVY TITLE BAR, RUNNING THE PANEL'S FULL WIDTH
            expect(styleSheet()).toMatch(/\.cockpitHeader \{\s*display: flex;\s*flex-wrap: wrap;\s*align-items: center;\s*justify-content: space-between;[^}]*margin: 0 -1rem;[^}]*background-color: var\(--sdt-header\);/);

        });

        it('keeps the version, the GitHub mark and "?" one right-aligned group that wraps as a whole (#350)', () => {

            expect(styleSheet()).toContain('.cockpitMeta { display: flex; flex-wrap: nowrap; align-items: center; gap: 0.4rem; margin-left: auto;');
            expect(styleSheet()).toContain('.cockpitMeta .helpToggle {');
            expect(styleSheet()).not.toContain('.toolbar .helpToggle');

        });

        it('makes "?" as tall as the CHANGELOG button, and draws the version in the title bar\'s muted text colour (#487)', () => {

            const helpToggleRule = styleSheet().match(/\.cockpitMeta \.helpToggle \{[^}]*\}/)?.[0] ?? '';
            const changelogRule = styleSheet().match(/\.cockpitChangelog \{[^}]*\}/)?.[0] ?? '';

            expect(helpToggleRule).toContain('height: 2rem;');
            expect(helpToggleRule).toContain('min-height: 0;');
            expect(helpToggleRule).toContain('box-sizing: border-box;');
            expect(changelogRule).toContain('height: 2rem;');
            expect(changelogRule).toContain('box-sizing: border-box;');
            expect(changelogRule).toContain('color: var(--sdt-on-header-muted);');
            expect(styleSheet()).toContain('.cockpitChangelog:hover:not(:disabled) { color: var(--sdt-on-header);');

        });

        it('never carries the CHANGELOG address: the host holds it', () => {

            expect(shellHtml()).not.toContain(RECIPE_COCKPIT_CHANGELOG_URL);
            expect(shellHtml()).not.toContain('github.com');

        });

        it('fills the GitHub mark only from palette tokens, and keeps the reduced-motion block last', () => {

            // #434: ON THE NAVY TITLE BAR, SOFT GRAY AT REST AND TEAL WHILE HOVERED
            expect(styleSheet()).toContain('.githubGlyph path { fill: var(--sdt-on-header-muted); }');
            expect(styleSheet()).toContain('.cockpitChangelog:hover .githubGlyph path, .cockpitChangelog:focus-visible .githubGlyph path { fill: var(--sdt-action); }');
            expect(styleSheet().indexOf('.githubGlyph')).toBeLessThan(styleSheet().indexOf('@media (prefers-reduced-motion: reduce)'));

        });

    });

    describe('the panel script', () => {

        const versionElementOf = (panel: ReturnType<typeof runPanelScript>) => panel.findAll(panel.cockpitMetaElement, 'cockpitVersion')[0];
        const changelogElementOf = (panel: ReturnType<typeof runPanelScript>) => panel.findAll(panel.cockpitMetaElement, 'cockpitChangelog')[0];

        it('draws the GitHub mark as inline SVG and an empty version INSIDE one button before the host has answered (#487)', () => {

            const panel = runPanelScript();
            const changelogElement = changelogElementOf(panel);
            const glyphElement = changelogElement.children[0];

            expect(panel.cockpitMetaElement.children).toEqual([changelogElement, panel.findAll(panel.cockpitMetaElement, 'helpToggle')[0]]);
            expect(changelogElement.children).toEqual([glyphElement, versionElementOf(panel)]);
            expect(versionElementOf(panel).tagName).toBe('span');
            expect(versionElementOf(panel).textContent).toBe('');
            expect(changelogElement.tagName).toBe('button');
            expect(changelogElement.attributes).toMatchObject({ 'type': 'button', 'aria-label': RECIPE_COCKPIT_CHANGELOG_LINK_LABEL, 'title': RECIPE_COCKPIT_CHANGELOG_LINK_LABEL });
            expect(glyphElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
            expect(glyphElement.attributes).toEqual({ 'class': 'githubGlyph', 'viewBox': RECIPE_COCKPIT_GITHUB_GLYPH_VIEW_BOX, 'aria-hidden': 'true', 'focusable': 'false' });
            expect(glyphElement.children[0].namespaceURI).toBe('http://www.w3.org/2000/svg');
            expect(glyphElement.children[0].attributes).toEqual({ d: RECIPE_COCKPIT_GITHUB_GLYPH_PATH });

        });

        it('posts openChangelog and NOTHING else on a click', () => {

            const panel = runPanelScript();
            panel.postedHostMessages.length = 0;

            changelogElementOf(panel).dispatch('click');

            expect(panel.postedHostMessages).toEqual([{ command: 'openChangelog' }]);

        });

        it('posts openChangelog and nothing else when the VERSION text is clicked, since it is part of the button (#487)', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'extensionInfo', version: '3.90.0' });
            panel.postedHostMessages.length = 0;

            versionElementOf(panel).dispatch('click');

            expect(panel.postedHostMessages).toEqual([{ command: 'openChangelog' }]);

        });

        it('names the version in the button\'s accessible name once there is one, and only the link without one (#487)', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'extensionInfo', version: '3.90.0' });

            expect(changelogElementOf(panel).attributes).toMatchObject({
                'aria-label': `${RECIPE_COCKPIT_CHANGELOG_LINK_LABEL}, v3.90.0`,
                'title': `${RECIPE_COCKPIT_CHANGELOG_LINK_LABEL}, v3.90.0`
            });

            panel.postToPanel({ command: 'extensionInfo', version: 42 });

            expect(versionElementOf(panel).textContent).toBe('');
            expect(changelogElementOf(panel).attributes).toMatchObject({ 'aria-label': RECIPE_COCKPIT_CHANGELOG_LINK_LABEL, 'title': RECIPE_COCKPIT_CHANGELOG_LINK_LABEL });
            panel.postedHostMessages.length = 0;
            changelogElementOf(panel).dispatch('click');
            expect(panel.postedHostMessages).toEqual([{ command: 'openChangelog' }]);

        });

        it.each([
            ['the no-run empty state', () => ({ command: 'recipeData', recipe: NO_RUN_RECIPE, renderSequence: 1 })],
            ['a drawn run', () => ({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 })],
            ['a failure to draw', () => ({ command: 'recipeData', recipe: { runs: null }, renderSequence: 1 })]
        ])('keeps the version, the link and "?" on %s, in one container in that order (#350)', (_description, buildRecipeMessage) => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'extensionInfo', version: '3.90.0' });
            panel.postToPanel(buildRecipeMessage());

            const helpToggleElement = panel.findAll(panel.cockpitMetaElement, 'helpToggle')[0];
            expect(versionElementOf(panel).textContent).toBe('v3.90.0');
            expect(panel.cockpitMetaElement.children).toEqual([changelogElementOf(panel), helpToggleElement]);
            expect(versionElementOf(panel).parentNode).toBe(changelogElementOf(panel));
            expect(panel.findAll(panel.cockpitBodyElement, 'cockpitChangelog')).toBeEmpty();
            expect(panel.findAll(panel.cockpitBodyElement, 'helpToggle')).toBeEmpty();
            // ? TOGGLES A SECTION THE BODY HOLDS, SO IT IS DISABLED ONLY WHEN THE BODY HOLDS NONE
            expect(helpToggleElement.disabled).toBe(panel.findAll(panel.cockpitBodyElement, 'helpSection').length === 0);

        });

        it('draws the version after the model too, as a replay may order it', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 });
            panel.postToPanel({ command: 'extensionInfo', version: '3.90.0' });

            expect(versionElementOf(panel).textContent).toBe('v3.90.0');

        });

        it('writes what it is sent as TEXT, and draws no version from a message without one', () => {

            const panel = runPanelScript();

            panel.postToPanel({ command: 'extensionInfo', version: '<img src=x onerror=alert(1)>' });
            expect(versionElementOf(panel).textContent).toBe('v<img src=x onerror=alert(1)>');
            expect(versionElementOf(panel).children).toBeEmpty();

            panel.postToPanel({ command: 'extensionInfo', version: 42 });
            expect(versionElementOf(panel).textContent).toBe('');

        });

    });

});
