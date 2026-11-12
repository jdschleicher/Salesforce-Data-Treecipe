const fs = require('fs');
const path = require('path');

const { PanelBundler, PANEL_ENTRY_POINT, PANEL_BUNDLE_FILE, PANEL_MODULES_NAME } = require('./esbuild.panel.js');

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

describe('PanelBundler.run (#637)', () => {

    const consoleOutput = () => ({ log: jest.fn(), error: jest.fn() });

    it('writes the generated file and exits 0', async () => {

        jest.spyOn(PanelBundler, 'buildScript').mockResolvedValue('var recipeCockpitPanelModules = (() => {})();\n');
        const writeFileSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
        const output = consoleOutput();

        await expect(PanelBundler.run(output)).resolves.toBe(0);

        expect(writeFileSpy).toHaveBeenCalledWith(path.resolve(__dirname, PANEL_BUNDLE_FILE), PanelBundler.buildGeneratedFileText('var recipeCockpitPanelModules = (() => {})();\n'));
        expect(output.log).toHaveBeenCalledWith(`Bundled ${PANEL_ENTRY_POINT} to ${PANEL_BUNDLE_FILE}.`);

    });

    it('reports to the console when no output is given, as npm run bundle-panel calls it', async () => {

        jest.spyOn(PanelBundler, 'buildScript').mockResolvedValue('var recipeCockpitPanelModules = (() => {})();\n');
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
