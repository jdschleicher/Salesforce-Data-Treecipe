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

/*
    The same mock metadata through the same pipeline with faker-js nesting turned on (#46): every
    child object under its parent's friends: block, two levels deep, and lookups to ancestors wired.
    Every operation below runs against every object and field of it as well.
*/
const NESTED_RECIPE_FIXTURE: [string, string] = ['faker-js nested', 'recipe-fakerjs-nested--RelationshipTree_1.yml'];
const ALL_RECIPE_FIXTURES: ReadonlyArray<[string, string]> = [...RECIPE_FIXTURES, NESTED_RECIPE_FIXTURE];

const LINE_ENDING_VARIANTS: ReadonlyArray<[string, string, boolean]> = [
    ['LF with a final newline', '\n', true],
    ['LF without a final newline', '\n', false],
    ['CRLF with a final newline', '\r\n', true],
    ['CRLF without a final newline', '\r\n', false]
];

function readFixture(fileName: string): string {
    return fs.readFileSync(path.join(RECIPE_WRITER_MOCKS_PATH, fileName), 'utf-8');
}

/*
    Every occurrence of every object the reader reports, in file-entry order. An object written
    twice -- the nested child iteration a self-lookup adds (#188) -- is addressed by NICKNAME, both
    occurrences, since the writer refuses its api name alone; an object written once by api name
    only, as it always was. occurrenceKey is the api name and the occurrence's position, so it
    survives a nickname rename.
*/
type ObjectOccurrence = { occurrenceKey: string; objectApiName: string; objectNickname?: string; objectEntry: { lineNumber: number; fieldEntries: Map<string, { lineNumber: number; valueText: string }> } };

function collectObjectOccurrences(recipeText: string): ObjectOccurrence[] {
    const occurrences: ObjectOccurrence[] = [];
    RecipeCockpitService.parseRecipeSource(recipeText).forEach((objectEntry, objectApiName) => {
        occurrences.push({ occurrenceKey: `${objectApiName}#0`, objectApiName: objectApiName, objectNickname: objectEntry.iterations ? objectEntry.nickname : undefined, objectEntry: objectEntry });
        ( objectEntry.iterations ?? [] ).forEach((iteration, iterationIndex) => {
            occurrences.push({ occurrenceKey: `${objectApiName}#${iterationIndex + 1}`, objectApiName: objectApiName, objectNickname: iteration.nickname, objectEntry: iteration });
        });
    });
    return occurrences;
}

function findOccurrence(occurrences: ObjectOccurrence[], objectApiName: string, objectNickname?: string): ObjectOccurrence {
    return occurrences.find(occurrence => occurrence.objectApiName === objectApiName && occurrence.objectNickname === objectNickname);
}

// THE OBJECT'S FIELD COLUMN, READ FROM ITS HEADER LINE RATHER THAN FROM THE WRITER UNDER TEST
function fieldIndentOf(recipeText: string, objectApiName: string, objectNickname?: string): string {
    const headerLine = recipeText.split(/\r?\n/)[findOccurrence(collectObjectOccurrences(recipeText), objectApiName, objectNickname).objectEntry.lineNumber - 1];
    return ' '.repeat(/^ */.exec(headerLine)[0].length + 4);
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
function expectRoundTrip(recipeText: string, patchedRecipeText: string, objectApiName: string, fieldApiName: string | undefined, fieldExpectation?: FieldExpectation, objectNickname?: string): void {

    const originalOccurrences = collectObjectOccurrences(recipeText);
    const patchedOccurrences = collectObjectOccurrences(patchedRecipeText);
    const originalLines = recipeText.split(/\r?\n/);
    const patchedLines = patchedRecipeText.split(/\r?\n/);
    const targetOccurrenceKey = findOccurrence(originalOccurrences, objectApiName, objectNickname).occurrenceKey;

    expect(patchedOccurrences.map(occurrence => occurrence.occurrenceKey)).toEqual(originalOccurrences.map(occurrence => occurrence.occurrenceKey));

    // EACH OTHER LINE AS "WHERE IT IS: WHAT IT SAYS", SO A MOVED LINE STILL MATCHES AND A CHANGED ONE DOES NOT
    const describeLines = (occurrences: ObjectOccurrence[], lines: string[]): string[] => {
        const describedLines: string[] = [];
        occurrences.forEach(({ occurrenceKey, objectEntry }) => {
            describedLines.push(`${occurrenceKey}: ${lines[objectEntry.lineNumber - 1]}`);
            objectEntry.fieldEntries.forEach((fieldEntry, entryFieldApiName) => {
                if ( occurrenceKey !== targetOccurrenceKey || entryFieldApiName !== fieldApiName ) {
                    describedLines.push(`${occurrenceKey}.${entryFieldApiName}: ${lines[fieldEntry.lineNumber - 1]} => ${fieldEntry.valueText}`);
                }
            });
        });
        return describedLines;
    };

    expect(describeLines(patchedOccurrences, patchedLines).join('\n')).toBe(describeLines(originalOccurrences, originalLines).join('\n'));

    if ( fieldApiName === undefined || fieldExpectation === undefined ) {
        return;
    }

    const originalFieldEntries = originalOccurrences.find(occurrence => occurrence.occurrenceKey === targetOccurrenceKey).objectEntry.fieldEntries;
    const patchedFieldEntries = patchedOccurrences.find(occurrence => occurrence.occurrenceKey === targetOccurrenceKey).objectEntry.fieldEntries;
    const targetFieldEntry = patchedFieldEntries.get(fieldApiName);

    if ( !('valueText' in fieldExpectation) ) {
        expect(targetFieldEntry).toBeUndefined();
        return;
    }

    expect(targetFieldEntry.valueText).toBe(fieldExpectation.valueText);

    const otherFieldCount = Array.from(originalFieldEntries.keys()).filter(originalFieldApiName => originalFieldApiName !== fieldApiName).length;
    expect(patchedFieldEntries.size).toBe(otherFieldCount + 1);

}

// [object, field, nickname] -- THE NICKNAME ONLY FOR AN OBJECT WRITTEN MORE THAN ONCE
function collectFieldAddresses(recipeText: string): Array<[string, string, string | undefined]> {
    const fieldAddresses: Array<[string, string, string | undefined]> = [];
    collectObjectOccurrences(recipeText).forEach(({ objectApiName, objectNickname, objectEntry }) => {
        objectEntry.fieldEntries.forEach((unusedFieldEntry, fieldApiName) => fieldAddresses.push([objectApiName, fieldApiName, objectNickname]));
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

        // THE VALUE IS ONE DEVELOPER NAME (#157), SO THE READER'S FIRST LINE IS THE RECORD TYPE THE RECIPE INSERTS
        test.each(RECIPE_FIXTURES)('the cockpit reader lists the %s fixture\'s RecordTypeId with the chosen record type as its value', (unusedBackend, fileName) => {

            const recipeLines = readFixture(fileName).split('\n');
            const recordTypeIdEntry = RecipeCockpitService.parseRecipeSource(recipeLines.join('\n')).get('Example_Everything__c').fieldEntries.get('RecordTypeId');

            expect(recipeLines[recordTypeIdEntry.lineNumber - 1]).toBe('    RecordTypeId: Example_Everything__c.OneRecType');
            expect(recordTypeIdEntry.valueText.split('\n')).toEqual([
                'Example_Everything__c.OneRecType',
                '### TODO: -- RecordType Options -- From below, choose the expected Record Type Developer Name and ensure the rest of fields on this object recipe is consistent with the record type selection',
                '# Example_Everything__c.TwoRecType'
            ]);

        });

        test.each(RECIPE_FIXTURES)('the %s fixture carries every construct the writer has to leave alone, and loads as YAML', (unusedBackend, fileName) => {

            const recipeText = readFixture(fileName);

            expect(recipeText).toMatch(/^# Relationship Tree: /m);
            expect(recipeText).toMatch(/^ {6}if:$/m);
            expect(recipeText).toMatch(/^ {4}RecordTypeId: Example_Everything__c\.OneRecType\n {20}### TODO: -- RecordType Options -- From below, .*\n {20}# Example_Everything__c\.TwoRecType$/m);
            expect(recipeText).toMatch(/^ {20}### TODO: -- RecordType Options -- /m);
            expect(recipeText).toMatch(/^ {4}Picklist__c: .*\n {20}### TODO: -- RecordType Options -- .*\n {20}# \$\{\{/m);
            expect(recipeText).toMatch(/^ {4}BillingStreet: /m);
            expect(recipeText).toMatch(/^ {4}Geolocation__Latitude__s: /m);
            expect(recipeText).toMatch(/^ {4}[A-Za-z_]+: \|$/m);
            expect(recipeText).toMatch(/^ {4}[A-Za-z_]+: ### TODO -- REFERENCE ID REQUIRED$/m);

            expect(() => yaml.load(recipeText)).not.toThrow();

        });

    });

    describe.each(ALL_RECIPE_FIXTURES)('against the %s fixture', (unusedBackend, fileName) => {

        describe.each(LINE_ENDING_VARIANTS)('%s', (unusedVariantName, lineEnding, hasFinalNewline) => {

            const recipeText = toVariant(readFixture(fileName), lineEnding, hasFinalNewline);
            const fieldAddresses = collectFieldAddresses(recipeText);
            const objectOccurrences = collectObjectOccurrences(recipeText);

            test('the variant reads the same objects and fields as the fixture', () => {

                expect(fieldAddresses.length).toBeGreaterThan(100);
                expect(fieldAddresses).toEqual(collectFieldAddresses(readFixture(fileName)));

            });

            test('replaceFieldValue changes only each field\'s own lines, and the reader sees the new value', () => {

                fieldAddresses.forEach(([objectApiName, fieldApiName, objectNickname]) => {

                    [
                        [SINGLE_LINE_VALUE, SINGLE_LINE_VALUE],
                        [BLOCK_SCALAR_VALUE, '${{fake.word}}']
                    ].forEach(([valueText, expectedDisplayValue]) => {

                        const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, objectApiName, fieldApiName, valueText, objectNickname));

                        expect(edit).toMatchObject({ operation: 'replace-field-value', objectApiName: objectApiName, fieldApiName: fieldApiName });
                        expect(edit.objectNickname).toBe(objectNickname);
                        expect(edit.removedLines[0]).toStartWith(`${fieldIndentOf(recipeText, objectApiName, objectNickname)}${fieldApiName}:`);
                        expectFidelity(recipeText, patchedRecipeText, edit);
                        expectRoundTrip(recipeText, patchedRecipeText, objectApiName, fieldApiName, { isAbsent: false, valueText: expectedDisplayValue }, objectNickname);

                    });

                });

            });

            test('commentOutField leaves the reader without the field and everything else as it was, and restoring gives back the original text', () => {

                fieldAddresses.forEach(([objectApiName, fieldApiName, objectNickname]) => {

                    const { recipeText: commentedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.commentOutField(recipeText, objectApiName, fieldApiName, 'not in devhub', objectNickname));

                    const lineCount = edit.removedLines.length;
                    const fieldIndent = fieldIndentOf(recipeText, objectApiName, objectNickname);
                    expect(edit.insertedLines[0]).toBe(`${fieldIndent}${RecipeCockpitRecipeWriter.COMMENTED_OUT_MARKER_PREFIX.trimStart()}${fieldApiName} -- ${lineCount} ${lineCount === 1 ? 'line' : 'lines'} -- not in devhub`);
                    expect(edit.insertedLines).toHaveLength(edit.removedLines.length + 1);
                    edit.insertedLines.forEach(insertedLine => expect(insertedLine).toStartWith(`${fieldIndent}#`));
                    expectFidelity(recipeText, commentedRecipeText, edit);
                    expectRoundTrip(recipeText, commentedRecipeText, objectApiName, fieldApiName, { isAbsent: true }, objectNickname);

                    const { recipeText: restoredRecipeText, edit: restoreEdit } = expectApplied(RecipeCockpitRecipeWriter.restoreCommentedOutField(commentedRecipeText, objectApiName, fieldApiName, objectNickname));

                    expect(restoreEdit.insertedLines).toEqual(edit.removedLines);
                    expect(restoredRecipeText).toBe(recipeText);

                });

            });

            test('insertField appends to each object\'s fields block and changes nothing else', () => {

                objectOccurrences.forEach(({ objectApiName, objectNickname }) => {

                    const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.insertField(recipeText, objectApiName, 'Cockpit_Inserted__c', DEPENDENT_PICKLIST_VALUE, objectNickname));

                    expect(edit.removedLines).toEqual([]);
                    expect(edit.insertedLines[0]).toBe(`${fieldIndentOf(recipeText, objectApiName, objectNickname)}Cockpit_Inserted__c: `);
                    expectFidelity(recipeText, patchedRecipeText, edit);
                    expectRoundTrip(recipeText, patchedRecipeText, objectApiName, 'Cockpit_Inserted__c', {
                        isAbsent: false,
                        valueText: "if:\n  - choice:\n      when: ${{ Industry == 'Retail' }}\n      pick: Shop"
                    }, objectNickname);

                    const lastFieldApiName = Array.from(findOccurrence(collectObjectOccurrences(patchedRecipeText), objectApiName, objectNickname).objectEntry.fieldEntries.keys()).pop();
                    expect(lastFieldApiName).toBe('Cockpit_Inserted__c');

                });

            });

            test('setObjectProperty rewrites only the nickname or count line', () => {

                objectOccurrences.forEach(({ objectApiName, objectNickname, occurrenceKey }) => {

                    const propertyIndent = fieldIndentOf(recipeText, objectApiName, objectNickname).slice(2);
                    const renamedNickname = `${occurrenceKey.replace('#', '_')}_Renamed`;
                    ([['nickname', renamedNickname, `${propertyIndent}nickname: ${renamedNickname}`], ['count', 25, `${propertyIndent}count: 25`]] as const).forEach(([propertyName, value, expectedLine]) => {

                        const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.setObjectProperty(recipeText, objectApiName, propertyName, value, objectNickname));

                        expect(edit).toMatchObject({ operation: 'set-object-property', objectApiName: objectApiName, propertyName: propertyName, insertedLines: [expectedLine] });
                        expect(edit.removedLines).toHaveLength(1);
                        expectFidelity(recipeText, patchedRecipeText, edit);
                        expectRoundTrip(recipeText, patchedRecipeText, objectApiName, undefined, undefined, objectNickname);

                    });

                });

            });

        });

        // ONE PASS PER OPERATION RATHER THAN PER VARIANT: YAML VALIDITY DOES NOT DEPEND ON THE LINE ENDING
        test('every patched text still loads as YAML', () => {

            const recipeText = readFixture(fileName);

            collectFieldAddresses(recipeText).forEach(([objectApiName, fieldApiName, objectNickname]) => {

                [
                    RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, objectApiName, fieldApiName, SINGLE_LINE_VALUE, objectNickname),
                    RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, objectApiName, fieldApiName, BLOCK_SCALAR_VALUE, objectNickname),
                    RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, objectApiName, fieldApiName, DEPENDENT_PICKLIST_VALUE, objectNickname),
                    RecipeCockpitRecipeWriter.commentOutField(recipeText, objectApiName, fieldApiName, 'removed from org', objectNickname)
                ].forEach(result => expect(() => yaml.load(expectApplied(result).recipeText)).not.toThrow());

            });

            collectObjectOccurrences(recipeText).forEach(({ objectApiName, objectNickname }) => {

                [
                    RecipeCockpitRecipeWriter.insertField(recipeText, objectApiName, 'Cockpit_Inserted__c', SINGLE_LINE_VALUE, objectNickname),
                    RecipeCockpitRecipeWriter.insertField(recipeText, objectApiName, 'Cockpit_Inserted__c', DEPENDENT_PICKLIST_VALUE, objectNickname),
                    RecipeCockpitRecipeWriter.setObjectProperty(recipeText, objectApiName, 'count', 3, objectNickname),
                    RecipeCockpitRecipeWriter.setObjectProperty(recipeText, objectApiName, 'nickname', 'Renamed', objectNickname)
                ].forEach(result => expect(() => yaml.load(expectApplied(result).recipeText)).not.toThrow());

            });

        });

        test('a field whose recipe carries record-type TODO lines is replaced whole, TODO lines included', () => {

            const recipeText = readFixture(fileName);

            // THE FIRST OCCURRENCE -- BY NICKNAME WHERE A SELF-LOOKUP WROTE THE OBJECT TWICE (#188)
            const { objectNickname } = collectObjectOccurrences(recipeText).find(occurrence => occurrence.objectApiName === 'Example_Everything__c');
            const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Example_Everything__c', 'RecordTypeId', 'Example_Everything__c.TwoRecType', objectNickname));
            const fieldIndent = fieldIndentOf(recipeText, 'Example_Everything__c', objectNickname);

            expect(edit.removedLines).toEqual([
                `${fieldIndent}RecordTypeId: Example_Everything__c.OneRecType`,
                `${fieldIndent}                ### TODO: -- RecordType Options -- From below, choose the expected Record Type Developer Name and ensure the rest of fields on this object recipe is consistent with the record type selection`,
                `${fieldIndent}                # Example_Everything__c.TwoRecType`
            ]);
            expect(edit.insertedLines).toEqual([`${fieldIndent}RecordTypeId: Example_Everything__c.TwoRecType`]);
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

    describe('nested friends: objects (#46)', () => {

        const nestedRecipeText = readFixture(NESTED_RECIPE_FIXTURE[1]);

        test('the reader finds every object at every depth, each at its header line, and the same fields as the flat recipe', () => {

            const nestedEntries = RecipeCockpitService.parseRecipeSource(nestedRecipeText);
            const nestedLines = nestedRecipeText.split('\n');
            const headerObjectApiNames = [...nestedRecipeText.matchAll(/^ *- object: (\S+)$/gm)].map(([, objectApiName]) => objectApiName);

            expect(nestedRecipeText).toMatch(/^ {8}- object: /m);
            expect(Array.from(nestedEntries.keys())).toEqual([...new Set(headerObjectApiNames)]);
            // EVERY HEADER IS AN OCCURRENCE: Example_Everything__c's SELF-LOOKUP WRITES IT TWICE, TOLD APART BY NICKNAME (#188)
            expect(collectObjectOccurrences(nestedRecipeText).map(occurrence => occurrence.objectApiName).sort()).toEqual([...headerObjectApiNames].sort());
            collectObjectOccurrences(nestedRecipeText).forEach(({ objectApiName, objectNickname, objectEntry }) => {
                expect(nestedLines[objectEntry.lineNumber - 1].trim()).toBe(`- object: ${objectApiName}`);
                objectEntry.fieldEntries.forEach((fieldEntry, fieldApiName) => {
                    expect(nestedLines[fieldEntry.lineNumber - 1]).toStartWith(`${fieldIndentOf(nestedRecipeText, objectApiName, objectNickname)}${fieldApiName}:`);
                });
            });

            const sortedAddresses = (recipeText: string) => [...new Set(collectFieldAddresses(recipeText).map(([objectApiName, fieldApiName]) => `${objectApiName}.${fieldApiName}`))].sort();
            expect(sortedAddresses(nestedRecipeText)).toEqual(sortedAddresses(readFixture('recipe-fakerjs--RelationshipTree_1.yml')));

        });

        test('the reader shows a wired lookup as the ancestor nickname it holds', () => {

            const nestedEntries = RecipeCockpitService.parseRecipeSource(nestedRecipeText);

            expect(nestedEntries.get('Contact').fieldEntries.get('AccountId').valueText).toBe('Account_NickName');
            expect(nestedEntries.get('MasterDetailMadness__c').fieldEntries.get('LU_Contact__c').valueText).toBe('Contact_NickName');

        });

        test('insertField on a parent writes into its fields block, above its friends: line', () => {

            const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.insertField(nestedRecipeText, 'Account', 'Cockpit_Inserted__c', SINGLE_LINE_VALUE));
            const patchedLines = patchedRecipeText.split('\n');

            expect(edit.insertedLines).toEqual([`    Cockpit_Inserted__c: ${SINGLE_LINE_VALUE}`]);
            expect(patchedLines[edit.startLineNumber]).toBe('  friends:');
            expect((yaml.load(patchedRecipeText) as Array<{ fields: Record<string, unknown> }>)[0].fields.Cockpit_Inserted__c).toBe(SINGLE_LINE_VALUE);

        });

        test('a value written for a top-level object is moved to the friend\'s depth', () => {

            const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.insertField(nestedRecipeText, 'MasterDetailMadness__c', 'Cockpit_Inserted__c', BLOCK_SCALAR_VALUE));

            expect(edit.insertedLines).toEqual([
                '            Cockpit_Inserted__c: |',
                '                        ${{fake.word}}'
            ]);
            expect(RecipeCockpitService.parseRecipeSource(patchedRecipeText).get('MasterDetailMadness__c').fieldEntries.get('Cockpit_Inserted__c').valueText).toBe('${{fake.word}}');

        });

        test('a value that would not keep the layout at the top level is refused for a friend too', () => {

            expectRefused(RecipeCockpitRecipeWriter.insertField(nestedRecipeText, 'Contact', 'Cockpit_Inserted__c', 'first\n  second'), 'invalid-value');

        });

    });

    describe('an object written twice, told apart by nickname (#188)', () => {

        const selfLookupRecipeText = readFixture('recipe-fakerjs-selfLookup--RelationshipTree_1.yml');
        const selfLookupLines = selfLookupRecipeText.split('\n');
        const CHILD_NICKNAME = 'Account_child_NickName';

        type LoadedEntry = { object: string; nickname: string; count: number; fields: Record<string, unknown>; friends?: LoadedEntry[] };
        const loadEntries = (recipeText: string) => yaml.load(recipeText) as LoadedEntry[];
        const refusalOf = (result: RecipeWriterResult) => ( 'refusal' in result ? result.refusal : undefined );

        test('the scan records each occurrence\'s nickname and the object whose friends: block holds it', () => {

            const scannedObjects = RecipeCockpitRecipeWriter.scanRecipeObjects(selfLookupLines);

            expect(scannedObjects.map(scannedObject => [scannedObject.objectApiName, scannedObject.nicknames, scannedObject.parentHeaderIndex])).toEqual([
                ['Account', ['Account_NickName'], undefined],
                ['Contact', ['Contact_NickName'], scannedObjects[0].headerIndex],
                ['Account', [CHILD_NICKNAME], scannedObjects[0].headerIndex]
            ]);

        });

        test.each([
            ['replaceFieldValue', (nickname?: string) => RecipeCockpitRecipeWriter.replaceFieldValue(selfLookupRecipeText, 'Account', 'ParentId', 'x', nickname)],
            ['insertField', (nickname?: string) => RecipeCockpitRecipeWriter.insertField(selfLookupRecipeText, 'Account', 'Cockpit_Inserted__c', 'x', nickname)],
            ['commentOutField', (nickname?: string) => RecipeCockpitRecipeWriter.commentOutField(selfLookupRecipeText, 'Account', 'ParentId', '', nickname)],
            ['restoreCommentedOutField', (nickname?: string) => RecipeCockpitRecipeWriter.restoreCommentedOutField(selfLookupRecipeText, 'Account', 'ParentId', nickname)],
            ['setObjectProperty', (nickname?: string) => RecipeCockpitRecipeWriter.setObjectProperty(selfLookupRecipeText, 'Account', 'count', 3, nickname)]
        ])('%s refuses the api name alone, an unknown nickname and a malformed one', (_operationName, applyOperation) => {

            expectRefused(applyOperation(), 'duplicate-object');
            expectRefused(applyOperation('Missing_NickName'), 'object-not-found');
            expectRefused(applyOperation('not a nickname'), 'invalid-object-nickname');

            const unknownNicknameResult = applyOperation('Missing_NickName');
            expect(refusalOf(unknownNicknameResult)).toMatchObject({ objectApiName: 'Account', objectNickname: 'Missing_NickName' });

        });

        test('replaceFieldValue changes the nested iteration\'s line only, and the edit names the occurrence', () => {

            const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.replaceFieldValue(selfLookupRecipeText, 'Account', 'ParentId', 'Some_Other_NickName', CHILD_NICKNAME));

            expect(edit).toMatchObject({ operation: 'replace-field-value', objectApiName: 'Account', objectNickname: CHILD_NICKNAME, fieldApiName: 'ParentId' });
            expect(edit.removedLines).toEqual(['        ParentId: Account_NickName']);
            expect(selfLookupLines[edit.startLineNumber - 1]).toBe('        ParentId: Account_NickName');
            expectFidelity(selfLookupRecipeText, patchedRecipeText, edit);

            const [topEntry] = loadEntries(patchedRecipeText);
            expect(topEntry.fields.ParentId).toBeNull();
            expect(topEntry.friends[1].fields.ParentId).toBe('Some_Other_NickName');

        });

        test('the top occurrence is picked by its own nickname', () => {

            const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.insertField(selfLookupRecipeText, 'Account', 'Cockpit_Inserted__c', 'x', 'Account_NickName'));

            expect(edit.insertedLines).toEqual(['    Cockpit_Inserted__c: x']);
            const [topEntry] = loadEntries(patchedRecipeText);
            expect(topEntry.fields.Cockpit_Inserted__c).toBe('x');
            expect(topEntry.friends[1].fields).not.toHaveProperty('Cockpit_Inserted__c');

        });

        test('commenting out the nested iteration\'s field restores byte for byte, and leaves the top one\'s alone', () => {

            const { recipeText: commentedRecipeText } = expectApplied(RecipeCockpitRecipeWriter.commentOutField(selfLookupRecipeText, 'Account', 'ParentId', 'no parent', CHILD_NICKNAME));

            expect(loadEntries(commentedRecipeText)[0].friends[1].fields).not.toHaveProperty('ParentId');
            expect(loadEntries(commentedRecipeText)[0].fields).toHaveProperty('ParentId');
            expectRefused(RecipeCockpitRecipeWriter.restoreCommentedOutField(commentedRecipeText, 'Account', 'ParentId', 'Account_NickName'), 'field-already-exists');

            const { recipeText: restoredRecipeText } = expectApplied(RecipeCockpitRecipeWriter.restoreCommentedOutField(commentedRecipeText, 'Account', 'ParentId', CHILD_NICKNAME));
            expect(restoredRecipeText).toBe(selfLookupRecipeText);

        });

        test('setObjectProperty sets the nested iteration\'s count, and renaming it keeps it addressable by the new nickname only', () => {

            const { recipeText: countedRecipeText } = expectApplied(RecipeCockpitRecipeWriter.setObjectProperty(selfLookupRecipeText, 'Account', 'count', 4, CHILD_NICKNAME));
            expect(loadEntries(countedRecipeText)[0].count).toBe(1);
            expect(loadEntries(countedRecipeText)[0].friends[1].count).toBe(4);

            const { recipeText: renamedRecipeText } = expectApplied(RecipeCockpitRecipeWriter.setObjectProperty(selfLookupRecipeText, 'Account', 'nickname', 'Account_Branch_NickName', CHILD_NICKNAME));
            expectRefused(RecipeCockpitRecipeWriter.setObjectProperty(renamedRecipeText, 'Account', 'count', 2, CHILD_NICKNAME), 'object-not-found');
            expectApplied(RecipeCockpitRecipeWriter.setObjectProperty(renamedRecipeText, 'Account', 'count', 2, 'Account_Branch_NickName'));

        });

        test('a nickname two occurrences share is refused, and an object written once still needs none', () => {

            const sharedNicknameRecipeText = selfLookupRecipeText.replace(`nickname: ${CHILD_NICKNAME}`, 'nickname: Account_NickName');

            expectRefused(RecipeCockpitRecipeWriter.replaceFieldValue(sharedNicknameRecipeText, 'Account', 'ParentId', 'x', 'Account_NickName'), 'duplicate-object');
            const sharedResult = RecipeCockpitRecipeWriter.replaceFieldValue(sharedNicknameRecipeText, 'Account', 'ParentId', 'x', 'Account_NickName');
            expect(refusalOf(sharedResult).message).toContain('with the nickname Account_NickName');

            expectApplied(RecipeCockpitRecipeWriter.replaceFieldValue(selfLookupRecipeText, 'Contact', 'AccountId', 'x'));
            expectApplied(RecipeCockpitRecipeWriter.replaceFieldValue(selfLookupRecipeText, 'Contact', 'AccountId', 'x', 'Contact_NickName'));

        });

        test('a comment after a nickname is not part of it, so the occurrence is still addressed by its nickname', () => {

            const commentedRecipeText = selfLookupRecipeText.replace(`nickname: ${CHILD_NICKNAME}`, `nickname: ${CHILD_NICKNAME}   # the branch office`);

            expect(RecipeCockpitRecipeWriter.scanRecipeObjects(commentedRecipeText.split('\n'))[2].nicknames).toEqual([CHILD_NICKNAME]);
            expectApplied(RecipeCockpitRecipeWriter.replaceFieldValue(commentedRecipeText, 'Account', 'ParentId', 'x', CHILD_NICKNAME));

        });

        test('a property refusal names the occurrence', () => {

            const invalidCountResult = RecipeCockpitRecipeWriter.setObjectProperty(selfLookupRecipeText, 'Account', 'count', -1, CHILD_NICKNAME);
            const missingPropertyResult = RecipeCockpitRecipeWriter.setObjectProperty(selfLookupRecipeText.replace('      count: 1\n      fields:\n        Name: ${{ faker.company.name() }}\n        ParentId', '      fields:\n        Name: ${{ faker.company.name() }}\n        ParentId'), 'Account', 'count', 2, CHILD_NICKNAME);

            expect(refusalOf(invalidCountResult)).toMatchObject({ reason: 'invalid-value', objectNickname: CHILD_NICKNAME, message: `The count for Account (${CHILD_NICKNAME}) must be a whole number of zero or more.` });
            expect(refusalOf(missingPropertyResult)).toMatchObject({ reason: 'property-not-found', objectNickname: CHILD_NICKNAME, message: `Account (${CHILD_NICKNAME}) has no "count:" line to set.` });

        });

        test('a refusal after the occurrence is found names the occurrence', () => {

            const missingFieldResult = RecipeCockpitRecipeWriter.replaceFieldValue(selfLookupRecipeText, 'Account', 'Missing__c', 'x', CHILD_NICKNAME);

            expectRefused(missingFieldResult, 'field-not-found');
            expect(refusalOf(missingFieldResult)).toMatchObject({
                objectNickname: CHILD_NICKNAME,
                message: `Account (${CHILD_NICKNAME}) has no Missing__c line in its fields.`
            });

        });

    });

    describe('scanRecipeObjects over friends: blocks', () => {

        const scan = (recipeLines: string[]) => RecipeCockpitRecipeWriter.scanRecipeObjects(recipeLines)
            .map(scannedObject => ({
                objectApiName: scannedObject.objectApiName,
                objectIndent: scannedObject.objectIndent,
                fields: scannedObject.fields.map(scannedField => scannedField.fieldApiName),
                count: scannedObject.propertyLineIndexes.count
            }));

        test('a sibling after a grandchild, and a parent property after its friends, land on the right object', () => {

            expect(scan([
                '- object: Account',
                '  fields:',
                '    Name: a',
                '  friends:',
                '    # Contact (Parents: Account)',
                '    - object: Contact',
                '      fields:',
                '        LastName: b',
                '      friends:',
                '        - object: Case',
                '          fields:',
                '            Subject: c',
                '    # Opportunity (Parents: Account)',
                '    - object: Opportunity',
                '      count: 3',
                '      fields:',
                '        StageName: d',
                '  count: 2',
                '# Lead',
                '- object: Lead',
                '  fields:',
                '    Company: e'
            ])).toEqual([
                { objectApiName: 'Account', objectIndent: 0, fields: ['Name'], count: [17] },
                { objectApiName: 'Contact', objectIndent: 4, fields: ['LastName'], count: [] },
                { objectApiName: 'Case', objectIndent: 8, fields: ['Subject'], count: [] },
                { objectApiName: 'Opportunity', objectIndent: 4, fields: ['StageName'], count: [14] },
                { objectApiName: 'Lead', objectIndent: 0, fields: ['Company'], count: [] }
            ]);

        });

        test.each([
            ['outside a friends: block', ['- object: Account', '  fields:', '    Name: a', '    - object: Contact', '      fields:', '        LastName: b']],
            ['at a column that is not a friends level', ['- object: Account', '  friends:', '   - object: Contact', '      fields:', '        LastName: b']],
            ['two levels below the open object', ['- object: Account', '  friends:', '        - object: Contact', '          fields:', '            LastName: b']]
        ])('a nested "- object:" header %s opens no object', (unusedDescription, recipeLines) => {

            expect(scan(recipeLines).map(scannedObject => scannedObject.objectApiName)).toEqual(['Account']);

        });

        test('a field written twice in one friend is refused by the writer and read first-wins by the reader', () => {

            const recipeText = [
                '- object: Account',
                '  fields:',
                '    Name: top',
                '  friends:',
                '    - object: Contact',
                '      fields:',
                '        LastName: first',
                '        LastName: second'
            ].join('\n');

            expectRefused(RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Contact', 'LastName', 'x'), 'duplicate-field');
            expect(RecipeCockpitService.parseRecipeSource(recipeText).get('Contact').fieldEntries.get('LastName')).toEqual({ lineNumber: 7, valueText: 'first' });

        });

        test('the same object at two depths is refused by the writer and read first-wins by the reader', () => {

            const recipeText = [
                '- object: Account',
                '  fields:',
                '    Name: top',
                '  friends:',
                '    - object: Account',
                '      fields:',
                '        Name: child'
            ].join('\n');

            expectRefused(RecipeCockpitRecipeWriter.replaceFieldValue(recipeText, 'Account', 'Name', 'x'), 'duplicate-object');
            expect(RecipeCockpitService.parseRecipeSource(recipeText).get('Account').fieldEntries.get('Name')).toEqual({ lineNumber: 3, valueText: 'top' });

        });

    });

    describe('splitRecipeLines and joinRecipeLines', () => {

        test.each(['', 'a', 'a\n', 'a\r\nb', 'a\r\n\nb\n', '\n'])('round-trip %j exactly', (recipeText) => {

            expect(RecipeCockpitRecipeWriter.joinRecipeLines(RecipeCockpitRecipeWriter.splitRecipeLines(recipeText))).toBe(recipeText);

        });

    });

    describe('extractObjectBlock, the one-object recipe a Create runs (#180)', () => {

        const SELF_LOOKUP_RECIPE_FIXTURE: [string, string] = ['faker-js self-lookup', 'recipe-fakerjs-selfLookup--RelationshipTree_1.yml'];

        // EVERY OCCURRENCE OF AN OBJECT IN THE PARSED RECIPE, AT ANY friends: DEPTH
        const findParsedEntries = (parsedEntries: any[], objectApiName: string): any[] => (parsedEntries ?? []).flatMap((parsedEntry: any) => [
            ...( parsedEntry?.object === objectApiName ? [parsedEntry] : [] ),
            ...findParsedEntries(parsedEntry?.friends, objectApiName)
        ]);

        describe.each([...ALL_RECIPE_FIXTURES, SELF_LOOKUP_RECIPE_FIXTURE])('%s', (_backendLabel, fixtureFileName) => {

            const recipeText = fs.readFileSync(path.join(RECIPE_WRITER_MOCKS_PATH, fixtureFileName), 'utf-8');
            const parsedRecipe = yaml.load(recipeText) as any[];
            const scannedObjects = RecipeCockpitRecipeWriter.scanRecipeObjects(RecipeCockpitRecipeWriter.splitRecipeLines(recipeText).lines);

            it('cuts every object, at any depth, into a recipe of that one object with its own fields and the count asked for', () => {

                scannedObjects.forEach(scannedObject => {

                    const isWrittenTwice = scannedObjects.filter(otherObject => otherObject.objectApiName === scannedObject.objectApiName).length > 1;
                    const objectNickname = isWrittenTwice ? scannedObject.nicknames[0] : undefined;

                    const extraction = RecipeCockpitRecipeWriter.extractObjectBlock(recipeText, scannedObject.objectApiName, 7, objectNickname);

                    if ( !extraction.isExtracted ) {
                        throw new Error(`${scannedObject.objectApiName}: ${'refusal' in extraction ? extraction.refusal.message : ''}`);
                    }

                    const extractedEntries = yaml.load(extraction.recipeText) as any[];
                    const originalEntry = findParsedEntries(parsedRecipe, scannedObject.objectApiName)
                        .find((parsedEntry: any) => parsedEntry.nickname === scannedObject.nicknames[0]);

                    expect(extractedEntries).toHaveLength(1);
                    expect(extractedEntries[0].object).toBe(scannedObject.objectApiName);
                    expect(extractedEntries[0].count).toBe(7);
                    expect(extractedEntries[0].friends).toBeUndefined();
                    expect(extractedEntries[0].nickname).toBe(originalEntry.nickname);
                    expect(extractedEntries[0].fields).toEqual(originalEntry.fields);
                    // AT COLUMN ZERO, WHATEVER DEPTH IT WAS CUT FROM, SO THE SCAN READS ONE TOP-LEVEL OBJECT
                    expect(RecipeCockpitRecipeWriter.scanRecipeObjects(extraction.recipeText.split('\n')).map(extracted => [extracted.objectApiName, extracted.objectIndent]))
                        .toEqual([[scannedObject.objectApiName, 0]]);

                });

            });

            it('keeps the generator\'s comments inside the block', () => {

                const objectWithTodo = scannedObjects.find(scannedObject => {
                    const lines = recipeText.split(/\r?\n/);
                    return scannedObject.fields.some(scannedField => lines[scannedField.startIndex].includes('### TODO'));
                });
                const isWrittenTwice = scannedObjects.filter(otherObject => otherObject.objectApiName === objectWithTodo.objectApiName).length > 1;

                const extraction = RecipeCockpitRecipeWriter.extractObjectBlock(recipeText, objectWithTodo.objectApiName, 1, isWrittenTwice ? objectWithTodo.nicknames[0] : undefined);

                expect(extraction.isExtracted && extraction.recipeText).toContain('### TODO');

            });

        });

        it('leaves out the object\'s own friends: block, children and the self-lookup iteration alike', () => {

            const recipeText = fs.readFileSync(path.join(RECIPE_WRITER_MOCKS_PATH, NESTED_RECIPE_FIXTURE[1]), 'utf-8');

            const extraction = RecipeCockpitRecipeWriter.extractObjectBlock(recipeText, 'Account', 3);

            expect(extraction.isExtracted).toBe(true);
            const extractedText = extraction.isExtracted ? extraction.recipeText : '';
            expect(extractedText).not.toContain('friends:');
            expect(extractedText).not.toContain('- object: Contact');
            expect(extractedText.match(/- object:/g)).toHaveLength(1);

        });

        it('picks an object written twice by its nickname, and refuses it without one', () => {

            const recipeText = fs.readFileSync(path.join(RECIPE_WRITER_MOCKS_PATH, 'recipe-fakerjs-selfLookup--RelationshipTree_1.yml'), 'utf-8');
            const duplicatedObject = RecipeCockpitRecipeWriter.scanRecipeObjects(recipeText.split(/\r?\n/))
                .find((scannedObject, _index, scannedObjects) => scannedObjects.filter(other => other.objectApiName === scannedObject.objectApiName).length > 1);

            const refused = RecipeCockpitRecipeWriter.extractObjectBlock(recipeText, duplicatedObject.objectApiName, 1);
            const picked = RecipeCockpitRecipeWriter.extractObjectBlock(recipeText, duplicatedObject.objectApiName, 1, duplicatedObject.nicknames[0]);

            expect('refusal' in refused && refused.refusal.reason).toBe('duplicate-object');
            expect(picked.isExtracted).toBe(true);

        });

        it.each([
            ['zero', 0],
            ['a fraction', 2.5],
            ['a negative count', -1],
            ['not a number', Number.NaN]
        ])('refuses %s as the count', (_description, recordCount) => {

            const extraction = RecipeCockpitRecipeWriter.extractObjectBlock('- object: Lead\n  nickname: Lead_NickName\n  count: 1\n  fields:\n    Company: x\n', 'Lead', recordCount);

            expect('refusal' in extraction && extraction.refusal.reason).toBe('invalid-value');

        });

        it('refuses an object the recipe does not have, a name that is not an api name, and a block with no count line', () => {

            const recipeText = '- object: Lead\n  nickname: Lead_NickName\n  fields:\n    Company: x\n';
            const reasonOf = (extraction: any) => extraction.refusal?.reason;

            expect(reasonOf(RecipeCockpitRecipeWriter.extractObjectBlock(recipeText, 'Contact', 1))).toBe('object-not-found');
            expect(reasonOf(RecipeCockpitRecipeWriter.extractObjectBlock(recipeText, 'Lead\n- object: Evil', 1))).toBe('invalid-object-api-name');
            expect(reasonOf(RecipeCockpitRecipeWriter.extractObjectBlock(recipeText, 'Lead', 1))).toBe('property-not-found');

        });

    });

    describe('listCreateBlockFieldApiNames, the fields a Create would send (#210)', () => {

        const NESTED_ACCOUNT_RECIPE = [
            '- object: Account',
            '  nickname: Account_NickName',
            '  count: 1',
            '  fields:',
            '    Name: ${{ faker.company.name() }}',
            '    RecordTypeId: Account.Business',
            '    ### TODO -- pick one',
            '    Description: |',
            '      two lines',
            '  friends:',
            '    - object: Contact',
            '      nickname: Contact_Account_NickName',
            '      count: 1',
            '      fields:',
            '        LastName: x',
            '        AccountId: Account_NickName',
            ''
        ].join('\n');

        it('lists the cut block\'s own fields in order, standard mappings and RecordTypeId included, and no friend\'s', () => {

            expect(RecipeCockpitRecipeWriter.listCreateBlockFieldApiNames(NESTED_ACCOUNT_RECIPE, 'Account'))
                .toEqual({ isListed: true, fieldApiNames: ['Name', 'RecordTypeId', 'Description'] });

            expect(RecipeCockpitRecipeWriter.listCreateBlockFieldApiNames(NESTED_ACCOUNT_RECIPE, 'Contact'))
                .toEqual({ isListed: true, fieldApiNames: ['LastName', 'AccountId'] });

        });

        it('leaves out a field the cockpit commented out', () => {

            const commented = RecipeCockpitRecipeWriter.commentOutField(NESTED_ACCOUNT_RECIPE, 'Account', 'RecordTypeId', 'not in org');
            const commentedRecipeText = commented.isApplied ? commented.recipeText : '';

            expect(commentedRecipeText).toContain('FIELD COMMENTED OUT');
            expect(RecipeCockpitRecipeWriter.listCreateBlockFieldApiNames(commentedRecipeText, 'Account'))
                .toEqual({ isListed: true, fieldApiNames: ['Name', 'Description'] });

        });

        it('lists the same fields extractObjectBlock\'s cut carries, in every fixture', () => {

            [...ALL_RECIPE_FIXTURES, ['self-lookup', 'recipe-fakerjs-selfLookup--RelationshipTree_1.yml']].forEach(([, fixtureFileName]) => {

                const recipeText = fs.readFileSync(path.join(RECIPE_WRITER_MOCKS_PATH, fixtureFileName), 'utf-8');
                const scannedObjects = RecipeCockpitRecipeWriter.scanRecipeObjects(RecipeCockpitRecipeWriter.splitRecipeLines(recipeText).lines);

                scannedObjects.forEach(scannedObject => {
                    const isWrittenTwice = scannedObjects.filter(otherObject => otherObject.objectApiName === scannedObject.objectApiName).length > 1;
                    const listed = RecipeCockpitRecipeWriter.listCreateBlockFieldApiNames(recipeText, scannedObject.objectApiName, isWrittenTwice ? scannedObject.nicknames[0] : undefined);

                    expect(listed).toEqual({ isListed: true, fieldApiNames: scannedObject.fields.map(scannedField => scannedField.fieldApiName) });
                });

            });

        });

        it('answers a block that cannot be cut with the cut\'s refusal', () => {

            const reasonOf = (listed: any) => listed.refusal?.reason;
            const doubled = `${NESTED_ACCOUNT_RECIPE}${NESTED_ACCOUNT_RECIPE.replace('Account_NickName', 'Second_NickName')}`;

            expect(reasonOf(RecipeCockpitRecipeWriter.listCreateBlockFieldApiNames(NESTED_ACCOUNT_RECIPE, 'Lead'))).toBe('object-not-found');
            expect(reasonOf(RecipeCockpitRecipeWriter.listCreateBlockFieldApiNames(doubled, 'Account'))).toBe('duplicate-object');
            expect(reasonOf(RecipeCockpitRecipeWriter.listCreateBlockFieldApiNames('- object: Lead\n  fields:\n    Company: x\n', 'Lead'))).toBe('property-not-found');

        });

    });

    describe('insertFriend, a friend added under a self-lookup iteration (#197)', () => {

        const FRIENDS_FIXTURE = 'recipe-fakerjs-selfLookupFriends--RelationshipTree_1.yml';
        const friendsRecipeText = readFixture(FRIENDS_FIXTURE);
        const ITERATION_NICKNAME = 'Account_child_NickName';

        const scanIteration = (recipeText: string, nickname = ITERATION_NICKNAME) => {
            const scannedObjects = RecipeCockpitRecipeWriter.scanRecipeObjects(RecipeCockpitRecipeWriter.splitRecipeLines(recipeText).lines);
            return { scannedObjects: scannedObjects, iteration: scannedObjects.find(scannedObject => scannedObject.nicknames.includes(nickname)) };
        };

        const insertableFriendsOf = (recipeText: string, nickname = ITERATION_NICKNAME) => {
            const { scannedObjects, iteration } = scanIteration(recipeText, nickname);
            return RecipeCockpitRecipeWriter.listInsertableFriendObjectApiNames(scannedObjects, iteration);
        };

        it('writes the friend under a new friends: block at the iteration\'s depth plus one, its lookup to the object pointed at the iteration', () => {

            const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.insertFriend(friendsRecipeText, 'Account', ITERATION_NICKNAME, 'Contact'));

            expect(edit).toMatchObject({ operation: 'insert-friend', objectApiName: 'Account', objectNickname: ITERATION_NICKNAME, friendObjectApiName: 'Contact', friendNickname: 'Contact_child_NickName', removedLines: [] });
            expect(friendsRecipeText.split('\n')[edit.startLineNumber - 2]).toBe('        ParentId: Account_NickName');
            // THE COPY KEEPS THE TODO AND THE READER'S OWN COMMENT, AND LEAVES THE CONTACT'S OWN Case BEHIND
            expect(edit.insertedLines).toEqual([
                '      friends:',
                '        # Contact (Added by the Recipe Cockpit under Account_child_NickName, copied from the Contact under Account_NickName)',
                '        - object: Contact',
                '          nickname: Contact_child_NickName',
                '          count: 2',
                '          fields:',
                '            LastName: ${{ faker.person.lastName() }}',
                '            AccountId: Account_child_NickName',
                '            ReportsToId: ### TODO -- REFERENCE ID REQUIRED -- Contact',
                '            ### TODO -- the reader\'s own note about Contact'
            ]);
            expectFidelity(friendsRecipeText, patchedRecipeText, edit);

        });

        it('appends a second friend to the iteration\'s friends: block, and offers only what the iteration does not carry yet', () => {

            expect(insertableFriendsOf(friendsRecipeText)).toEqual(['Contact', 'Opportunity']);

            const { recipeText: withContactText } = expectApplied(RecipeCockpitRecipeWriter.insertFriend(friendsRecipeText, 'Account', ITERATION_NICKNAME, 'Contact'));
            expect(insertableFriendsOf(withContactText)).toEqual(['Opportunity']);

            const { recipeText: withBothText, edit } = expectApplied(RecipeCockpitRecipeWriter.insertFriend(withContactText, 'Account', ITERATION_NICKNAME, 'Opportunity'));
            expect(insertableFriendsOf(withBothText)).toEqual([]);

            expect(edit.insertedLines[0]).toBe('        # Opportunity (Added by the Recipe Cockpit under Account_child_NickName, copied from the Opportunity under Account_NickName)');
            // A BLOCK SCALAR MOVES WITH ITS FIELD, ITS RELATIVE INDENTATION KEPT
            expect(edit.insertedLines.slice(1)).toEqual([
                '        - object: Opportunity',
                '          nickname: Opportunity_child_NickName',
                '          count: 1',
                '          fields:',
                '            Name: ${{ faker.commerce.productName() }}',
                '            AccountId: Account_child_NickName',
                '            Description: |',
                '              ${{ faker.lorem.paragraph() }}',
                '            StageName: Prospecting'
            ]);
            expectFidelity(withContactText, withBothText, edit);

            const { scannedObjects, iteration } = scanIteration(withBothText);
            expect(scannedObjects.filter(scannedObject => scannedObject.parentHeaderIndex === iteration.headerIndex).map(scannedObject => scannedObject.nicknames)).toEqual([
                ['Contact_child_NickName'], ['Opportunity_child_NickName']
            ]);

        });

        it('loads as YAML with the friend nested under the iteration, and the cockpit reader keeps every occurrence apart', () => {

            const { recipeText: patchedRecipeText } = expectApplied(RecipeCockpitRecipeWriter.insertFriend(friendsRecipeText, 'Account', ITERATION_NICKNAME, 'Contact'));

            const [account] = yaml.load(patchedRecipeText) as any[];
            const iteration = account.friends.find((friend: any) => friend.nickname === ITERATION_NICKNAME);

            expect(iteration.friends).toEqual([{
                object: 'Contact',
                nickname: 'Contact_child_NickName',
                count: 2,
                fields: { LastName: '${{ faker.person.lastName() }}', AccountId: ITERATION_NICKNAME, ReportsToId: null }
            }]);

            const contactEntry = RecipeCockpitService.parseRecipeSource(patchedRecipeText).get('Contact');
            expect(contactEntry.nickname).toBe('Contact_NickName');
            expect(contactEntry.iterations).toEqual([expect.objectContaining({
                nickname: 'Contact_child_NickName',
                parentObjectApiName: 'Account',
                parentNickname: ITERATION_NICKNAME
            })]);
            expect(contactEntry.iterations[0]).not.toHaveProperty('insertableFriendObjectApiNames');

        });

        it('keeps a lookup to an ancestor above the top occurrence, which is the iteration\'s ancestor too', () => {

            const nestedText = [
                '- object: Region__c',
                '  nickname: Region__c_NickName',
                '  fields:',
                '    Name: r',
                '  friends:',
                '    - object: Account',
                '      nickname: Account_NickName',
                '      fields:',
                '        Region__c: Region__c_NickName',
                '      friends:',
                '        - object: Contact',
                '          nickname: Contact_NickName',
                '          fields:',
                '            AccountId: Account_NickName',
                '            Region__c: Region__c_NickName',
                '        - object: Account',
                '          nickname: Account_child_NickName',
                '          fields:',
                '            ParentId: Account_NickName',
                ''
            ].join('\n');

            const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.insertFriend(nestedText, 'Account', ITERATION_NICKNAME, 'Contact'));

            expect(edit.insertedLines.slice(2)).toEqual([
                '            - object: Contact',
                '              nickname: Contact_child_NickName',
                '              fields:',
                '                AccountId: Account_child_NickName',
                '                Region__c: Region__c_NickName'
            ]);
            expectFidelity(nestedText, patchedRecipeText, edit);

        });

        it('copies a blank line inside the friend\'s block as a blank line', () => {

            const blankLineText = friendsRecipeText.replace('        LastName: ${{ faker.person.lastName() }}\n', '        LastName: ${{ faker.person.lastName() }}\n\n');
            const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.insertFriend(blankLineText, 'Account', ITERATION_NICKNAME, 'Contact'));

            expect(edit.insertedLines.slice(6, 9)).toEqual(['            LastName: ${{ faker.person.lastName() }}', '', '            AccountId: Account_child_NickName']);
            expectFidelity(blankLineText, patchedRecipeText, edit);

        });

        it('gives the copy a nickname no occurrence in the file holds', () => {

            const heldText = friendsRecipeText.replace('nickname: Lead_NickName', 'nickname: Contact_child_NickName');
            const doublyHeldText = heldText.replace('nickname: Case_NickName', 'nickname: Contact_child_NickName_2');

            expect(expectApplied(RecipeCockpitRecipeWriter.insertFriend(heldText, 'Account', ITERATION_NICKNAME, 'Contact')).edit.friendNickname).toBe('Contact_child_NickName_2');
            expect(expectApplied(RecipeCockpitRecipeWriter.insertFriend(doublyHeldText, 'Account', ITERATION_NICKNAME, 'Contact')).edit.friendNickname).toBe('Contact_child_NickName_3');
            expect(expectApplied(RecipeCockpitRecipeWriter.insertFriend(friendsRecipeText.replace('nickname: Contact_NickName', 'nickname: Branch_Contact'), 'Account', ITERATION_NICKNAME, 'Contact')).edit.friendNickname).toBe('Branch_Contact_child');

        });

        describe.each(LINE_ENDING_VARIANTS)('with %s', (_variantName, lineEnding, hasFinalNewline) => {

            it.each([
                ['an iteration followed by another object', FRIENDS_FIXTURE],
                ['an iteration on the last lines of the file', 'recipe-fakerjs-selfLookup--RelationshipTree_1.yml']
            ])('inserts under %s leaving every other line byte-identical', (_fixtureDescription, fileName) => {

                const variantText = toVariant(readFixture(fileName), lineEnding, hasFinalNewline);
                const { recipeText: patchedRecipeText, edit } = expectApplied(RecipeCockpitRecipeWriter.insertFriend(variantText, 'Account', ITERATION_NICKNAME, 'Contact'));

                expectFidelity(variantText, patchedRecipeText, edit);
                expect(insertableFriendsOf(patchedRecipeText)).toEqual(insertableFriendsOf(variantText).filter(friendObjectApiName => friendObjectApiName !== 'Contact'));

            });

        });

        describe('refusals', () => {

            const insertInto = (recipeText: string, objectApiName: string, nickname: string, friendObjectApiName: string) => RecipeCockpitRecipeWriter.insertFriend(recipeText, objectApiName, nickname, friendObjectApiName);

            it.each<[string, string, string, string, RecipeWriterRefusalReason]>([
                ['a friend name that is not an api name', 'Account', ITERATION_NICKNAME, 'Contact\n- object: Evil', 'invalid-friend-object-api-name'],
                ['an object name that is not an api name', 'Account\n- object: Evil', ITERATION_NICKNAME, 'Contact', 'invalid-object-api-name'],
                ['a nickname that is not one', 'Account', 'Account child', 'Contact', 'invalid-object-nickname'],
                ['an empty nickname', 'Account', '', 'Contact', 'invalid-object-nickname'],
                ['a nickname no occurrence carries', 'Account', 'Account_Missing_NickName', 'Contact', 'object-not-found'],
                ['the top occurrence, which is not nested under its own object', 'Account', 'Account_NickName', 'Contact', 'not-a-self-lookup-iteration'],
                ['a friend that is not an iteration of its own object', 'Contact', 'Contact_NickName', 'Case', 'not-a-self-lookup-iteration'],
                ['an object the top occurrence has no friend of', 'Account', ITERATION_NICKNAME, 'Lead', 'friend-not-found'],
                ['the iteration\'s own object', 'Account', ITERATION_NICKNAME, 'Account', 'friend-not-found'],
                ['a grandchild, which is not the top occurrence\'s own friend', 'Account', ITERATION_NICKNAME, 'Case', 'friend-not-found']
            ])('refuses %s', (_description, objectApiName, nickname, friendObjectApiName, expectedReason) => {

                const result = insertInto(friendsRecipeText, objectApiName, nickname, friendObjectApiName);

                expectRefused(result, expectedReason);
                expect('refusal' in result && result.refusal.friendObjectApiName).toBe(friendObjectApiName);

            });

            it('refuses an iteration nickname two occurrences share, and a friend the iteration already carries', () => {

                const sharedNicknameText = friendsRecipeText.replace('nickname: Lead_NickName', `nickname: ${ITERATION_NICKNAME}`).replace('- object: Lead', '- object: Account');
                const { recipeText: withContactText } = expectApplied(insertInto(friendsRecipeText, 'Account', ITERATION_NICKNAME, 'Contact'));

                expectRefused(insertInto(sharedNicknameText, 'Account', ITERATION_NICKNAME, 'Contact'), 'duplicate-object');
                expectRefused(insertInto(withContactText, 'Account', ITERATION_NICKNAME, 'Contact'), 'friend-already-exists');

            });

            it('refuses a friend the top occurrence carries twice, which could be either block', () => {

                const twiceText = friendsRecipeText.replace('    # Opportunity (Parents: Account)\n    - object: Opportunity\n      nickname: Opportunity_NickName', '    # Opportunity (Parents: Account)\n    - object: Contact\n      nickname: Contact_Second_NickName');

                expectRefused(insertInto(twiceText, 'Account', ITERATION_NICKNAME, 'Contact'), 'duplicate-friend');
                expect(insertableFriendsOf(twiceText)).toEqual([]);

            });

            it('refuses an iteration with two friends: lines, and one whose friends: block is not its last', () => {

                const iterationTail = '        ParentId: Account_NickName\n';
                const twoBlocksText = friendsRecipeText.replace(iterationTail, `${iterationTail}      friends:\n      friends:\n`);
                const propertyAfterFriendsText = friendsRecipeText.replace(iterationTail, `${iterationTail}      friends:\n        - object: Task\n          nickname: Task_NickName\n          fields:\n            Subject: s\n      count: 3\n`);

                expectRefused(insertInto(twoBlocksText, 'Account', ITERATION_NICKNAME, 'Contact'), 'duplicate-friends-block');
                expect(insertableFriendsOf(twoBlocksText)).toEqual([]);
                expectRefused(insertInto(propertyAfterFriendsText, 'Account', ITERATION_NICKNAME, 'Contact'), 'unsupported-friend-layout');

            });

            it('refuses a friend block with no nickname, and a top occurrence with none, since neither copy could be wired', () => {

                const noFriendNicknameText = friendsRecipeText.replace('      nickname: Contact_NickName\n', '');
                const noTopNicknameText = friendsRecipeText.replace('  nickname: Account_NickName\n', '');

                expectRefused(insertInto(noFriendNicknameText, 'Account', ITERATION_NICKNAME, 'Contact'), 'unsupported-friend-layout');
                expect(insertableFriendsOf(noFriendNicknameText)).toEqual(['Opportunity']);
                expectRefused(insertInto(noTopNicknameText, 'Account', ITERATION_NICKNAME, 'Contact'), 'unsupported-friend-layout');
                expect(insertableFriendsOf(noTopNicknameText)).toEqual([]);

            });

            it('refuses a friend block, or a top occurrence, with two nickname lines', () => {

                expectRefused(insertInto(friendsRecipeText.replace('      nickname: Contact_NickName\n', '      nickname: Contact_NickName\n      nickname: Contact_Other_NickName\n'), 'Account', ITERATION_NICKNAME, 'Contact'), 'unsupported-friend-layout');
                expectRefused(insertInto(friendsRecipeText.replace('  nickname: Account_NickName\n', '  nickname: Account_NickName\n  nickname: Account_Other_NickName\n'), 'Account', ITERATION_NICKNAME, 'Contact'), 'unsupported-friend-layout');

            });

            // YAML BREAKS A LINE WHERE THE JS SPLIT DOES NOT, SO TEXT AFTER THE BREAK WOULD KEEP ITS OLD COLUMN AND COULD LEAVE THE BLOCK SCALAR
            it.each([
                ['a lone carriage return', '\r'],
                ['U+0085', '\u0085'],
                ['U+2028', '\u2028'],
                ['U+2029', '\u2029']
            ])('refuses a friend block carrying %s inside a line, rather than moving part of it a level deeper', (_description, lineBreak) => {

                const hiddenBreakText = friendsRecipeText.replace(
                    '          ${{ faker.lorem.paragraph() }}\n',
                    `          \${{ faker.lorem.paragraph() }}${lineBreak}            Injected: \${{ 'X' }}\n`
                );

                expect(hiddenBreakText).not.toBe(friendsRecipeText);
                expectRefused(insertInto(hiddenBreakText, 'Account', ITERATION_NICKNAME, 'Opportunity'), 'unsupported-friend-layout');
                expectApplied(insertInto(hiddenBreakText, 'Account', ITERATION_NICKNAME, 'Contact'));

            });

            it('refuses a friend whose nickname no api-name-shaped nickname can be made from, and does not offer it', () => {

                const digitNicknameText = friendsRecipeText.replace('nickname: Contact_NickName', 'nickname: 9Contact');

                expectRefused(insertInto(digitNicknameText, 'Account', ITERATION_NICKNAME, 'Contact'), 'unsupported-friend-layout');
                expect(insertableFriendsOf(digitNicknameText)).toEqual(['Opportunity']);

            });

        });

    });

});
