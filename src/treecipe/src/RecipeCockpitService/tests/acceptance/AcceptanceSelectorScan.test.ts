import * as fs from 'fs';
import * as path from 'path';

/*
    A journey finds what it acts on as a reader does, by role and name (#577), so a markup change that
    keeps what the reader sees keeps every journey passing. This scan fails on any way of finding an
    element by class or id in tests/acceptance/. The patterns are built from pieces so this file does
    not match itself.
*/
const FORBIDDEN_LOOKUPS: ReadonlyArray<{ lookup: string; pattern: RegExp }> = [
    { lookup: 'class' + 'Name', pattern: new RegExp('\\bclass' + 'Name\\b') },
    { lookup: 'class' + 'List', pattern: new RegExp('\\bclass' + 'List\\b') },
    { lookup: '.getElement' + 'ById', pattern: new RegExp('\\.getElement' + 'ById\\b') },
    { lookup: 'querySelector with a class or id selector', pattern: new RegExp('query' + 'Selector(?:All)?\\s*\\(\\s*[\'"`][^\'"`]*[.#]') }
];

export function findForbiddenLookups(fileText: string): string[] {
    return fileText.split('\n').flatMap((lineText, lineIndex) => FORBIDDEN_LOOKUPS
        .filter(forbiddenLookup => forbiddenLookup.pattern.test(lineText))
        .map(forbiddenLookup => `line ${lineIndex + 1}: ${forbiddenLookup.lookup}`));
}

describe('tests/acceptance/ finds no element by class or id (#577)', () => {

    const acceptanceFileNames = fs.readdirSync(__dirname).filter(fileName => fileName.endsWith('.ts'));

    test('scans the harness and every journey', () => {
        expect(acceptanceFileNames).toEqual(expect.arrayContaining(['RecipeCockpitJourney.ts', 'RecipeCockpitScreen.ts', 'FirstJourney.ts']));
    });

    test.each(acceptanceFileNames)('%s finds elements only by role and name', acceptanceFileName => {
        const offendingLines = findForbiddenLookups(fs.readFileSync(path.join(__dirname, acceptanceFileName), 'utf-8'));
        expect(offendingLines.map(offendingLine => `${acceptanceFileName} ${offendingLine}: find it on journey.screen() by its role and name instead.`)).toEqual([]);
    });

    test('catches each kind of lookup', () => {
        const seededText = [
            'element.class' + 'Name === "treeCard"',
            'element.class' + 'List.contains("hidden")',
            'document.getElement' + 'ById("runSelect")',
            'document.query' + 'Selector(".treeTab")',
            'document.query' + 'SelectorAll(\'#cockpitBody\')',
            'document.query' + 'Selector("button")'
        ].join('\n');
        expect(findForbiddenLookups(seededText)).toEqual([
            'line 1: class' + 'Name',
            'line 2: class' + 'List',
            'line 3: .getElement' + 'ById',
            'line 4: querySelector with a class or id selector',
            'line 5: querySelector with a class or id selector'
        ]);
    });

});
