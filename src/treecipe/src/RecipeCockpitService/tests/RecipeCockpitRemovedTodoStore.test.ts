import * as matchers from 'jest-extended';
expect.extend(matchers);

import { RecipeCockpitRemovedTodoStore, RECIPE_COCKPIT_REMOVED_TODO_FILE_VERSION } from '../RecipeCockpitRemovedTodoStore';
import { IRemovedTodoComment } from '../RecipeCockpitRecipeWriter';

const LINE_TODO: IRemovedTodoComment = {
    objectApiName: 'Account',
    objectNickname: 'Account_NickName',
    fieldApiName: 'Name',
    lineNumber: 6,
    todoText: '# TODO under Name',
    originalLine: '        # TODO under Name',
    kind: 'line',
    lineEnding: '\n',
    previousLine: '    Name: ${{ faker.company.name() }}',
    nextTodoLines: ['        # TODO and another']
};

const TRAILING_TODO: IRemovedTodoComment = {
    objectApiName: 'Account',
    fieldApiName: 'Phone',
    lineNumber: 7,
    todoText: '# TODO a real number',
    originalLine: '    Phone: ${{ faker.phone.number() }} # TODO a real number',
    kind: 'trailing',
    cutLine: '    Phone: ${{ faker.phone.number() }}'
};

const OBJECT_TODO: IRemovedTodoComment = {
    objectApiName: 'Contact',
    lineNumber: 20,
    todoText: '### TODO -- the reader\'s note',
    originalLine: '    ### TODO -- the reader\'s note',
    kind: 'line',
    lineEnding: '\r\n',
    previousLine: '    LastName: ${{ faker.person.lastName() }}',
    previousTodoLines: ['    # TODO above it']
};

function fileWith(todos: unknown[]): string {
    return JSON.stringify({ version: RECIPE_COCKPIT_REMOVED_TODO_FILE_VERSION, todos: todos });
}

describe('RecipeCockpitRemovedTodoStore (#391)', () => {

    test('names the file beside the recipe', () => {
        expect(RecipeCockpitRemovedTodoStore.buildFilePath('/w/treecipe/GeneratedRecipes/run/tree/recipe-tree.yml')).toBe('/w/treecipe/GeneratedRecipes/run/tree/recipe-tree.removedTodos.json');
        expect(RecipeCockpitRemovedTodoStore.buildFilePath('/w/recipe.YAML')).toBe('/w/recipe.removedTodos.json');
    });

    test('reads back what it writes, in one order whatever order it was given', () => {

        const written = RecipeCockpitRemovedTodoStore.serialize([OBJECT_TODO, TRAILING_TODO, LINE_TODO]);

        expect(RecipeCockpitRemovedTodoStore.serialize([LINE_TODO, OBJECT_TODO, TRAILING_TODO])).toBe(written);
        expect(written.endsWith('\n')).toBe(true);
        expect(RecipeCockpitRemovedTodoStore.parse(written)).toEqual({ entries: [TRAILING_TODO, LINE_TODO, OBJECT_TODO], isUnreadable: false });

    });

    test('orders entries of one object and field by line, then by text', () => {

        const first = { ...TRAILING_TODO, objectNickname: undefined as string | undefined };
        delete first.objectNickname;
        const sameLine = { ...TRAILING_TODO, todoText: '# TODO z', originalLine: '    Phone: ${{ faker.phone.number() }} # TODO z' };
        const earlier = { ...TRAILING_TODO, lineNumber: 3 };

        expect(RecipeCockpitRemovedTodoStore.parse(RecipeCockpitRemovedTodoStore.serialize([sameLine, TRAILING_TODO, earlier])).entries).toEqual([earlier, TRAILING_TODO, sameLine]);

    });

    test('no file is no entries, and a file that is not one is unreadable', () => {
        expect(RecipeCockpitRemovedTodoStore.parse(undefined)).toEqual({ entries: [], isUnreadable: false });
        expect(RecipeCockpitRemovedTodoStore.parse('{ not json').isUnreadable).toBe(true);
        expect(RecipeCockpitRemovedTodoStore.parse(JSON.stringify({ version: 2, todos: [] })).isUnreadable).toBe(true);
        expect(RecipeCockpitRemovedTodoStore.parse(JSON.stringify({ version: 1, todos: {} })).isUnreadable).toBe(true);
        expect(RecipeCockpitRemovedTodoStore.parse('[]').isUnreadable).toBe(true);
    });

    test.each([
        ['an object that is not an api name', { objectApiName: 'Account\n- object: Evil' }],
        ['a field that is not an api name', { fieldApiName: '__proto__' }],
        ['a nickname with a line break', { objectNickname: 'Nick\u2028Name' }],
        ['a line number that is not one', { lineNumber: 0 }],
        ['a kind it does not write', { kind: 'block' }],
        ['an original line with a line break', { originalLine: '        # TODO under Name\r- object: Evil' }],
        ['an original line that is not its TODO', { originalLine: '    Evil: ${{ 1 }}' }],
        ['a previous line that is a TODO line', { previousLine: '        # TODO not an anchor' }],
        ['next TODO lines that are not a list', { nextTodoLines: '        # TODO and another' }],
        ['next TODO lines that are not TODO lines', { nextTodoLines: ['    Evil: ${{ 1 }}'] }],
        ['a line ending that is not one', { lineEnding: '\u2028' }]
    ])('drops an entry with %s and keeps the rest', (_label, override) => {

        const read = RecipeCockpitRemovedTodoStore.parse(fileWith([{ ...LINE_TODO, ...override }, TRAILING_TODO]));

        expect(read).toEqual({ entries: [TRAILING_TODO], isUnreadable: false });

    });

    test('drops a trailing entry whose cut line is not its line cut', () => {
        expect(RecipeCockpitRemovedTodoStore.parse(fileWith([{ ...TRAILING_TODO, cutLine: '    Phone: other' }])).entries).toEqual([]);
    });

    test('keeps one of two equal entries, and adds and removes by what an entry says', () => {

        expect(RecipeCockpitRemovedTodoStore.parse(fileWith([LINE_TODO, LINE_TODO])).entries).toEqual([LINE_TODO]);

        const added = RecipeCockpitRemovedTodoStore.addEntry([LINE_TODO], { ...TRAILING_TODO });
        expect(RecipeCockpitRemovedTodoStore.addEntry(added, { ...TRAILING_TODO })).toHaveLength(2);
        expect(RecipeCockpitRemovedTodoStore.removeEntry(added, { ...LINE_TODO })).toEqual([TRAILING_TODO]);
        expect(RecipeCockpitRemovedTodoStore.isSameEntry(LINE_TODO, { ...LINE_TODO })).toBe(true);
        expect(RecipeCockpitRemovedTodoStore.isSameEntry(LINE_TODO, OBJECT_TODO)).toBe(false);

    });

});
