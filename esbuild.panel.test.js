const { PanelBundler, PANEL_ENTRY_POINT, PANEL_MODULES_NAME } = require('./esbuild.panel.js');

describe('PanelBundler.buildOptions (#637)', () => {

    // The bundle runs in a webview whose CSP admits only the nonced inline script: a browser IIFE with
    // nothing left external is the only shape that runs there. A node or esm build would require or
    // import at run time, which the webview cannot answer.
    it('bundles the panel entry into one browser IIFE with nothing external', () => {

        const options = PanelBundler.buildOptions();

        expect(options.entryPoints).toEqual([PANEL_ENTRY_POINT]);
        expect(options.platform).toBe('browser');
        expect(options.format).toBe('iife');
        expect(options.globalName).toBe(PANEL_MODULES_NAME);
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
