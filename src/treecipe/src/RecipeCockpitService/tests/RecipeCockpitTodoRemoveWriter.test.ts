import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

import * as os from 'os';

jest.mock('vscode', () => ({}), { virtual: true });

import { RecipeCockpitRecipeWriter, IRemovedTodoComment, RecipeTodoRemoveResult, RecipeTodoRestoreResult } from '../RecipeCockpitRecipeWriter';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';

/*
    Removing and restoring one TODO comment (#391). The generated fixtures carry almost no TODO a
    reader may remove -- a lookup's TODO is its value, a record type section's is read back -- so
    each test adds the kinds a reader writes or a later generation step adds: a TODO line under a
    field, a TODO at field depth on the object, and a TODO after a value.
*/
const RECIPE_WRITER_MOCKS_PATH = path.join(__dirname, 'mocks', 'recipeWriter');

const FIXTURES: ReadonlyArray<[string, string]> = [
    ['snowfakery', 'recipe-snowfakery--RelationshipTree_1.yml'],
    ['faker-js', 'recipe-fakerjs--RelationshipTree_1.yml'],
    ['faker-js nested', 'recipe-fakerjs-nested--RelationshipTree_1.yml'],
    ['faker-js self-lookup friends', 'recipe-fakerjs-selfLookupFriends--RelationshipTree_1.yml']
];

const LINE_ENDING_VARIANTS: ReadonlyArray<[string, string, boolean]> = [
    ['LF with a final newline', '\n', true],
    ['LF without a final newline', '\n', false],
    ['CRLF with a final newline', '\r\n', true],
    ['CRLF without a final newline', '\r\n', false]
];

function readFixture(fileName: string): string {
    return fs.readFileSync(path.join(RECIPE_WRITER_MOCKS_PATH, fileName), 'utf-8');
}

function toVariant(recipeText: string, lineEnding: string, hasFinalNewline: boolean): string {
    const withoutFinalNewlines = recipeText.replace(/\r\n/g, '\n').replace(/\n+$/, '');
    return `${withoutFinalNewlines}${hasFinalNewline ? '\n' : ''}`.replace(/\n/g, lineEnding);
}

/*
    The recipe with TODOs added to the first occurrences: for each, a TODO line under its first
    one-line field with a value, the same field's value followed by a TODO, and a TODO at field
    depth after its last field. Lines are added from the bottom up so earlier indexes hold.
*/
function addReaderTodos(recipeText: string, occurrenceLimit = 3): string {

    const lineEnding = recipeText.includes('\r\n') ? '\r\n' : '\n';
    const recipeLines = RecipeCockpitRecipeWriter.splitRecipeLines(recipeText);
    const scannedObjects = RecipeCockpitRecipeWriter.scanRecipeObjects(recipeLines.lines).slice(0, occurrenceLimit);
    const insertions: { lineIndex: number; line: string }[] = [];
    const replacements = new Map<number, string>();

    scannedObjects.forEach((scannedObject, occurrenceIndex) => {
        const fieldIndent = ' '.repeat(scannedObject.objectIndent + 4);
        const plainField = scannedObject.fields.find(scannedField => (
            scannedField.endIndex - scannedField.startIndex === 1
            && /^\$\{\{.*\}\}$/.test(recipeLines.lines[scannedField.startIndex].slice(fieldIndent.length + scannedField.fieldApiName.length + 2))
        ));
        if ( plainField ) {
            replacements.set(plainField.startIndex, `${recipeLines.lines[plainField.startIndex]} # TODO check ${plainField.fieldApiName} ${occurrenceIndex}`);
            insertions.push({ lineIndex: plainField.endIndex, line: `${fieldIndent}    # TODO under ${plainField.fieldApiName} ${occurrenceIndex}` });
        }
        const lastField = scannedObject.fields[scannedObject.fields.length - 1];
        if ( lastField ) {
            insertions.push({ lineIndex: lastField.endIndex, line: `${fieldIndent}### TODO -- the reader's note on ${scannedObject.objectApiName} ${occurrenceIndex}` });
        }
    });

    const lines = recipeLines.lines.map((line, lineIndex) => replacements.get(lineIndex) ?? line);
    const lineEndings = recipeLines.lineEndings.slice();
    insertions.sort((first, second) => second.lineIndex - first.lineIndex).forEach(insertion => {
        lines.splice(insertion.lineIndex, 0, insertion.line);
        lineEndings.splice(insertion.lineIndex, 0, lineEnding);
    });

    return RecipeCockpitRecipeWriter.joinRecipeLines({ lines: lines, lineEndings: lineEndings });

}

// EVERY TODO OF THE RECIPE A READER ADDED, BY LINE: THE GENERATED ONES ARE LOCKED OR ARE NOT THE TEST'S
function listReaderTodoLines(recipeText: string): { lineNumber: number; todoText: string }[] {
    return RecipeCockpitRecipeWriter.splitRecipeLines(recipeText).lines
        .map((line, lineIndex) => ({ lineNumber: lineIndex + 1, todoText: RecipeCockpitRecipeWriter.readTodoCommentText(line) }))
        .filter(todo => todo.todoText !== undefined && /TODO (check|under)|reader's note/.test(todo.todoText));
}

function expectRemoved(result: RecipeTodoRemoveResult): { recipeText: string; removed: IRemovedTodoComment } {
    if ( 'refusal' in result ) {
        throw new Error(`refused: ${result.refusal.reason} ${result.refusal.message}`);
    }
    return result;
}

function expectRestored(result: RecipeTodoRestoreResult): string {
    if ( 'refusal' in result ) {
        throw new Error(`refused: ${result.refusal.reason} ${result.refusal.message}`);
    }
    return result.recipeText;
}

function refusalReason(result: RecipeTodoRemoveResult | RecipeTodoRestoreResult): string | undefined {
    return 'refusal' in result ? result.refusal.reason : undefined;
}

describe('RecipeCockpitRecipeWriter removeTodoComment and restoreTodoComment (#391)', () => {

    describe.each(FIXTURES)('%s fixture', (_backendLabel, fixtureFileName) => {

        test.each(LINE_ENDING_VARIANTS)('removes and restores each TODO a reader added, byte for byte (%s)', (_variantLabel, lineEnding, hasFinalNewline) => {

            const recipeText = addReaderTodos(toVariant(readFixture(fixtureFileName), lineEnding, hasFinalNewline));
            const readerTodos = listReaderTodoLines(recipeText);
            expect(readerTodos.length).toBeGreaterThanOrEqual(3);

            readerTodos.forEach(todo => {

                const { recipeText: removedText, removed } = expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(recipeText, todo));

                const originalLines = RecipeCockpitRecipeWriter.splitRecipeLines(recipeText).lines;
                const removedLines = RecipeCockpitRecipeWriter.splitRecipeLines(removedText).lines;
                if ( removed.kind === 'line' ) {
                    expect(removedLines).toEqual(originalLines.filter((_line, lineIndex) => lineIndex !== todo.lineNumber - 1));
                } else {
                    expect(removedLines[todo.lineNumber - 1]).toBe(originalLines[todo.lineNumber - 1].replace(/ # TODO.*$/, ''));
                    expect(removedLines.filter((_line, lineIndex) => lineIndex !== todo.lineNumber - 1)).toEqual(originalLines.filter((_line, lineIndex) => lineIndex !== todo.lineNumber - 1));
                }
                expect(removedText.endsWith(lineEnding)).toBe(hasFinalNewline);
                expect(() => yaml.load(removedText)).not.toThrow();

                expect(expectRestored(RecipeCockpitRecipeWriter.restoreTodoComment(removedText, removed))).toBe(recipeText);

            });

        });

    });

    // EVERY READER TODO OUT AT ONCE, REMOVED FROM THE BOTTOM UP SO EACH LINE NUMBER STILL HOLDS
    const removeEveryReaderTodo = (recipeText: string): string => listReaderTodoLines(recipeText)
        .reverse()
        .reduce((text, todo) => expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(text, todo)).recipeText, recipeText);

    test('a faker-js recipe with its TODOs removed still generates, through the real recipe processor', async () => {

        const generatedText = [
            '- object: Account',
            '  nickname: Account_NickName',
            '  count: 2',
            '  fields:',
            '    Name: ${{ faker.company.name() }}',
            '    Description: ${{ faker.lorem.sentence() }}',
            '  friends:',
            '    - object: Contact',
            '      nickname: Contact_Account_NickName',
            '      count: 2',
            '      fields:',
            '        LastName: ${{ faker.person.lastName() }}',
            '        AccountId: Account_NickName',
            ''
        ].join('\n');
        const recipeText = removeEveryReaderTodo(addReaderTodos(generatedText));
        expect(recipeText).toBe(generatedText);
        const temporaryFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'removed-todos-'));

        try {
            const recipeFilePath = path.join(temporaryFolderPath, 'recipe.yml');
            fs.writeFileSync(recipeFilePath, addReaderTodos(generatedText));
            const withTodos = JSON.parse(await new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath)) as unknown[];
            fs.writeFileSync(recipeFilePath, recipeText);
            const withoutTodos = JSON.parse(await new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath)) as unknown[];
            expect(withoutTodos).toHaveLength(6);
            expect(withTodos).toHaveLength(6);
        } finally {
            fs.rmSync(temporaryFolderPath, { recursive: true, force: true });
        }

    });

    PythonTestHarness.testRequiringModules('yaml')('a snowfakery recipe with its TODOs removed still loads with PyYAML, as it did before', () => {

        const originalText = readFixture('recipe-snowfakery--RelationshipTree_1.yml');
        const loaded = PythonTestHarness.runPython([
            'import json, sys, yaml',
            'request = json.load(sys.stdin)',
            'print(json.dumps([yaml.safe_load(text) for text in request["texts"]]))'
        ].join('\n'), { texts: [originalText, removeEveryReaderTodo(addReaderTodos(originalText))] }) as unknown[];

        expect(loaded[1]).toEqual(loaded[0]);

    });

    test('records the occurrence, field and kind of each TODO', () => {

        const recipeText = [
            '- object: Account',
            '  nickname: Account_NickName',
            '  count: 1',
            '  fields:',
            '    Name: ${{ faker.company.name() }} # TODO pick a real name',
            '        # TODO under Name',
            '    Phone: ${{ faker.phone.number() }}',
            '    ### TODO -- the reader\'s note',
            ''
        ].join('\n');

        expect(expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(recipeText, { lineNumber: 5, todoText: '# TODO pick a real name' })).removed).toEqual({
            objectApiName: 'Account',
            objectNickname: 'Account_NickName',
            fieldApiName: 'Name',
            lineNumber: 5,
            todoText: '# TODO pick a real name',
            originalLine: '    Name: ${{ faker.company.name() }} # TODO pick a real name',
            kind: 'trailing',
            cutLine: '    Name: ${{ faker.company.name() }}'
        });
        expect(expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(recipeText, { lineNumber: 6, todoText: '# TODO under Name' })).removed).toEqual({
            objectApiName: 'Account',
            objectNickname: 'Account_NickName',
            fieldApiName: 'Name',
            lineNumber: 6,
            todoText: '# TODO under Name',
            originalLine: '        # TODO under Name',
            kind: 'line',
            lineEnding: '\n',
            previousLine: '    Name: ${{ faker.company.name() }} # TODO pick a real name'
        });
        const objectTodo = expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(recipeText, { lineNumber: 8, todoText: '### TODO -- the reader\'s note' }));
        expect(objectTodo.removed.fieldApiName).toBeUndefined();
        expect(objectTodo.recipeText).toBe(recipeText.replace('    ### TODO -- the reader\'s note\n', ''));

    });

    test('puts adjacent removed TODOs back in their order, whichever is restored first', () => {

        const recipeText = [
            '- object: Account',
            '  fields:',
            '    Name: ${{ faker.company.name() }}',
            '        # TODO first',
            '        # TODO second',
            '        # TODO third',
            '    Phone: ${{ faker.phone.number() }}',
            ''
        ].join('\n');

        const first = expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(recipeText, { lineNumber: 4, todoText: '# TODO first' }));
        const second = expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(first.recipeText, { lineNumber: 4, todoText: '# TODO second' }));
        const third = expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(second.recipeText, { lineNumber: 4, todoText: '# TODO third' }));
        const removedTodos = [first.removed, second.removed, third.removed];

        const restoreOrders = [[0, 1, 2], [2, 1, 0], [1, 0, 2], [1, 2, 0], [0, 2, 1], [2, 0, 1]];
        restoreOrders.forEach(restoreOrder => {
            const restoredText = restoreOrder.reduce((text, removedIndex) => expectRestored(RecipeCockpitRecipeWriter.restoreTodoComment(text, removedTodos[removedIndex], removedTodos)), third.recipeText);
            expect(restoredText).toBe(recipeText);
        });

        // REMOVED IN ANOTHER ORDER: THE MIDDLE ONE FIRST, SO THE LINE ABOVE IT WAS A TODO STILL THERE
        const middle = expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(recipeText, { lineNumber: 5, todoText: '# TODO second' }));
        const top = expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(middle.recipeText, { lineNumber: 4, todoText: '# TODO first' }));
        const bottom = expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(top.recipeText, { lineNumber: 4, todoText: '# TODO third' }));
        const otherRemovedTodos = [middle.removed, top.removed, bottom.removed];
        restoreOrders.forEach(restoreOrder => {
            const restoredText = restoreOrder.reduce((text, removedIndex) => expectRestored(RecipeCockpitRecipeWriter.restoreTodoComment(text, otherRemovedTodos[removedIndex], otherRemovedTodos)), bottom.recipeText);
            expect(restoredText).toBe(recipeText);
        });

    });

    test('removes the last line of a file with no final newline and puts it back the same', () => {

        const recipeText = '- object: Account\r\n  fields:\r\n    Name: ${{ faker.company.name() }}\r\n    # TODO last';
        const { recipeText: removedText, removed } = expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(recipeText, { lineNumber: 4, todoText: '# TODO last' }));

        expect(removedText).toBe('- object: Account\r\n  fields:\r\n    Name: ${{ faker.company.name() }}');
        expect(expectRestored(RecipeCockpitRecipeWriter.restoreTodoComment(removedText, removed))).toBe(recipeText);

    });

    test('a TODO in a friend is told apart by its occurrence and goes back there', () => {

        const recipeText = [
            '- object: Account',
            '  nickname: Account_NickName',
            '  fields:',
            '    Name: ${{ faker.company.name() }}',
            '  friends:',
            '    - object: Account',
            '      nickname: Account_child_NickName',
            '      fields:',
            '        Name: ${{ faker.company.name() }}',
            '            # TODO the child\'s name',
            ''
        ].join('\n');

        const { recipeText: removedText, removed } = expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(recipeText, { lineNumber: 10, todoText: '# TODO the child\'s name' }));

        expect(removed.objectNickname).toBe('Account_child_NickName');
        expect(removed.fieldApiName).toBe('Name');
        expect(expectRestored(RecipeCockpitRecipeWriter.restoreTodoComment(removedText, removed))).toBe(recipeText);

    });

    describe('refusals', () => {

        const recipeText = [
            '- object: Account',
            '  fields:',
            '    RecordTypeId: Account.One',
            '                    ### TODO: -- RecordType Options -- choose one',
            '                    # Account.Two',
            '    ParentId: ### TODO -- REFERENCE ID REQUIRED',
            '    Formula__c: ### TODO - Formula fields are calculated, not generated - remove this line',
            '    Name: ${{ faker.company.name() }}',
            '        # TODO under Name',
            ''
        ].join('\n');

        test.each([
            ['a lookup\'s TODO value', 6, '### TODO -- REFERENCE ID REQUIRED', 'field-value'],
            ['a formula\'s TODO value', 7, '### TODO - Formula fields are calculated, not generated - remove this line', 'field-value'],
            ['a record type section\'s TODO', 4, '### TODO: -- RecordType Options -- choose one', 'record-type-options']
        ])('refuses %s and names the lock', (_label, lineNumber, todoText, removeLock) => {

            const scannedObject = RecipeCockpitRecipeWriter.scanRecipeObjects(RecipeCockpitRecipeWriter.splitRecipeLines(recipeText).lines)[0];
            expect(RecipeCockpitRecipeWriter.findTodoRemoveLock(RecipeCockpitRecipeWriter.splitRecipeLines(recipeText).lines, scannedObject, lineNumber - 1)).toBe(removeLock);

            const result = RecipeCockpitRecipeWriter.removeTodoComment(recipeText, { lineNumber: lineNumber, todoText: todoText });
            expect(result.isRemoved).toBe(false);
            expect(refusalReason(result)).toBe('todo-not-removable');

        });

        test('refuses the cockpit\'s commented-out field marker', () => {

            const commented = RecipeCockpitRecipeWriter.commentOutField(recipeText, 'Account', 'Name', 'not needed');
            if ( !('recipeText' in commented) ) { throw new Error('not commented out'); }
            const lines = RecipeCockpitRecipeWriter.splitRecipeLines(commented.recipeText).lines;
            const markerIndex = lines.findIndex(line => line.includes('FIELD COMMENTED OUT'));
            const scannedObject = RecipeCockpitRecipeWriter.scanRecipeObjects(lines)[0];

            expect(RecipeCockpitRecipeWriter.findTodoRemoveLock(lines, scannedObject, markerIndex)).toBe('commented-out-marker');
            const result = RecipeCockpitRecipeWriter.removeTodoComment(commented.recipeText, { lineNumber: markerIndex + 1, todoText: RecipeCockpitRecipeWriter.readTodoCommentText(lines[markerIndex]) });
            expect(refusalReason(result)).toBe('todo-not-removable');

        });

        test.each([
            ['a line the recipe does not have', 99, '# TODO under Name', 'todo-not-found'],
            ['a line with no TODO', 8, '# TODO under Name', 'todo-not-found'],
            ['a TODO edited since it was drawn', 9, '# TODO under Name, edited', 'todo-changed']
        ])('refuses %s', (_label, lineNumber, todoText, reason) => {
            const result = RecipeCockpitRecipeWriter.removeTodoComment(recipeText, { lineNumber: lineNumber, todoText: todoText });
            expect(refusalReason(result)).toBe(reason);
        });

        test('refuses a TODO of an object written twice with no nickname telling them apart', () => {

            const twiceText = [
                '- object: Account',
                '  fields:',
                '    Name: ${{ faker.company.name() }}',
                '        # TODO which Account',
                '- object: Account',
                '  fields:',
                '    Name: ${{ faker.company.name() }}',
                ''
            ].join('\n');

            const result = RecipeCockpitRecipeWriter.removeTodoComment(twiceText, { lineNumber: 4, todoText: '# TODO which Account' });
            expect(refusalReason(result)).toBe('indistinct-todo-occurrence');

        });

        test('refuses a TODO above every object, and one carrying a line break only PyYAML sees', () => {

            const topText = '# TODO before anything\n- object: Account\n  fields:\n    Name: ${{ faker.company.name() }}\n        # TODO a\rb\n';

            expect(refusalReason(RecipeCockpitRecipeWriter.removeTodoComment(topText, { lineNumber: 1, todoText: '# TODO before anything' }))).toBe('todo-not-found');
            const brokenLine = RecipeCockpitRecipeWriter.removeTodoComment(topText, { lineNumber: 5, todoText: '# TODO a\rb' });
            expect(refusalReason(brokenLine)).toBe('todo-not-removable');
            expect('refusal' in brokenLine && brokenLine.refusal.message).toBe(RecipeCockpitRecipeWriter.describeTodoRemoveLock(undefined));

        });

        test('removes a TODO beside a commented-out field and leaves the field restorable', () => {

            const commented = RecipeCockpitRecipeWriter.commentOutField(recipeText, 'Account', 'Formula__c', 'not needed');
            if ( !('recipeText' in commented) ) { throw new Error('not commented out'); }
            const lines = RecipeCockpitRecipeWriter.splitRecipeLines(commented.recipeText).lines;
            const todoIndex = lines.indexOf('        # TODO under Name');

            const { recipeText: removedText, removed } = expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(commented.recipeText, { lineNumber: todoIndex + 1, todoText: '# TODO under Name' }));
            expect('recipeText' in RecipeCockpitRecipeWriter.restoreCommentedOutField(removedText, 'Account', 'Formula__c')).toBe(true);
            expect(expectRestored(RecipeCockpitRecipeWriter.restoreTodoComment(removedText, removed))).toBe(commented.recipeText);

        });

        test.each([
            ['a | block', '    Description: |\n        some text\n        # TODO inside the block\n'],
            ['a > block', '    Description: >-\n        some text\n        # TODO inside the block\n'],
            ['an unclosed double-quoted value', '    Description: "some text\n        # TODO inside the quotes"\n'],
            ['an unclosed single-quoted value', "    Description: 'it''s\n        # TODO inside the quotes'\n"]
        ])('refuses a "TODO" line inside %s, which YAML reads as part of the value', (_label, fieldText) => {

            const blockText = `- object: Account\n  fields:\n${fieldText}    Phone: \${{ faker.phone.number() }}\n`;
            const lines = RecipeCockpitRecipeWriter.splitRecipeLines(blockText).lines;
            const todoIndex = lines.findIndex(line => line.includes('# TODO inside'));
            const scannedObject = RecipeCockpitRecipeWriter.scanRecipeObjects(lines)[0];

            expect(RecipeCockpitRecipeWriter.findTodoRemoveLock(lines, scannedObject, todoIndex)).toBe('scalar-content');
            const todoText = RecipeCockpitRecipeWriter.readTodoCommentText(lines[todoIndex]);
            if ( todoText !== undefined ) {
                expect(refusalReason(RecipeCockpitRecipeWriter.removeTodoComment(blockText, { lineNumber: todoIndex + 1, todoText: todoText }))).toBe('todo-not-removable');
            }

        });

        test('takes a TODO under a closed quoted value, and the lock agrees with what a caller hands in', () => {

            const quotedText = '- object: Account\n  fields:\n    Name: "Acme # not a comment"\n        # TODO under a closed quote\n';
            const lines = RecipeCockpitRecipeWriter.splitRecipeLines(quotedText).lines;
            const scannedObject = RecipeCockpitRecipeWriter.scanRecipeObjects(lines)[0];

            expect(RecipeCockpitRecipeWriter.findTodoRemoveLock(lines, scannedObject, 3)).toBeUndefined();
            expect(RecipeCockpitRecipeWriter.findTodoRemoveLock(lines, scannedObject, 3, { fieldStartingAtLine: null, owningField: scannedObject.fields[0], markerStartIndexes: new Set() })).toBeUndefined();
            expect(refusalReason(RecipeCockpitRecipeWriter.removeTodoComment(quotedText, { lineNumber: 4, todoText: '# TODO under a closed quote' }))).toBeUndefined();

        });

        test('refuses a removal that changes how the lines around it read', () => {

            const fieldsLineText = '- object: Account\n  fields: # TODO list them\n    Name: ${{ faker.company.name() }}\n';
            const ownerTodo = { lineNumber: 2, todoText: '# TODO list them' };

            const result = RecipeCockpitRecipeWriter.removeTodoComment(fieldsLineText, ownerTodo);
            expect(refusalReason(result)).toBe('todo-structure-changed');

        });

    });

    describe('restore refusals', () => {

        const recipeText = [
            '- object: Account',
            '  nickname: Account_NickName',
            '  fields:',
            '    Name: ${{ faker.company.name() }} # TODO pick a real name',
            '        # TODO under Name',
            '    Phone: ${{ faker.phone.number() }}',
            ''
        ].join('\n');

        test('a TODO already back is refused, and reads as back', () => {

            const { recipeText: removedText, removed } = expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(recipeText, { lineNumber: 5, todoText: '# TODO under Name' }));
            const restoredText = expectRestored(RecipeCockpitRecipeWriter.restoreTodoComment(removedText, removed));
            const restoredLines = RecipeCockpitRecipeWriter.splitRecipeLines(restoredText).lines;

            expect(RecipeCockpitRecipeWriter.isRemovedTodoBack(restoredLines, RecipeCockpitRecipeWriter.scanRecipeObjects(restoredLines), removed)).toBe(true);
            const removedLines = RecipeCockpitRecipeWriter.splitRecipeLines(removedText).lines;
            expect(RecipeCockpitRecipeWriter.isRemovedTodoBack(removedLines, RecipeCockpitRecipeWriter.scanRecipeObjects(removedLines), removed)).toBe(false);

            const again = RecipeCockpitRecipeWriter.restoreTodoComment(restoredText, removed);
            expect(refusalReason(again)).toBe('todo-already-back');

        });

        test('a trailing TODO back on its line reads as back', () => {

            const { recipeText: removedText, removed } = expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(recipeText, { lineNumber: 4, todoText: '# TODO pick a real name' }));
            const again = RecipeCockpitRecipeWriter.restoreTodoComment(expectRestored(RecipeCockpitRecipeWriter.restoreTodoComment(removedText, removed)), removed);

            expect(refusalReason(again)).toBe('todo-already-back');

        });

        test.each([
            ['the line it stood under was edited', (text: string) => text.replace('# TODO pick a real name', '# TODO pick another'), 5, '# TODO under Name', 'todo-place-not-found'],
            ['the line it was cut from was edited', (text: string) => text.replace('faker.company.name()', 'faker.company.buzzNoun()'), 4, '# TODO pick a real name', 'todo-place-not-found'],
            ['the field is gone', (text: string) => text.replace(/ {4}Name:[^\n]*\n( {8}[^\n]*\n)?/, ''), 5, '# TODO under Name', 'todo-owner-not-found'],
            ['the occurrence is gone', (text: string) => text.replace('Account_NickName', 'Account_Renamed'), 5, '# TODO under Name', 'todo-owner-not-found']
        ])('refuses when %s', (_label, editRecipe, lineNumber, todoText, reason) => {

            const { recipeText: removedText, removed } = expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(recipeText, { lineNumber: lineNumber, todoText: todoText }));
            const result = RecipeCockpitRecipeWriter.restoreTodoComment(editRecipe(removedText), removed);

            expect(refusalReason(result)).toBe(reason);

        });

        test.each([
            ['a line', { kind: 'line' as const, lineNumber: 5, todoText: '# TODO evil ${{ 1 }}', originalLine: '        # TODO evil ${{ 1 }}', lineEnding: '\n', previousLine: '        hello there' }],
            ['a trailing comment', { kind: 'trailing' as const, lineNumber: 4, todoText: '# TODO evil ${{ 1 }}', originalLine: '        hello there # TODO evil ${{ 1 }}', cutLine: '        hello there' }]
        ])('refuses to put %s back inside a block value, where it would be value text', (_label, override) => {

            const blockText = '- object: Account\n  fields:\n    Description: |\n        hello there\n    Phone: x\n';
            const result = RecipeCockpitRecipeWriter.restoreTodoComment(blockText, { objectApiName: 'Account', fieldApiName: 'Description', ...override });

            expect(refusalReason(result)).toBe('todo-not-removable');

        });

        test('refuses a TODO line that would end the field it is put back in', () => {

            const blockText = '- object: Account\n  fields:\n    Description: some\n        more text\n    Phone: ${{ faker.phone.number() }}\n';
            const result = RecipeCockpitRecipeWriter.restoreTodoComment(blockText, {
                objectApiName: 'Account',
                fieldApiName: 'Description',
                lineNumber: 4,
                todoText: '# TODO at field depth',
                originalLine: '    # TODO at field depth',
                kind: 'line',
                lineEnding: '\n',
                previousLine: '    Description: some'
            });

            expect(refusalReason(result)).toBe('todo-structure-changed');

        });

        test.each([
            ['a line break in the line', { originalLine: '        # TODO under Name\u2028- object: Evil' }],
            ['text that is not its TODO', { todoText: '# TODO something else' }],
            ['a line that is not a comment', { originalLine: '    Evil: ${{ 1 }}' }],
            ['an ending that is not a line ending', { lineEnding: '' }]
        ])('refuses a removed TODO with %s', (_label, override) => {

            const { recipeText: removedText, removed } = expectRemoved(RecipeCockpitRecipeWriter.removeTodoComment(recipeText, { lineNumber: 5, todoText: '# TODO under Name' }));
            const result = RecipeCockpitRecipeWriter.restoreTodoComment(removedText, { ...removed, ...override });

            expect(refusalReason(result)).toBe('invalid-value');

        });

    });

});
