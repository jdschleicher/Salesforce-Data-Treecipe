const fs = require('fs');
const path = require('path');

const { PanelBundler, PANEL_ENTRY_POINT, PANEL_BUNDLE_FILE, STYLESHEET_ENTRY, STYLESHEET_FILE } = require('./esbuild.panel.js');

describe('PanelBundler.buildOptions (#637)', () => {

    // The bundle runs in a webview whose CSP admits only the nonced inline script: a browser IIFE with
    // nothing left external is the only shape that runs there. A node or esm build would require or
    // import at run time, which the webview cannot answer.
    it('bundles the panel entry into one browser IIFE with nothing external', () => {

        const options = PanelBundler.buildOptions();

        expect(options.entryPoints).toEqual([PANEL_ENTRY_POINT]);
        expect(options.platform).toBe('browser');
        expect(options.format).toBe('iife');
        // THE ENTRY STARTS THE PANEL ITSELF (#657), SO NO GLOBAL HOLDS ITS EXPORTS
        expect(options.globalName).toBeUndefined();
        expect(options.bundle).toBe(true);
        expect(options.external).toBeUndefined();

    });

    // The shell inlines the text; nothing is written beside it for the webview to load.
    it('returns the script instead of writing a file, checked with the panel tsconfig', () => {

        const options = PanelBundler.buildOptions();

        expect(options.write).toBe(false);
        expect(options.tsconfig).toBe('tsconfig.panel.json');

    });

    // The cockpit's source-scanning suites read the shell's script, bundle included.
    it('keeps the bundle readable: not minified', () => {

        expect(PanelBundler.buildOptions().minify).toBe(false);

    });

});

describe('PanelBundler.run (#637)', () => {

    const consoleOutput = () => ({ log: jest.fn(), error: jest.fn() });

    it('writes the generated file and exits 0', async () => {

        jest.spyOn(PanelBundler, 'buildScript').mockResolvedValue('(() => {})();\n');
        const writeFileSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
        const output = consoleOutput();

        await expect(PanelBundler.run(output)).resolves.toBe(0);

        expect(writeFileSpy).toHaveBeenCalledWith(path.resolve(__dirname, PANEL_BUNDLE_FILE), PanelBundler.buildGeneratedFileText('(() => {})();\n'));
        expect(output.log).toHaveBeenCalledWith(`Bundled ${PANEL_ENTRY_POINT} to ${PANEL_BUNDLE_FILE}.`);

    });

    it('reports to the console when no output is given, as npm run bundle-panel calls it', async () => {

        jest.spyOn(PanelBundler, 'buildScript').mockResolvedValue('(() => {})();\n');
        jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

        await expect(PanelBundler.run()).resolves.toBe(0);

        expect(consoleLogSpy).toHaveBeenCalledWith(`Bundled ${PANEL_ENTRY_POINT} to ${PANEL_BUNDLE_FILE}.`);

    });

    // A refused or broken bundle must fail vscode:prepublish, and leave the committed file as it was
    it('writes nothing and exits 1 with the reason when the build fails', async () => {

        jest.spyOn(PanelBundler, 'buildScript').mockRejectedValue(new Error('bundles to a script holding "</script"'));
        const writeFileSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
        const output = consoleOutput();

        await expect(PanelBundler.run(output)).resolves.toBe(1);

        expect(writeFileSpy).not.toHaveBeenCalled();
        expect(output.error).toHaveBeenCalledWith('Bundling the panel failed: bundles to a script holding "</script"');

    });

});

describe('PanelBundler.buildStylesheet (#644)', () => {

    const ENTRY = path.resolve(__dirname, STYLESHEET_ENTRY);
    const readFrom = (filesByPath) => (filePath) => {
        if (!Object.prototype.hasOwnProperty.call(filesByPath, filePath)) { throw new Error(`ENOENT: ${filePath}`); }
        return filesByPath[filePath];
    };

    it('replaces an include line with that file, verbatim and where it stands, so the cascade keeps its order', () => {

        const stylesheet = PanelBundler.buildStylesheet(readFrom({
            [ENTRY]: '    .first { color: var(--sdt-text); }\n    /* include: kit/Kit.css */\n    .last { color: var(--sdt-muted); }\n',
            [path.resolve(path.dirname(ENTRY), 'kit/Kit.css')]: '    .kit { color: var(--sdt-accent); }\n'
        }));

        expect(stylesheet).toBe('    .first { color: var(--sdt-text); }\n    .kit { color: var(--sdt-accent); }\n    .last { color: var(--sdt-muted); }\n');

    });

    it.each([
        ['</style', '    .a::before { content: "</style>"; }'],
        ['<!--', '    /* <!-- */'],
        ['url(', '    .a { background: url(https://example.com/a.png); }'],
        ['@import', '    @import "other.css";'],
        ['${', '    .a { width: ${WIDTH}; }'],
        // THE MATCH IGNORES CASE: A BROWSER READS URL( AND @IMPORT, AND THE HTML TOKENIZER </STYLE, AS IT READS THEM IN LOWER CASE
        ['url(', '    .a { background: URL(https://example.com/a.png); }'],
        ['@import', '    @IMPORT "other.css";'],
        ['</style', '    .a::before { content: "</STYLE>"; }']
    ])('refuses a stylesheet holding %s and says why', (forbiddenText, cssLine) => {

        expect(() => PanelBundler.buildStylesheet(readFrom({ [ENTRY]: cssLine + '\n' }))).toThrow(`builds to a stylesheet holding "${forbiddenText}"`);

    });

    it('refuses an include line inside an included file, and names the include that is not there', () => {

        expect(() => PanelBundler.buildStylesheet(readFrom({
            [ENTRY]: '    /* include: Kit.css */\n',
            [path.resolve(path.dirname(ENTRY), 'Kit.css')]: '    /* include: Other.css */\n'
        }))).toThrow('Kit.css:1 holds an include line inside an included file');
        expect(() => PanelBundler.buildStylesheet(readFrom({ [ENTRY]: '    .a { color: var(--sdt-text); }\n    /* include: Missing.css */\n' })))
            .toThrow(`${STYLESHEET_ENTRY}:2 includes Missing.css, which could not be read (ENOENT`);

    });

    // ONE WRITTEN ANY OTHER WAY WOULD BE KEPT AS A COMMENT, AND ITS FILE SILENTLY LEFT OUT OF THE PANEL
    it.each([
        ['    /* Include: Kit.css */'],
        ['    /*include: Kit.css*/'],
        ['    /* include: Kit.css */ .a { color: var(--sdt-text); }'],
        ['    /* include: Kit with space.css */']
    ])('refuses a line that looks like an include but is not one: %s', (cssLine) => {

        expect(() => PanelBundler.buildStylesheet(readFrom({ [ENTRY]: cssLine + '\n' })))
            .toThrow(`${STYLESHEET_ENTRY}:1 looks like an include but is not one, so its file would be left out.`);

    });

    it('names the included file and line that holds a refused text', () => {

        expect(() => PanelBundler.buildStylesheet(readFrom({
            [ENTRY]: '    /* include: kit/Kit.css */\n',
            [path.resolve(path.dirname(ENTRY), 'kit/Kit.css')]: '    .a { color: var(--sdt-text); }\n    .b { background: url(x.png); }\n'
        }))).toThrow('RecipeCockpitService/panel/kit/Kit.css:2 builds to a stylesheet holding "url("');

    });

    it('writes the stylesheet beside the bundle, so npm run bundle-panel and vscode:prepublish refresh both', async () => {

        jest.spyOn(PanelBundler, 'buildScript').mockResolvedValue('(() => {})();\n');
        jest.spyOn(PanelBundler, 'buildStylesheet').mockReturnValue('    .a { color: var(--sdt-text); }\n');
        const writeFileSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

        await expect(PanelBundler.run({ log: jest.fn(), error: jest.fn() })).resolves.toBe(0);

        expect(writeFileSpy).toHaveBeenCalledWith(path.resolve(__dirname, STYLESHEET_FILE), PanelBundler.buildGeneratedStylesheetFileText('    .a { color: var(--sdt-text); }\n'));

    });

    it('writes neither file when the stylesheet is refused', async () => {

        jest.spyOn(PanelBundler, 'buildScript').mockResolvedValue('(() => {})();\n');
        jest.spyOn(PanelBundler, 'buildStylesheet').mockImplementation(() => { throw new Error('builds to a stylesheet holding "url("'); });
        const writeFileSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
        const output = { log: jest.fn(), error: jest.fn() };

        await expect(PanelBundler.run(output)).resolves.toBe(1);

        expect(writeFileSpy).not.toHaveBeenCalled();
        expect(output.error).toHaveBeenCalledWith('Bundling the panel failed: builds to a stylesheet holding "url("');

    });

});
