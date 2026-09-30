import * as yaml from 'js-yaml';
import { RecipeYamlScalar } from '../RecipeYamlScalar';
import {
    ANY_YAML_LINE_BREAK,
    HOSTILE_PICKLIST_VALUES,
    LINE_BREAK_BY_NAME,
    ORDINARY_PICKLIST_VALUES,
    isPythonModuleAvailable,
    loadWithPyYaml
} from './mocks/HostilePicklistValues';

const isPyYamlAvailable = isPythonModuleAvailable('yaml');

describe('RecipeYamlScalar', () => {

    describe('escapeNonPrintableCharacters', () => {

        test.each(Object.entries(LINE_BREAK_BY_NAME))('leaves no %s line break for either YAML parser to see', (unusedLineBreakName, lineBreak) => {

            const escapedText = RecipeYamlScalar.escapeNonPrintableCharacters(`a${lineBreak}b`);

            expect(escapedText.split(ANY_YAML_LINE_BREAK)).toHaveLength(1);

        });

        test('keeps the short forms for \\n and \\r and writes everything else as \\uXXXX', () => {

            expect(RecipeYamlScalar.escapeNonPrintableCharacters('a\r\nb')).toBe('a\\r\\nb');
            expect(RecipeYamlScalar.escapeNonPrintableCharacters('a\u0085b\u2028c\u2029d\te\u0000f')).toBe('a\\u0085b\\u2028c\\u2029d\\u0009e\\u0000f');

        });

        test('leaves printable text, including non-ASCII, unchanged', () => {

            expect(RecipeYamlScalar.escapeNonPrintableCharacters("Rock 'n' Roll — café & C#")).toBe("Rock 'n' Roll — café & C#");

        });

    });

    describe('isSafeAsPlainScalar', () => {

        test.each(ORDINARY_PICKLIST_VALUES)('accepts the ordinary value %p, so it is written exactly as before', (ordinaryValue) => {

            expect(RecipeYamlScalar.isSafeAsPlainScalar(ordinaryValue)).toBe(true);

        });

        test.each([
            ['empty', ''],
            ['leading whitespace', ' a'],
            ['trailing whitespace', 'a '],
            ['a leading list indicator', '- a'],
            ['a leading flow indicator', '[a]'],
            ['a leading alias', '*a'],
            ['a leading quote', "'a"],
            ['a colon-space', 'a: b'],
            ['a space-hash', 'a #b'],
            ['a trailing colon', 'a:'],
            ['a snowfakery template', '${{ x }}'],
            ['a Jinja block', '{% x %}'],
            ['a tab', 'a\tb'],
            ...HOSTILE_PICKLIST_VALUES.filter(([, hostileValue]) => ANY_YAML_LINE_BREAK.test(hostileValue))
        ])('rejects a value with %s', (unusedDescription, unsafeValue) => {

            expect(RecipeYamlScalar.isSafeAsPlainScalar(unsafeValue)).toBe(false);

        });

    });

    describe('toDoubleQuotedScalar', () => {

        const everyValue = [...HOSTILE_PICKLIST_VALUES.map(([, hostileValue]) => hostileValue), ...ORDINARY_PICKLIST_VALUES, 'say "hi"\\'];

        test('is one line, and js-yaml loads it back as exactly the value', () => {

            everyValue.forEach(value => {
                const quotedScalar = RecipeYamlScalar.toDoubleQuotedScalar(value);
                expect(quotedScalar.split(ANY_YAML_LINE_BREAK)).toHaveLength(1);
                expect(yaml.load(`- ${quotedScalar}`)).toEqual([value]);
            });

        });

        (isPyYamlAvailable ? test : test.skip)('PyYAML loads it back as exactly the value', () => {

            const loadedLists = loadWithPyYaml(everyValue.map(value => `- ${RecipeYamlScalar.toDoubleQuotedScalar(value)}`));

            expect(loadedLists).toEqual(everyValue.map(value => [value]));

        });

    });

    describe('escapeForComment', () => {

        test('keeps a value inside the comment it is written into', () => {

            HOSTILE_PICKLIST_VALUES.forEach(([, hostileValue]) => {
                expect(RecipeYamlScalar.escapeForComment(hostileValue).split(ANY_YAML_LINE_BREAK)).toHaveLength(1);
            });

        });

        test('changes nothing else', () => {

            ORDINARY_PICKLIST_VALUES.forEach(ordinaryValue => {
                expect(RecipeYamlScalar.escapeForComment(ordinaryValue)).toBe(ordinaryValue);
            });

        });

    });

});
