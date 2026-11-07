import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { FakerJSRecipeProcessor } from '../FakerJSRecipeProcessor';
import { ErrorHandlingService } from '../../../ErrorHandlingService/ErrorHandlingService';

jest.mock('vscode', () => ({}), { virtual: true });

// #593: YAML ENDS A `|` BLOCK WITH A LINE BREAK THAT IS NO PART OF THE VALUE FAKER PRODUCES
describe('FakerJSRecipeProcessor.loadRecipeYaml', () => {

    const loadFieldValue = (fieldValueYaml: string): unknown => {
        const recipeYaml = `- object: Example_Everything__c\n  fields:\n    Field__c: ${fieldValueYaml}`;
        const loadedRecipe = FakerJSRecipeProcessor.loadRecipeYaml(recipeYaml) as Array<{ fields: Record<string, unknown> }>;
        return loadedRecipe[0].fields.Field__c;
    };

    test.each([
        ['a Date written by Generate Treecipe', "|\n      ${{ faker.date.anytime() }}\n", '${{ faker.date.anytime() }}'],
        ['a Currency with precision and scale', "|\n      ${{ faker.finance.amount({min: 0, max: 999, dec: 2}) }}\n", '${{ faker.finance.amount({min: 0, max: 999, dec: 2}) }}'],
        ['the last block in the file, with no final line break', "|\n      ${{ faker.phone.number() }}", '${{ faker.phone.number() }}'],
        ['an indentation digit and a comment on the header', "|2 # phone\n      ${{ faker.phone.number() }}\n", '${{ faker.phone.number() }}'],
        ['a tag before the header', "!!str |\n      ${{ faker.number.int() }}\n", '${{ faker.number.int() }}'],
        ['text around the expression', "|\n      +1 ${{ faker.phone.number() }} ext\n", '+1 ${{ faker.phone.number() }} ext'],
        ['a multi-line block, which keeps its inner line break', "|\n      a ${{ faker.word.noun() }}\n      b\n", 'a ${{ faker.word.noun() }}\nb']
    ])('drops the one line break a `|` block adds: %s', (_case, fieldValueYaml, expectedValue) => {

        expect(loadFieldValue(fieldValueYaml)).toBe(expectedValue);

    });

    test.each([
        ['a `|+` block keeps every line break', "|+\n      ${{ faker.number.int() }}\n", '${{ faker.number.int() }}\n'],
        ['a `|+` block with an indentation digit', "|2+\n      ${{ faker.number.int() }}\n\n", '${{ faker.number.int() }}\n\n'],
        ['a `|-` block already has none', "|-\n      ${{ faker.number.int() }}\n", '${{ faker.number.int() }}'],
        ['a folded block', ">\n      ${{ faker.number.int() }}\n", '${{ faker.number.int() }}\n'],
        ['a quoted value with a written line break', "\"${{ faker.number.int() }}\\n\"\n", '${{ faker.number.int() }}\n'],
        ['a `|` block with no expression', "|\n      plain text\n", 'plain text\n']
    ])('loads the value as written: %s', (_case, fieldValueYaml, expectedValue) => {

        expect(loadFieldValue(fieldValueYaml)).toBe(expectedValue);

    });

    // THE HEADER CHECK BACKTRACKED 2^n TIMES ON A RUN OF n `#`: 22 TOOK OVER 100 ms, 28 TAKES SECONDS.
    // A REGEX CANNOT BE INTERRUPTED, SO A LONGER RUN WOULD HANG THE SUITE RATHER THAN FAIL IT.
    test('a long comment before a quoted value loads at once, as written', () => {

        const recipeYaml = `- object: Account\n  fields:\n    Name: ${'#'.repeat(28)}\n      "\${{ faker.company.name() }}\\n"\n`;

        const loadStartedAt = Date.now();
        const loadedRecipe = FakerJSRecipeProcessor.loadRecipeYaml(recipeYaml) as Array<{ fields: Record<string, unknown> }>;

        expect(Date.now() - loadStartedAt).toBeLessThan(1000);
        expect(loadedRecipe[0].fields.Name).toBe('${{ faker.company.name() }}\n');

    });

    test('a comment between the key and the `|` header still drops the line break', () => {

        expect(loadFieldValue("# a phone\n      |\n      ${{ faker.phone.number() }}\n")).toBe('${{ faker.phone.number() }}');

    });

    test('reads a `|` block the same in a var and in a nested friends block', () => {

        const recipeYaml = [
            '- var: shared_amount',
            '  value: |',
            '    ${{ faker.number.int() }}',
            '- object: Account',
            '  fields:',
            '    Name: Acme',
            '  friends:',
            '    - object: Contact',
            '      fields:',
            '        Birthdate: |',
            '          ${{ faker.date.past() }}',
            ''
        ].join('\n');

        const loadedRecipe = FakerJSRecipeProcessor.loadRecipeYaml(recipeYaml) as any[];

        expect(loadedRecipe[0].value).toBe('${{ faker.number.int() }}');
        expect(loadedRecipe[1].friends[0].fields.Birthdate).toBe('${{ faker.date.past() }}');

    });

});

describe('FakerJSRecipeProcessor.generateFakeDataBySelectedRecipeFile with `|` blocks', () => {

    let recipeDirectoryPath: string;

    beforeEach(() => {
        recipeDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-literal-block-'));
    });

    afterEach(() => {
        fs.rmSync(recipeDirectoryPath, { recursive: true, force: true });
    });

    const writeRecipe = (recipeYaml: string): string => {
        const recipeFilePath = path.join(recipeDirectoryPath, 'recipe-Example_Everything__c.yaml');
        fs.writeFileSync(recipeFilePath, recipeYaml, 'utf8');
        return recipeFilePath;
    };

    // THE SHAPE GENERATE TREECIPE HAS ALWAYS WRITTEN, SO A RECIPE MADE BEFORE #593 IS COVERED TOO
    test('a recipe generated before the fix gives values with no trailing line break', async () => {

        const recipeFilePath = writeRecipe([
            '- object: Example_Everything__c',
            '  nickname: Example_Everything__c_NickName',
            '  fields:',
            '    Date__c: |',
            "      ${{ faker.date.past({ years: 1 }).toISOString().split('T')[0] }}",
            '    Number__c: |',
            '      ${{ faker.number.int({min: 0, max: 999}) }}',
            '    Phone__c: |',
            '      ${{ faker.phone.number() }}',
            ''
        ].join('\n'));

        const generatedJson = await new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath);
        const generatedFields = JSON.parse(generatedJson)[0].fields;

        expect(generatedFields.Date__c).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(generatedFields.Number__c).toMatch(/^\d{1,3}$/);
        expect(generatedFields.Phone__c).not.toMatch(/\n$/);

    });

    test('an expression that throws still reports FakerJSExpressionEvaluationError', async () => {

        jest.spyOn(ErrorHandlingService, 'createFakerExpressionEvaluationErrorCaptureFile').mockImplementation(() => undefined);
        const recipeFilePath = writeRecipe([
            '- object: Example_Everything__c',
            '  nickname: Example_Everything__c_NickName',
            '  fields:',
            '    Date__c: |',
            '      ${{ faker.date.notAFakerMethod() }}',
            ''
        ].join('\n'));

        await expect(new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath))
            .rejects.toMatchObject({ name: 'FakerJSExpressionEvaluationError' });
        expect(ErrorHandlingService.createFakerExpressionEvaluationErrorCaptureFile).toHaveBeenCalledTimes(1);

    });

});
