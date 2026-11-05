import * as fs from 'fs';
import * as path from 'path';

/*
    A journey finds what it acts on as a reader does, by role and name (#577), so a markup change that
    keeps what the reader sees keeps every journey passing. This scan fails on any way of finding an
    element by class or id in tests/acceptance/. The patterns are built from pieces so this file does
    not match itself.
*/
const FORBIDDEN_LOOKUPS: ReadonlyArray<{ lookup: string; pattern: RegExp }> = [
    { lookup: 'class' + 'Name', pattern: new RegExp('class' + 'Name', 'i') },
    { lookup: 'class' + 'List', pattern: new RegExp('\\bclass' + 'List\\b') },
    { lookup: '.getElement' + 'ById', pattern: new RegExp('\\.getElement' + 'ById\\b') },
    { lookup: 'querySelector with a class, id or attribute selector', pattern: new RegExp('query' + 'Selector(?:All)?\\s*\\(\\s*[\'"`][^\'"`]*[.#\\[]') },
    { lookup: 'a class or id attribute read', pattern: new RegExp('attributes\\s*(?:\\.\\s*(?:class|id)\\b|\\[\\s*[\'"`](?:class|id)[\'"`])') }
];

/*
    The panel harness's page also hands out helpers that find elements by class (findAll, treeCards,
    isHidden...). A journey reaches the page only through the harness, and the harness takes from it
    only these: the page's roots, its message ports and isDisplayed, the one place a class is known.
*/
const PAGE_MEMBERS_A_JOURNEY_MAY_USE = new Set(['postedHostMessages', 'postToPanel', 'isDisplayed', 'cockpitMetaElement', 'loadStatusElement', 'cockpitBodyElement', 'cockpitDialogHostElement']);
// THE ACCESSIBLE-NAME COMPUTATION RESOLVES aria-labelledby AND <label for> BY id, AS A BROWSER DOES; NOTHING ELSE READS ONE
const FILES_THAT_RESOLVE_NAMES_BY_ID = new Set(['RecipeCockpitScreen.ts']);
const RUN_PANEL_SCRIPT_IMPORTER = 'RecipeCockpitJourney.ts';
const RUN_PANEL_SCRIPT = new RegExp('\\brun' + 'PanelScript\\b');

export function findForbiddenLookups(fileText: string, fileName = 'a journey'): string[] {
    return fileText.split('\n').flatMap((lineText, lineIndex) => [
        ...FORBIDDEN_LOOKUPS
            .filter(forbiddenLookup => forbiddenLookup.pattern.test(lineText))
            .filter(forbiddenLookup => !(forbiddenLookup.lookup === 'a class or id attribute read' && FILES_THAT_RESOLVE_NAMES_BY_ID.has(fileName) && !/attributes\s*(?:\.\s*class|\[\s*['"`]class)/.test(lineText)))
            .map(forbiddenLookup => forbiddenLookup.lookup),
        ...Array.from(lineText.matchAll(/\bpage\.(\w+)/g), memberMatch => memberMatch[1])
            .filter(memberName => !PAGE_MEMBERS_A_JOURNEY_MAY_USE.has(memberName))
            .map(memberName => `the panel page's ${memberName}`),
        ...( RUN_PANEL_SCRIPT.test(lineText) && fileName !== RUN_PANEL_SCRIPT_IMPORTER ? ['run' + 'PanelScript outside the harness'] : [] )
    ].map(forbiddenLookup => `line ${lineIndex + 1}: ${forbiddenLookup}`));
}

describe('tests/acceptance/ finds no element by class or id (#577)', () => {

    const acceptanceFileNames = fs.readdirSync(__dirname).filter(fileName => fileName.endsWith('.ts'));

    test('scans the harness and every journey', () => {
        expect(acceptanceFileNames).toEqual(expect.arrayContaining(['RecipeCockpitJourney.ts', 'RecipeCockpitScreen.ts', 'FirstJourney.ts']));
    });

    test.each(acceptanceFileNames)('%s finds elements only by role and name', acceptanceFileName => {
        const offendingLines = findForbiddenLookups(fs.readFileSync(path.join(__dirname, acceptanceFileName), 'utf-8'), acceptanceFileName);
        expect(offendingLines.map(offendingLine => `${acceptanceFileName} ${offendingLine}: find it on journey.screen() by its role and name instead.`)).toEqual([]);
    });

    test('catches each kind of lookup', () => {
        const seededText = [
            'element.class' + 'Name === "treeCard"',
            'element.class' + 'List.contains("hidden")',
            'document.getElement' + 'ById("runSelect")',
            'document.query' + 'Selector(".treeTab")',
            'document.query' + 'SelectorAll(\'#cockpitBody\')',
            'document.query' + 'Selector("button")',
            'document.getElementsByClass' + 'Name("treeTab")',
            'document.query' + 'Selector("[id=runSelect]")',
            'element.attributes.' + 'id === "runSelect"',
            'element.attributes["' + 'class"]',
            'pag' + 'e.findAll(pag' + 'e.cockpitBodyElement, "treeCard")',
            'import { run' + 'PanelScript } from "../RecipeCockpitPanelHarness";'
        ].join('\n');
        expect(findForbiddenLookups(seededText)).toEqual([
            'line 1: class' + 'Name',
            'line 2: class' + 'List',
            'line 3: .getElement' + 'ById',
            'line 4: querySelector with a class, id or attribute selector',
            'line 5: querySelector with a class, id or attribute selector',
            'line 7: class' + 'Name',
            'line 8: querySelector with a class, id or attribute selector',
            'line 9: a class or id attribute read',
            'line 10: a class or id attribute read',
            "line 11: the panel page's find" + 'All',
            'line 12: run' + 'PanelScript outside the harness'
        ]);
        // THE NAME COMPUTATION MAY READ AN id, NEVER A class
        expect(findForbiddenLookups('element.attributes.' + 'id', 'RecipeCockpitScreen.ts')).toEqual([]);
        expect(findForbiddenLookups('element.attributes.' + 'class', 'RecipeCockpitScreen.ts')).toEqual(['line 1: a class or id attribute read']);
    });

});
