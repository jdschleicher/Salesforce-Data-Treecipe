// Bundles the Recipe Cockpit's panel modules into one script the shell inlines (#565, #637).
//
// The panel runs in a webview whose CSP admits only the nonced inline script, so the bundle is not
// a file the webview loads: it is written as a string constant into a generated .ts file, and
// buildWebviewShellHtml makes that string the whole of the panel's script (#657). The
// generated file is committed, so ts-jest and the panel harness run it with no build step, and
// RecipeCockpitPanelBundle.test.ts fails when it no longer matches what this script writes.

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const PANEL_ENTRY_POINT = 'src/treecipe/src/RecipeCockpitService/panel/RecipeCockpitPanel.ts';
const PANEL_BUNDLE_FILE = 'src/treecipe/src/RecipeCockpitService/RecipeCockpitPanelBundle.generated.ts';
const PANEL_BUNDLE_CONSTANT = 'RECIPE_COCKPIT_PANEL_BUNDLE_SCRIPT';

// VS Code 1.94 (the engines floor) ships Chromium 124; es2020 keeps the output close to the source
const PANEL_TARGET = 'es2020';

const REGENERATE_COMMAND = 'npm run bundle-panel';

/*
    The cockpit's stylesheet (#644): plain .css files, written into a second generated .ts file the
    shell interpolates into its one nonced <style>, so the CSP and "no external file" stay as they
    are. A line holding only a CSS comment reading "include: <path>" is replaced by that file,
    verbatim, where it stands, so the cascade keeps the order the kit's strings had. A value the TypeScript also reads
    is a var(--sdt-…) the host writes into :root, never a number in the .css.
*/
const STYLESHEET_ENTRY = 'src/treecipe/src/RecipeCockpitService/panel/RecipeCockpitPanel.css';
const STYLESHEET_FILE = 'src/treecipe/src/RecipeCockpitService/RecipeCockpitPanelStylesheet.generated.ts';
const STYLESHEET_CONSTANT = 'RECIPE_COCKPIT_PANEL_STYLESHEET';
const STYLESHEET_INCLUDE_PATTERN = /^\s*\/\* include: (\S+\.css) \*\/$/;
// ANYTHING THAT LOOKS LIKE AN INCLUDE, IN ANY CASE OR SPACING: ONE THE PATTERN ABOVE DOES NOT TAKE WOULD OTHERWISE BE KEPT AS A COMMENT, ITS FILE SILENTLY LEFT OUT
const STYLESHEET_INCLUDE_LOOKALIKE_PATTERN = /\/\*\s*include\s*:/i;

// WHAT NO STYLESHEET MAY HOLD: AN END TO ITS <style>, A FILE OR ADDRESS TO LOAD, OR A TEMPLATE INTERPOLATION LEFT IN IT
const STYLESHEET_REFUSALS = [
    { text: '</style', reason: 'which ends the panel\'s <style> element early' },
    { text: '<!--', reason: 'which the HTML tokenizer can read as a comment opener' },
    { text: 'url(', reason: 'which loads a file or address, and the CSP and localResourceRoots: [] load none' },
    { text: '@import', reason: 'which loads another stylesheet; include it with an include line instead' },
    { text: '${', reason: 'which is a template interpolation; a value the TypeScript also reads is a var(--sdt-…) the host writes' }
];

class PanelBundler {

    static buildOptions() {

        return {
            absWorkingDir: __dirname,
            entryPoints: [PANEL_ENTRY_POINT],
            tsconfig: 'tsconfig.panel.json',
            bundle: true,
            write: false,
            platform: 'browser',
            // NO globalName (#657): THE ENTRY STARTS THE PANEL ITSELF, SO THE BUNDLE LEAVES NOTHING ON window
            format: 'iife',
            target: PANEL_TARGET,
            // NOT MINIFIED: the source-scanning suites (button kinds, textContent only, createElementNS
            // glyphs, no .style.) read the shell's script, bundle included, as they read the string before
            minify: false,
            charset: 'utf8',
            legalComments: 'none',
            logLevel: 'silent'
        };

    }

    static async buildScript() {

        const result = await esbuild.build(this.buildOptions());
        // esbuild opens the IIFE with "use strict"; dropped, the panel runs in the mode its template-literal script always ran in
        return this.refuseClosingScriptTag(result.outputFiles[0].text.replace(/^"use strict";\n/, ''));

    }

    /*
        The bundle is inlined in an HTML <script>. A "</script" in it ends the element early, and a
        "<!--" can put the HTML tokenizer into its double-escaped state, where the real </script> no
        longer closes the element.
    */
    static refuseClosingScriptTag(script) {

        const scriptBreakingText = ['</script', '<!--'].find(text => script.toLowerCase().includes(text));
        if (scriptBreakingText) {
            throw new Error(`${PANEL_ENTRY_POINT} bundles to a script holding "${scriptBreakingText}", which can end the panel's <script> element early. Build that text from parts instead.`);
        }

        return script;

    }

    static buildStylesheet(readFile = (filePath) => fs.readFileSync(filePath, 'utf8')) {

        const entryPath = path.resolve(__dirname, STYLESHEET_ENTRY);
        const entryDirectory = path.dirname(entryPath);
        const nameOf = (filePath) => path.relative(__dirname, filePath).split(path.sep).join('/');

        // EVERY FILE IS CHECKED ON ITS OWN, SO A REFUSAL NAMES THE FILE AND LINE THAT HOLDS IT
        const refuseIn = (fileName, fileLines) => fileLines.forEach((line, lineIndex) => {
            const refusal = STYLESHEET_REFUSALS.find(candidate => line.toLowerCase().includes(candidate.text.toLowerCase()));
            if (refusal) {
                throw new Error(`${fileName}:${lineIndex + 1} builds to a stylesheet holding "${refusal.text}", ${refusal.reason}.`);
            }
        });

        const entryLines = readFile(entryPath).split('\n');
        const stylesheet = entryLines.map((line, lineIndex) => {
            const includeMatch = STYLESHEET_INCLUDE_PATTERN.exec(line);
            if (!includeMatch) {
                if (STYLESHEET_INCLUDE_LOOKALIKE_PATTERN.test(line)) {
                    throw new Error(`${STYLESHEET_ENTRY}:${lineIndex + 1} looks like an include but is not one, so its file would be left out. Write it on a line of its own as: /* include: <relative path>.css */`);
                }
                refuseIn(STYLESHEET_ENTRY, [line]);
                return line;
            }
            const includedPath = path.resolve(entryDirectory, includeMatch[1]);
            let includedText;
            try {
                includedText = readFile(includedPath);
            } catch (readError) {
                throw new Error(`${STYLESHEET_ENTRY}:${lineIndex + 1} includes ${includeMatch[1]}, which could not be read (${readError.message}). Fix the path, or add the file.`);
            }
            const includedLines = includedText.replace(/\n$/, '').split('\n');
            includedLines.forEach((includedLine, includedLineIndex) => {
                if (STYLESHEET_INCLUDE_LOOKALIKE_PATTERN.test(includedLine)) {
                    throw new Error(`${nameOf(includedPath)}:${includedLineIndex + 1} holds an include line inside an included file. Include each file from ${STYLESHEET_ENTRY}, where its rules belong in the cascade.`);
                }
            });
            refuseIn(nameOf(includedPath), includedLines);
            return includedLines.join('\n');
        }).join('\n');

        return stylesheet;

    }

    // A TEMPLATE LITERAL, NOT JSON, SO THE GENERATED FILE DIFFS LINE BY LINE IN A PR
    static toTemplateLiteralBody(script) {

        return script.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

    }

    static buildGeneratedFileText(script) {

        return [
            `// GENERATED by esbuild.panel.js from ${PANEL_ENTRY_POINT} -- never edit by hand.`,
            `// Change the panel modules, then run: ${REGENERATE_COMMAND}`,
            `export const ${PANEL_BUNDLE_CONSTANT} = \`${this.toTemplateLiteralBody(script)}\`;`,
            ''
        ].join('\n');

    }

    static buildGeneratedStylesheetFileText(stylesheet) {

        return [
            `// GENERATED by esbuild.panel.js from ${STYLESHEET_ENTRY} and the files it includes -- never edit by hand.`,
            `// Change the .css files, then run: ${REGENERATE_COMMAND}`,
            `export const ${STYLESHEET_CONSTANT} = \`${this.toTemplateLiteralBody(stylesheet)}\`;`,
            ''
        ].join('\n');

    }

    static async run(consoleOutput = console) {

        try {
            // BOTH ARE BUILT BEFORE EITHER IS WRITTEN, SO A REFUSED ONE LEAVES BOTH COMMITTED FILES AS THEY WERE
            const generatedFileText = this.buildGeneratedFileText(await this.buildScript());
            const generatedStylesheetFileText = this.buildGeneratedStylesheetFileText(this.buildStylesheet());
            fs.writeFileSync(path.resolve(__dirname, PANEL_BUNDLE_FILE), generatedFileText);
            fs.writeFileSync(path.resolve(__dirname, STYLESHEET_FILE), generatedStylesheetFileText);
            consoleOutput.log(`Bundled ${PANEL_ENTRY_POINT} to ${PANEL_BUNDLE_FILE}.`);
            consoleOutput.log(`Wrote ${STYLESHEET_ENTRY} to ${STYLESHEET_FILE}.`);
            return 0;
        } catch (error) {
            consoleOutput.error(`Bundling the panel failed: ${error.message}`);
            return 1;
        }

    }

}

module.exports = { PanelBundler, PANEL_ENTRY_POINT, PANEL_BUNDLE_FILE, PANEL_BUNDLE_CONSTANT, STYLESHEET_ENTRY, STYLESHEET_FILE, STYLESHEET_CONSTANT, REGENERATE_COMMAND };

// THE COMMAND-LINE ENTRY ONLY: JEST REQUIRES THIS FILE, SO run() IS TESTED DIRECTLY IN esbuild.panel.test.js
/* istanbul ignore next */
if (require.main === module) {
    PanelBundler.run().then(exitCode => process.exit(exitCode));
}
