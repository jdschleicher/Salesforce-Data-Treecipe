import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

jest.mock('vscode', () => ({}), { virtual: true });

import { RecipeCockpitService } from '../RecipeCockpitService';
import { RecipeCockpitRecipeWriter, RecipeWriterResult, IRecipeWriterEdit, RecipeWriterRefusalReason } from '../RecipeCockpitRecipeWriter';

/*
    The fixtures are Generate Treecipe's own output for the DirectoryProcessingService mock
    metadata, one per backend, with one edit: the snowfakery Account's Description is a "|" block
    scalar. Snowfakery writes every value inline, and a recipe a person has edited is exactly what
    the writer is for.

    Picklist__c and MultiPicklist__c carry record-type variants as commented lines under their
    "### TODO"s -- continuation lines the writer carries as opaque, like any other.
*/
const RECIPE_WRITER_MOCKS_PATH = path.join(__dirname, 'mocks', 'recipeWriter');

const RECIPE_FIXTURES: ReadonlyArray<[string, string]> = [
    ['snowfakery', 'recipe-snowfakery--RelationshipTree_1.yml'],
    ['faker-js', 'recipe-fakerjs--RelationshipTree_1.yml']
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

// EACH LINE WITH ITS OWN TERMINATOR, SO A CHANGED LINE ENDING IS A CHANGED ELEMENT
function splitKeepingLineEndings(recipeText: string): string[] {
    return recipeText.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function stripLineEnding(recipeLine: string): string {
    return recipeLine.replace(/\r?\n$/, '');
}

function expectApplied(result: RecipeWriterResult): { recipeText: string; edit: IRecipeWriterEdit } {
    if ( 'refusal' in result ) {
        throw new Error(`expected the edit to apply, and it was refused: ${result.refusal.reason} -- ${result.refusal.message}`);
    }
    return result;
}

function expectRefused(result: RecipeWriterResult, expectedReason: RecipeWriterRefusalReason): void {
    expect(result.isApplied).toBe(false);
    if ( 'refusal' in result ) {
        expect(result.refusal.reason).toBe(expectedReason);
        expect(result.refusal.message).not.toBe('');
    }
}

/*
    Every line before the edit and every line after it is byte-identical, terminator included. The
    only exception is the one line ending an insert at the very end of a file with no final newline
    has to gain, so the new line is a line of its own.
*/
function expectFidelity(recipeText: string, patchedRecipeText: string, edit: IRecipeWriterEdit): void {

    const originalLines = splitKeepingLineEndings(recipeText);
    const patchedLines = splitKeepingLineEndings(patchedRecipeText);
    const startIndex = edit.startLineNumber - 1;
    const lineEnding = recipeText.includes('\r\n') ? '\r\n' : '\n';

    const originalPrefix = originalLines.slice(0, startIndex);
    const patchedPrefix = patchedLines.slice(0, startIndex);
    const isAppendedToUnterminatedLastLine = startIndex === originalLines.length && !/\n$/.test(recipeText);

    if ( isAppendedToUnterminatedLastLine ) {
        originalPrefix[originalPrefix.length - 1] += lineEnding;
    }

    // JOINED RATHER THAN COMPARED LINE BY LINE: A MATCHER PER LINE, PER FIELD, PER VARIANT IS MINUTES OF MATCHER OVERHEAD
    expect(patchedPrefix.join('')).toBe(originalPrefix.join(''));
    expect(patchedLines.slice(startIndex + edit.insertedLines.length).join('')).toBe(originalLines.slice(startIndex + edit.removedLines.length).join(''));

    expect(originalLines.slice(startIndex, startIndex + edit.removedLines.length).map(stripLineEnding)).toEqual(edit.removedLines);
    expect(patchedLines.slice(startIndex, startIndex + edit.insertedLines.length).map(stripLineEnding)).toEqual(edit.insertedLines);

    expect(patchedLines.slice(0, -1).filter(patchedLine => !patchedLine.endsWith(lineEnding))).toEqual([]);
    expect(/\n$/.test(patchedRecipeText)).toBe(/\n$/.test(recipeText));
    if ( lineEnding === '\n' ) {
        expect(patchedRecipeText).not.toContain('\r');
    }

}

type FieldExpectation = { isAbsent: true } | { isAbsent: false; valueText: string };

/*
    What parseRecipeSource reports after the edit: the same objects in the same order, the target
    field as intended, and every other field with the same value and the same line content --
    wherever the edit moved that line to.
*/
function expectRoundTrip(recipeText: string, patchedRecipeText: string, objectApiName: string, fieldApiName: string | undefined, fieldExpectation?: FieldExpectation): void {

    const originalEntries = RecipeCockpitService.parseRecipeSource(recipeText);
    const patchedEntries = RecipeCockpitService.parseRecipeSource(patchedRecipeText);
    const originalLines = recipeText.split(/\r?\n/);
    const patchedLines = patchedRecipeText.split(/\r?\n/);

    expect(Array.from(patchedEntries.keys())).toEqual(Array.from(originalEntries.keys()));

    // EACH OTHER LINE AS "WHERE IT IS: WHAT IT SAYS", SO A MOVED LINE STILL MATCHES AND A CHANGED ONE DOES NOT
    const describeLines = (entries: typeof originalEntries, lines: string[]): string[] => {
        const describedLines: string[] = [];
        entries.forEach((objectEntry, entryObjectApiName) => {
            describedLines.push(`${entryObjectApiName}: ${lines[objectEntry.lineNumber - 1]}`);
            objectEntry.fieldEntries.forEach((fieldEntry, entryFieldApiName) => {
                if ( entryObjectApiName !== objectApiName || entryFieldApiName !== fieldApiName ) {
                    describedLines.push(`${entryObjectApiName}.${entryFieldApiName}: ${lines[fieldEntry.lineNumber - 1]} => ${fieldEntry.valueText}`);
                }
            });
        });
        return describedLines;
    };

    expect(describeLines(patchedEntries, patchedLines).join('\n')).toBe(describeLines(originalEntries, originalLines).join('\n'));

    if ( fieldApiName === undefined || fieldExpectation === undefined ) {
        return;
    }

    const targetFieldEntry = patchedEntries.get(objectApiName).fieldEntries.get(fieldApiName);

    if ( !('valueText' in fieldExpectation) ) {
        expect(targetFieldEntry).toBeUndefined();
        return;
    }

    expect(targetFieldEntry.valueText).toBe(fieldExpectation.valueText);

    const otherFieldCount = Array.from(originalEntries.get(objectApiName).fieldEntries.keys()).filter(originalFieldApiName => originalFieldApiName !== fieldApiName).length;
    expect(patchedEntries.get(objectApiName).fieldEntries.size).toBe(otherFieldCount + 1);

}

function collectFieldAddresses(recipeText: string): Array<[string, string]> {
    const fieldAddresses: Array<[string, string]> = [];
    RecipeCockpitService.parseRecipeSource(recipeText).forEach((objectEntry, objectApiName) => {
        objectEntry.fieldEntries.forEach((unusedFieldEntry, fieldApiName) => fieldAddresses.push([objectApiName, fieldApiName]));
    });
    return fieldAddresses;
}

const SINGLE_LINE_VALUE = "${{ random_choice('Alpha', 'Beta') }}";
const BLOCK_SCALAR_VALUE = '|\n                ${{fake.word}}';
const DEPENDENT_PICKLIST_VALUE = "\n      if:\n        - choice:\n            when: ${{ Industry == 'Retail' }}\n            pick: Shop";

describe('RecipeCockpitRecipeWriter', () => {

    describe('isolation', () => {

        test('the module imports nothing, so it cannot reach the disk, a webview, vscode or an org', () => {

            const moduleSource = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitRecipeWriter.ts'), 'utf-8');

            expect(moduleSource).not.toMatch(/^\s*import\s/m);
            expect(moduleSource).not.toMatch(/\brequire\s*\(/);

        });

        test('every method on the class is static', () => {

            expect(Object.getOwnPropertyNames(RecipeCockpitRecipeWriter.prototype)).toEqual(['constructor']);

        });

    });

    describe('the fixtures', () => {

        test.each(RECIPE_FIXTURES)('the %s fixture carries every construct the writer has to leave alone, and loads as YAML', (unusedBackend, fileName) => {

            const recipeText = readFixture(fileName);

            expect(recipeText).toMatch(/^# Relationship Tree: /m);
            expect(recipeText).toMatch(/^ {6}if:$/m);
            expect(recipeText).toMatch(/^ {4}RecordTypeId: ### TODO: -- RecordType Options -- /m);
            expect(recipeText).toMatch(/^ {20}### TODO: -- RecordType Options -- /m);
            expect(recipeText).toMatch(/^ {4}Picklist__c: .*\n {20}### TODO: -- RecordType Options -- .*\n {20}# \$\{\{/m);
            expect(recipeText).toMatch(/^ {4}BillingStreet: /m);
            expect(recipeText).toMatch(/^ {4}Geolocation__Latitude__s: /m);
            expect(recipeText).toMatch(/^ {4}[A-Za-z_]+: \|$/m);
            expect(recipeText).toMatch(/^ {4}[A-Za-z_]+: ### TODO -- REFERENCE ID REQUIRED$/m);

            expect(() => yaml.load(recipeText)).not.toThrow();

        });

    });

    describe.each(RECIPE_FIXTURES)('against the %s fixture', (unusedBackend, fileName) => {

        describe.each(LINE_ENDING_VARIANTS)('%s', (unusedVariantName, lineEnding, hasFinalNewline) => {

            const recipeText = toVariant(readFixture(fileName), lineEnding, hasFinalNewline);
            const fieldAddresses = collectFieldAddresses(recipeText);
            const objectApiNames = Array.from(RecipeCockpitService.parseRecipeSource(recipeText).keys());

            test('the variant reads the same objects and fields as the fixture', () => {

                expect(fieldAddresses.length).toBeGreaterThan(100);
                expect(fieldAddresses).toEqual(collectFieldAddresses(readFixture(fileName)));

            });

            test('replaceFieldValue changes only each field\'s own lines, and the reader sees the new value', () => {

                fieldAddresses.forEach(([objectApiName, fieldApiName]) => {

                    [
                        [SINGLE_LINE_VALUE, SINGLE_LINE_VALUE],
                        [BLOCK_SCALAR_VALUE, '${{fake.word}}']
                    ].forEach(([valueText, expectedDisplayValue]) => {

                        const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, objectApiName, fieldApiName, valueText));

                        expect(edit).toMatchObject({ operation: 'replace-field-value', objectApiName: objectApiName, fieldApiName: fieldApiName });
                        expect(edit.removedLines[0]).toStartWith(`    ${fieldApiName}:`);
                        expectFidelity(recipeText, patchedRecipeText, edit);
                        expectRoundTrip(recipeText, patchedRecipeText, objectApiName, fieldApiName, { isAbsent: false, valueText: expectedDisplayValue });

                    });

                });

            });

            test('commentOutField leaves the reader without the field and everything else as it was, and restoring gives back the original text', () => {

                fieldAddresses.forEach(([objectApiName, fieldApiName]) => {

                    const { recipeText: commentedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.commentOutField(recipeText, objectApiName, fieldApiName, 'not in devhub'));

                    const lineCount = edit.removedLines.length;
                    expect(edit.insertedLines[0]).toBe(`${RecipeCockpitRecipeWriter.COMMENTED_OUT_MARKER_PREFIX}${fieldApiName} -- ${lineCount} ${lineCount === 1 ? 'line' : 'lines'} -- not in devhub`);
                    expect(edit.insertedLines).toHaveLength(edit.removedLines.length + 1);
                    edit.insertedLines.forEach(insertedLine => expect(insertedLine).toMatch(/^ {4}#/));
                    expectFidelity(recipeText, commentedRecipeText, edit);
                    expectRoundTrip(recipeText, commentedRecipeText, objectApiName, fieldApiName, { isAbsent: true });

                    const { recipeText: restoredRecipeText, edit: restoreEdit } = expectApplied(RecipeCockpitRecipeWriter.restoreCommentedOutField(commentedRecipeText, objectApiName, fieldApiName));

                    expect(restoreEdit.insertedLines).toEqual(edit.removedLines);
                    expect(restoredRecipeText).toBe(recipeText);

                });

            });

            test('insertField appends to each object\'s fields block and changes nothing else', () => {

                objectApiNames.forEach(objectApiName => {

                    const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.insertField(recipeText, objectApiName, 'Cockpit_Inserted__c', DEPENDENT_PICKLIST_VALUE));

                    expect(edit.removedLines).toEqual([]);
                    expect(edit.insertedLines[0]).toBe('    Cockpit_Inserted__c: ');
                    expectFidelity(recipeText, patchedRecipeText, edit);
                    expectRoundTrip(recipeText, patchedRecipeText, objectApiName, 'Cockpit_Inserted__c', {
                        isAbsent: false,
                        valueText: "if:\n  - choice:\n      when: ${{ Industry == 'Retail' }}\n      pick: Shop"
                    });

                    const lastFieldApiName = Array.from(RecipeCockpitService.parseRecipeSource(patchedRecipeText).get(objectApiName).fieldEntries.keys()).pop();
                    expect(lastFieldApiName).toBe('Cockpit_Inserted__c');

                });

            });

            test('setObjectProperty rewrites only the nickname or count line', () => {

                objectApiNames.forEach(objectApiName => {

                    ([['nickname', `${objectApiName}_Renamed`, `  nickname: ${objectApiName}_Renamed`], ['count', 25, '  count: 25']] as const).forEach(([propertyName, value, expectedLine]) => {

                        const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.setObjectProperty(recipeText, objectApiName, propertyName, value));

                        expect(edit).toMatchObject({ operation: 'set-object-property', objectApiName: objectApiName, propertyName: propertyName, insertedLines: [expectedLine] });
                        expect(edit.removedLines).toHaveLength(1);
                        expectFidelity(recipeText, patchedRecipeText, edit);
                        expectRoundTrip(recipeText, patchedRecipeText, objectApiName, undefined);

                    });

                });

            });

        });

        // ONE PASS PER OPERATION RATHER THAN PER VARIANT: YAML VALIDITY DOES NOT DEPEND ON THE LINE ENDING
        test('every patched text still loads as YAML', () => {

            const recipeText = readFixture(fileName);

            collectFieldAddresses(recipeText).forEach(([objectApiName, fieldApiName]) => {

                [
                    RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, objectApiName, fieldApiName, SINGLE_LINE_VALUE),
                    RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, objectApiName, fieldApiName, BLOCK_SCALAR_VALUE),
                    RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, objectApiName, fieldApiName, DEPENDENT_PICKLIST_VALUE),
                    RecipeCockpitRecipeWriter.commentOutField(recipeText, objectApiName, fieldApiName, 'removed from org')
                ].forEach(result => expect(() => yaml.load(expectApplied(result).recipeText)).not.toThrow());

            });

            Array.from(RecipeCockpitService.parseRecipeSource(recipeText).keys()).forEach(objectApiName => {

                [
                    RecipeCockpitRecipeWriter.insertField(recipeText, objectApiName, 'Cockpit_Inserted__c', SINGLE_LINE_VALUE),
                    RecipeCockpitRecipeWriter.insertField(recipeText, objectApiName, 'Cockpit_Inserted__c', DEPENDENT_PICKLIST_VALUE),
                    RecipeCockpitRecipeWriter.setObjectProperty(recipeText, objectApiName, 'count', 3),
                    RecipeCockpitRecipeWriter.setObjectProperty(recipeText, objectApiName, 'nickname', 'Renamed')
                ].forEach(result => expect(() => yaml.load(expectApplied(result).recipeText)).not.toThrow());

            });

        });

        test('a field whose recipe carries record-type TODO lines is replaced whole, TODO lines included', () => {

            const recipeText = readFixture(fileName);

            const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Example_Everything__c', 'RecordTypeId', 'Example_Everything__c.OneRecType'));

            expect(edit.removedLines).toEqual([
                '    RecordTypeId: ### TODO: -- RecordType Options -- From below, choose the expected Record Type Developer Name and ensure the rest of fields on this object recipe is consistent with the record type selection',
                '                    Example_Everything__c.OneRecType',
                '                    Example_Everything__c.TwoRecType'
            ]);
            expect(edit.insertedLines).toEqual(['    RecordTypeId: Example_Everything__c.OneRecType']);
            expect(patchedRecipeText).toContain('### TODO: -- RecordType Options -- OneRecType -- SELECT THIS SECTION');

        });

    });

    describe('refusals', () => {

        const recipeText = [
            '# Relationship Tree: RelationshipTree_1',
            '',
            '- object: Account',
            '  nickname: Account_NickName',
            '  count: 1',
            '  fields:',
            '    Name: ${{fake.company}}',
            '    Name: ${{fake.company}}',
            '    Phone: ${{fake.phone_number}}',
            '',
            '- object: Contact',
            '  nickname: Contact_NickName',
            '  fields:',
            '    LastName: ${{fake.last_name}}',
            '  fields:',
            '    FirstName: ${{fake.first_name}}',
            '',
            '- object: Lead',
            '  count: 1',
            '  count: 2',
            '',
            '- object: Case',
            '  fields:',
            '    Subject: ${{fake.sentence}}',
            '',
            '- object: Case',
            '  fields:',
            '    Subject: ${{fake.sentence}}',
            ''
        ].join('\n');

        test.each<[string, () => RecipeWriterResult, RecipeWriterRefusalReason]>([
            ['an unknown object', () => RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Opportunity', 'Name', 'x'), 'object-not-found'],
            ['an unknown field', () => RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Account', 'Website', 'x'), 'field-not-found'],
            ['an unknown field to comment out', () => RecipeCockpitRecipeWriter.commentOutField(recipeText, 'Account', 'Website', 'gone'), 'field-not-found'],
            ['a duplicate object header', () => RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Case', 'Subject', 'x'), 'duplicate-object'],
            ['an insert into a duplicate object header', () => RecipeCockpitRecipeWriter.insertField(recipeText, 'Case', 'Status', 'x'), 'duplicate-object'],
            ['a property of a duplicate object header', () => RecipeCockpitRecipeWriter.setObjectProperty(recipeText, 'Case', 'count', 2), 'duplicate-object'],
            ['an insert of a field that already exists', () => RecipeCockpitRecipeWriter.insertField(recipeText, 'Account', 'Phone', 'x'), 'field-already-exists'],
            ['a field written twice', () => RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Account', 'Name', 'x'), 'duplicate-field'],
            ['an object with two fields blocks', () => RecipeCockpitRecipeWriter.insertField(recipeText, 'Contact', 'Email', 'x'), 'duplicate-fields-block'],
            ['an object with no fields block', () => RecipeCockpitRecipeWriter.insertField(recipeText, 'Lead', 'Email', 'x'), 'fields-block-not-found'],
            ['a count line written twice', () => RecipeCockpitRecipeWriter.setObjectProperty(recipeText, 'Lead', 'count', 3), 'duplicate-property'],
            ['a missing count line', () => RecipeCockpitRecipeWriter.setObjectProperty(recipeText, 'Contact', 'count', 3), 'property-not-found'],
            ['a negative count', () => RecipeCockpitRecipeWriter.setObjectProperty(recipeText, 'Account', 'count', -1), 'invalid-value'],
            ['a fractional count', () => RecipeCockpitRecipeWriter.setObjectProperty(recipeText, 'Account', 'count', 1.5), 'invalid-value'],
            ['a nickname that is not a name', () => RecipeCockpitRecipeWriter.setObjectProperty(recipeText, 'Account', 'nickname', 'two words'), 'invalid-value'],
            ['a value whose second line is not a continuation', () => RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Account', 'Phone', 'x\n    Injected: y'), 'invalid-value'],
            ['a value that ends in a blank line', () => RecipeCockpitRecipeWriter.insertField(recipeText, 'Account', 'Website', '|\n        x\n'), 'invalid-value'],
            ['a value carrying a bare carriage return', () => RecipeCockpitRecipeWriter.insertField(recipeText, 'Account', 'Website', 'x\ry'), 'invalid-value'],
            // PyYAML -- SNOWFAKERY'S READER -- BREAKS A LINE AT EACH OF THESE, WHICH WOULD START A LINE THE WRITER NEVER CHECKED
            ['an insert whose value carries U+0085', () => RecipeCockpitRecipeWriter.insertField(recipeText, 'Account', 'Website', 'x\u0085- object: Evil'), 'invalid-value'],
            ['an insert whose value carries U+2028', () => RecipeCockpitRecipeWriter.insertField(recipeText, 'Account', 'Website', 'x\u2028- object: Evil'), 'invalid-value'],
            ['an insert whose value carries U+2029', () => RecipeCockpitRecipeWriter.insertField(recipeText, 'Account', 'Website', 'x\u2029- object: Evil'), 'invalid-value'],
            ['a replacement whose value carries U+0085', () => RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Account', 'Phone', 'x\u0085    Evil__c: 1'), 'invalid-value'],
            ['a replacement whose value carries U+2028', () => RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Account', 'Phone', 'x\u2028    Evil__c: 1'), 'invalid-value'],
            ['a replacement whose value carries U+2029', () => RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Account', 'Phone', 'x\u2029    Evil__c: 1'), 'invalid-value'],
            // THE WRITER WOULD ACCEPT A FIELD commentOutField THEN COULD NOT REMOVE
            ['a value with a line of one to three spaces inside it', () => RecipeCockpitRecipeWriter.insertField(recipeText, 'Account', 'Website', 'a\n  \n     b'), 'invalid-value'],
            ['a value with a tab-led line inside it', () => RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Account', 'Phone', 'a\n\t\n     b'), 'invalid-value'],
            ['a field api name that is not one', () => RecipeCockpitRecipeWriter.insertField(recipeText, 'Account', 'Web site', 'x'), 'invalid-field-api-name'],
            ['an object api name that is not one', () => RecipeCockpitRecipeWriter.insertField(recipeText, 'Account\n- object: Evil', 'Website', 'x'), 'invalid-object-api-name'],
            ['a restore in an unknown object', () => RecipeCockpitRecipeWriter.restoreCommentedOutField(recipeText, 'Opportunity', 'Name'), 'object-not-found'],
            ['a replacement in an object with two fields blocks', () => RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Contact', 'LastName', 'x'), 'duplicate-fields-block'],
            ['a restore with nothing commented out', () => RecipeCockpitRecipeWriter.restoreCommentedOutField(recipeText, 'Account', 'Website'), 'commented-out-field-not-found']
        ])('refuses %s rather than changing the text', (unusedDescription, applyOperation, expectedReason) => {

            expectRefused(applyOperation(), expectedReason);

        });

        test('a refusal names what it was asked about', () => {

            const result = RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Account', 'Website', 'x');

            expect(result).toEqual({
                isApplied: false,
                refusal: {
                    reason: 'field-not-found',
                    message: 'Account has no Website line in its fields.',
                    objectApiName: 'Account',
                    fieldApiName: 'Website'
                }
            });

        });

    });

    describe('commentOutField and restoreCommentedOutField', () => {

        const recipeText = [
            '- object: Account',
            '  fields:',
            '    Description: |',
            '        first paragraph',
            '',
            '        second paragraph',
            '',
            '    Phone: ${{fake.phone_number}}',
            ''
        ].join('\n');

        test('a blank line inside a field is commented out with it and restored exactly', () => {

            const { recipeText: commentedRecipeText } = expectApplied(RecipeCockpitRecipeWriter.commentOutField(recipeText, 'Account', 'Description', 'removed\nfrom  org'));

            expect(commentedRecipeText).toBe([
                '- object: Account',
                '  fields:',
                '    ### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- Description -- 4 lines -- removed from org',
                '    # Description: |',
                '    #     first paragraph',
                '    #',
                '    #     second paragraph',
                '',
                '    Phone: ${{fake.phone_number}}',
                ''
            ].join('\n'));

            expect(expectApplied(RecipeCockpitRecipeWriter.restoreCommentedOutField(commentedRecipeText, 'Account', 'Description')).recipeText).toBe(recipeText);

        });

        test('a whitespace-only line inside a field is restored with its spaces', () => {

            const recipeWithWhitespaceLines = recipeText.replace('        first paragraph\n\n', '        first paragraph\n      \n');

            const { recipeText: commentedRecipeText } = expectApplied(RecipeCockpitRecipeWriter.commentOutField(recipeWithWhitespaceLines, 'Account', 'Description', 'gone'));

            expect(commentedRecipeText).toContain('    #     first paragraph\n    #   \n    #     second paragraph\n');
            expect(expectApplied(RecipeCockpitRecipeWriter.restoreCommentedOutField(commentedRecipeText, 'Account', 'Description')).recipeText).toBe(recipeWithWhitespaceLines);

        });

        test('a field with a line of one to three spaces inside it is refused, since commenting it out could not be undone exactly', () => {

            const recipeWithShallowWhitespace = recipeText.replace('        first paragraph\n\n', '        first paragraph\n  \n');

            expectRefused(RecipeCockpitRecipeWriter.commentOutField(recipeWithShallowWhitespace, 'Account', 'Description', 'gone'), 'unsupported-field-layout');

        });

        test('a value with empty and indented blank lines inside it can be inserted, commented out and restored', () => {

            const valueText = '|\n        a\n\n        \n        b';
            const inserted = expectApplied(RecipeCockpitRecipeWriter.insertField(recipeText, 'Account', 'Website', valueText)).recipeText;
            const commented = expectApplied(RecipeCockpitRecipeWriter.commentOutField(inserted, 'Account', 'Website', 'gone')).recipeText;

            expect(expectApplied(RecipeCockpitRecipeWriter.restoreCommentedOutField(commented, 'Account', 'Website')).recipeText).toBe(inserted);

        });

        test('a reason cannot end the marker line, whatever line break or control character it carries', () => {

            const { edit } = expectApplied(RecipeCockpitRecipeWriter.commentOutField(recipeText, 'Account', 'Phone', 'a\u0085- object: Evil\u2028b\u2029c\rd\u0000e\u009ff'));

            expect(edit.insertedLines[0]).toBe('    ### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- Phone -- 1 line -- a - object: Evil b c d e f');

        });

        // THE REVIEW FINDING: WITHOUT A COUNT, A NOTE THAT READS AS A CONTINUATION WAS RESTORED AS PART OF THE FIELD
        test('a comment of the reader\'s own directly below, shaped like a continuation, is not restored with the field', () => {

            const recipeWithNote = recipeText.replace('    Phone: ${{fake.phone_number}}\n', '    Phone: ${{fake.phone_number}}\n    #     keep this note\n    #\n    #   a\n');

            const commented = expectApplied(RecipeCockpitRecipeWriter.commentOutField(recipeWithNote, 'Account', 'Phone', 'gone')).recipeText;

            expect(expectApplied(RecipeCockpitRecipeWriter.restoreCommentedOutField(commented, 'Account', 'Phone')).recipeText).toBe(recipeWithNote);

        });

        test('encoded blank lines directly after the marked lines are not restored with them', () => {

            const commentedRecipeText = expectApplied(RecipeCockpitRecipeWriter.commentOutField(recipeText, 'Account', 'Phone', 'gone')).recipeText
                .replace(/\n$/, '\n    #\n    #   \n');

            const { edit } = expectApplied(RecipeCockpitRecipeWriter.restoreCommentedOutField(commentedRecipeText, 'Account', 'Phone'));

            expect(edit.insertedLines).toEqual(['    Phone: ${{fake.phone_number}}']);

        });

        test('an empty reason leaves the marker without one', () => {

            const { edit } = expectApplied(RecipeCockpitRecipeWriter.commentOutField(recipeText, 'Account', 'Phone', '  '));

            expect(edit.insertedLines[0]).toBe('    ### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- Phone -- 1 line');

        });

        test('a comment of the reader\'s own after the marked lines is not restored with them', () => {

            const commentedRecipeText = expectApplied(RecipeCockpitRecipeWriter.commentOutField(recipeText, 'Account', 'Phone', 'gone')).recipeText
                .replace(/\n$/, '\n    # the reader\'s own note\n    #\n');

            const { edit } = expectApplied(RecipeCockpitRecipeWriter.restoreCommentedOutField(commentedRecipeText, 'Account', 'Phone'));

            expect(edit.insertedLines).toEqual(['    Phone: ${{fake.phone_number}}']);
            expect(edit.removedLines).toEqual(['    ### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- Phone -- 1 line -- gone', '    # Phone: ${{fake.phone_number}}']);

        });

        test.each([
            ['whose next line is not the field it names', '    ### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- Rating -- 1 line -- gone\n    # Phone: x\n'],
            ['with nothing under it', '    ### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- Rating -- 1 line\n'],
            ['declaring more lines than are commented', '    ### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- Rating -- 3 lines\n    # Rating: x\n    #     y\n'],
            ['whose declared lines run past the end of the file', null],
            ['whose declared lines end on a blank', '    ### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- Rating -- 2 lines\n    # Rating: |\n    #\n'],
            ['whose declared lines include a line that is not a continuation', '    ### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- Rating -- 2 lines\n    # Rating: x\n    # Other: y\n'],
            ['whose declared lines include a line that is not commented', '    ### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- Rating -- 2 lines\n    # Rating: |\n        y\n']
        ])('a marker %s is refused as altered, and nothing is restored', (unusedDescription, markerBlock) => {

            const handEditedRecipeText = markerBlock === null
                ? `${recipeText}    ### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- Rating -- 5 lines\n    # Rating: x`
                : recipeText.replace('    Phone:', `${markerBlock}    Phone:`);

            expectRefused(RecipeCockpitRecipeWriter.restoreCommentedOutField(handEditedRecipeText, 'Account', 'Rating'), 'commented-out-field-altered');

        });

        test('a marker without a line count is not one the writer wrote, so there is nothing to restore', () => {

            const handEditedRecipeText = recipeText.replace('    Phone:', '    ### TODO -- RECIPE COCKPIT -- FIELD COMMENTED OUT -- Rating -- gone\n    # Rating: x\n    Phone:');

            expectRefused(RecipeCockpitRecipeWriter.restoreCommentedOutField(handEditedRecipeText, 'Account', 'Rating'), 'commented-out-field-not-found');

        });

        test('a blank line ends the marked lines, so a comment after the gap stays where it is', () => {

            const commentedRecipeText = expectApplied(RecipeCockpitRecipeWriter.commentOutField(recipeText, 'Account', 'Phone', 'gone')).recipeText
                .replace(/\n$/, '\n\n    #     the reader\'s own deeper note\n');

            const { recipeText: restoredRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.restoreCommentedOutField(commentedRecipeText, 'Account', 'Phone'));

            expect(edit.insertedLines).toEqual(['    Phone: ${{fake.phone_number}}']);
            expect(restoredRecipeText).toBe(`${recipeText}\n    #     the reader's own deeper note\n`);

        });

        test('a field commented out twice is not restored, since which one cannot be told', () => {

            const once = expectApplied(RecipeCockpitRecipeWriter.commentOutField(recipeText, 'Account', 'Phone', 'first')).recipeText;
            const reinserted = expectApplied(RecipeCockpitRecipeWriter.insertField(once, 'Account', 'Phone', 'x')).recipeText;
            const twice = expectApplied(RecipeCockpitRecipeWriter.commentOutField(reinserted, 'Account', 'Phone', 'second')).recipeText;

            expectRefused(RecipeCockpitRecipeWriter.restoreCommentedOutField(twice, 'Account', 'Phone'), 'duplicate-commented-out-field');

        });

        test('a field that was inserted again after being commented out is not restored over', () => {

            const commentedRecipeText = expectApplied(RecipeCockpitRecipeWriter.commentOutField(recipeText, 'Account', 'Phone', 'gone')).recipeText;
            const reinsertedRecipeText = expectApplied(RecipeCockpitRecipeWriter.insertField(commentedRecipeText, 'Account', 'Phone', 'x')).recipeText;

            expectRefused(RecipeCockpitRecipeWriter.restoreCommentedOutField(reinsertedRecipeText, 'Account', 'Phone'), 'field-already-exists');

        });

    });

    describe('line endings', () => {

        test('an insert after the last line of a file with no final newline ends that line and leaves the new one unterminated', () => {

            const recipeText = '- object: Account\r\n  fields:\r\n    Name: x';

            const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.insertField(recipeText, 'Account', 'Phone', '|\n        y'));

            expect(patchedRecipeText).toBe('- object: Account\r\n  fields:\r\n    Name: x\r\n    Phone: |\r\n        y');
            expect(edit.startLineNumber).toBe(4);

        });

        test('an insert into an empty fields block goes directly under "fields:"', () => {

            const recipeText = '- object: Account\n  fields:\n\n- object: Contact\n  fields:\n    LastName: x\n';

            const { recipeText: patchedRecipeText } = expectApplied(RecipeCockpitRecipeWriter.insertField(recipeText, 'Account', 'Name', 'y'));

            expect(patchedRecipeText).toBe('- object: Account\n  fields:\n    Name: y\n\n- object: Contact\n  fields:\n    LastName: x\n');

        });

        test('a replacement takes the line ending of the lines it replaced, in a file that mixes them', () => {

            const recipeText = '- object: Account\n  fields:\r\n    Name: x\r\n    Phone: y\n';

            const { recipeText: patchedRecipeText } = expectApplied(RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Account', 'Name', '|\n        z'));

            expect(patchedRecipeText).toBe('- object: Account\n  fields:\r\n    Name: |\r\n        z\r\n    Phone: y\n');

        });

        test('a value written with CRLF is written with the file\'s own line ending', () => {

            const recipeText = '- object: Account\n  fields:\n    Name: x\n';

            const { recipeText: patchedRecipeText } = expectApplied(RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Account', 'Name', '|\r\n        z'));

            expect(patchedRecipeText).toBe('- object: Account\n  fields:\n    Name: |\n        z\n');

        });

    });

    describe('setObjectProperty', () => {

        test('accepts a count written as digits and writes it as a number', () => {

            const recipeText = '- object: Account\n  nickname: A\n  count: 1\n  fields:\n    Name: x\n';

            expect(expectApplied(RecipeCockpitRecipeWriter.setObjectProperty(recipeText, 'Account', 'count', '007')).recipeText).toBe('- object: Account\n  nickname: A\n  count: 7\n  fields:\n    Name: x\n');

        });

        test('refuses a nickname that is not a string', () => {

            expectRefused(RecipeCockpitRecipeWriter.setObjectProperty('- object: Account\n  nickname: A\n', 'Account', 'nickname', 5), 'invalid-value');

        });

        test('finds a property written after the fields block', () => {

            const recipeText = '- object: Account\n  fields:\n    Name: x\n  count: 1\n';

            const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.setObjectProperty(recipeText, 'Account', 'count', 4));

            expect(patchedRecipeText).toBe('- object: Account\n  fields:\n    Name: x\n  count: 4\n');
            expect(edit.startLineNumber).toBe(4);

        });

    });

    describe('scanRecipeObjects', () => {

        test('does not carry an object past a column-zero line that is not a header', () => {

            const scannedObjects = RecipeCockpitRecipeWriter.scanRecipeObjects(['- object: Account', '  fields:', '    Name: x', '# Level 1', '  count: 1', '    Stray: y']);

            expect(scannedObjects).toHaveLength(1);
            expect(scannedObjects[0].fields.map(scannedField => scannedField.fieldApiName)).toEqual(['Name']);
            expect(scannedObjects[0].propertyLineIndexes.count).toEqual([]);

        });

        test('ignores lines before the first object header', () => {

            expect(RecipeCockpitRecipeWriter.scanRecipeObjects(['# Relationship Tree: T', '  fields:', '    Name: x'])).toEqual([]);

        });

    });

    describe('splitRecipeLines and joinRecipeLines', () => {

        test.each(['', 'a', 'a\n', 'a\r\nb', 'a\r\n\nb\n', '\n'])('round-trip %j exactly', (recipeText) => {

            expect(RecipeCockpitRecipeWriter.joinRecipeLines(RecipeCockpitRecipeWriter.splitRecipeLines(recipeText))).toBe(recipeText);

        });

    });

});
