import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

/*
    The hub stays the panel's lifecycle only (#671): its lifecycle, panel state and allow-lists,
    routePanelMessage and executePanelAction, run locks and confirmations. Shared work that grows in
    it again belongs in the module that owns it (DESIGN.md, "The hub is the panel's lifecycle").
*/
const COCKPIT_FOLDER = path.join(__dirname, '..');
const HUB_FILE_NAME = 'RecipeCockpitService.ts';

const HUB_BOUNDS = [
    {
        name: 'lines',
        limit: 5000,
        reason: '#671: a reader holds the whole hub in one read, and an agent loads it in one request',
        measure: (sourceText: string) => sourceText.split('\n').length
    },
    {
        name: 'import statements',
        // MEASURED WHEN #671 LANDED: THE ROUTER AND EXECUTOR LOAD 8 TAB HOSTS AND 3 OF THEIR FILES, AND THE LIFECYCLE ITS OWN NEEDS
        limit: 45,
        reason: '#671: a new import means shared work grew back into the hub; give it a module of its own, or raise this limit in the same change and say why',
        measure: (sourceText: string) => ts.createSourceFile(HUB_FILE_NAME, sourceText, ts.ScriptTarget.Latest, true)
            .statements.filter(statement => ts.isImportDeclaration(statement)).length
    }
];

// EVERY HOST-SIDE FILE: THE TAB HOSTS, THEIR HELPERS AND THE PANEL MODULES. THE GENERATED BUNDLE IS esbuild's, NOT A READER'S
const HOST_SIDE_MAX_LINES = 5000;

const listHostSideFiles = (folderPath: string): string[] => fs.readdirSync(folderPath, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(folderPath, entry.name);
    if ( entry.isDirectory() ) {
        return entry.name === 'tests' ? [] : listHostSideFiles(entryPath);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.generated.ts') ? [entryPath] : [];
});

describe('Recipe Cockpit hub bounds (#671)', () => {

    const hubSourceText = fs.readFileSync(path.join(COCKPIT_FOLDER, HUB_FILE_NAME), 'utf8');

    test.each(HUB_BOUNDS)('the hub stays within $limit $name ($reason)', ({ limit, measure }) => {
        expect(measure(hubSourceText)).toBeLessThanOrEqual(limit);
    });

    test(`no host-side file passes ${HOST_SIDE_MAX_LINES} lines`, () => {
        const overLimit = listHostSideFiles(COCKPIT_FOLDER)
            .map(filePath => ({ file: path.relative(COCKPIT_FOLDER, filePath), lines: fs.readFileSync(filePath, 'utf8').split('\n').length }))
            .filter(({ lines }) => lines > HOST_SIDE_MAX_LINES);
        expect(overLimit).toEqual([]);
    });

    test('reads the panel modules and the tab hosts, so the line limit covers every file a reader opens', () => {
        const relativePaths = listHostSideFiles(COCKPIT_FOLDER).map(filePath => path.relative(COCKPIT_FOLDER, filePath));
        expect(relativePaths).toEqual(expect.arrayContaining([HUB_FILE_NAME, 'RecipeCockpitQueryHost.ts', path.join('panel', 'RecipeCockpitPanelHost.ts')]));
        expect(relativePaths.filter(relativePath => relativePath.endsWith('.generated.ts'))).toEqual([]);
    });

});
