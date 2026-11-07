import { faker } from '@faker-js/faker';

import { FakerJSRecipeFakerService } from '../FakerJSRecipeFakerService';
import { FakerJSRecipeProcessor } from '../../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';

jest.mock('vscode', () => ({}), { virtual: true });

// #594: A DOUBLE HOLDS EVERY WHOLE NUMBER UP TO 15 DIGITS; A WIDER FIELD LOST ITS LOW DIGITS AND CENTS
describe('FakerJSRecipeFakerService numeric fields past 15 digits left of the decimal', () => {

    const fakerService = new FakerJSRecipeFakerService();
    const fakerProcessor = new FakerJSRecipeProcessor();

    const expressionOf = (recipeValue: string): string => recipeValue.replace(/^\|\s*\$\{\{\s*/, '').replace(/\s*\}\}$/, '');

    describe('recipe text', () => {

        // TODAY'S EXPRESSIONS, WRITTEN OUT, SO A NARROW FIELD'S RECIPE IS HELD BYTE FOR BYTE
        test.each([
            ['Number (15, 0)', () => fakerService.buildNumericRecipeValueWithPrecisionAndScale(15, 0), 'faker.number.int({min: 0, max: 999999999999999})'],
            ['Number (15) with no scale', () => fakerService.buildNumericRecipeValueWithPrecisionAndScale(15), 'faker.number.int({min: 0, max: 999999999999999})'],
            ['Number (17, 4)', () => fakerService.buildNumericRecipeValueWithPrecisionAndScale(17, 4), 'faker.finance.amount({min: 0, max: 9999999999999, dec: 4})'],
            ['Currency (16, 2)', () => fakerService.buildCurrencyRecipeValueWithPrecisionAndScale(16, 2), 'faker.finance.amount({min: 0, max: 99999999999999, dec: 2})'],
            ['Currency (15, 0)', () => fakerService.buildCurrencyRecipeValueWithPrecisionAndScale(15, 0), 'faker.finance.amount({min: 0, max: 999999999999999, dec: 0})']
        ])('%s keeps today\'s expression', (_field, buildRecipeValue, expectedExpression) => {

            expect(buildRecipeValue()).toBe(`|\n            \${{ ${expectedExpression} }}`);

        });

        test.each([
            ['Number (16, 0)', () => fakerService.buildNumericRecipeValueWithPrecisionAndScale(16, 0), "faker.number.bigInt({min: 0n, max: 9999999999999999n}).toString()"],
            ['Number (18) with no scale', () => fakerService.buildNumericRecipeValueWithPrecisionAndScale(18), "faker.number.bigInt({min: 0n, max: 999999999999999999n}).toString()"],
            ['Percent (18, 2), through the Number builder', () => fakerService.buildNumericRecipeValueWithPrecisionAndScale(18, 2), "faker.number.bigInt({min: 0n, max: 9999999999999999n}) + '.' + faker.string.numeric({length: 2, allowLeadingZeros: true})"],
            ['Currency (18, 2)', () => fakerService.buildCurrencyRecipeValueWithPrecisionAndScale(18, 2), "faker.number.bigInt({min: 0n, max: 9999999999999999n}) + '.' + faker.string.numeric({length: 2, allowLeadingZeros: true})"],
            ['Currency (18, 0)', () => fakerService.buildCurrencyRecipeValueWithPrecisionAndScale(18, 0), "faker.number.bigInt({min: 0n, max: 999999999999999999n}).toString()"]
        ])('%s draws its digits as a BigInt', (_field, buildRecipeValue, expectedExpression) => {

            expect(buildRecipeValue()).toBe(`|\n            \${{ ${expectedExpression} }}`);

        });

        // TODAY '9'.repeat(-1) THROWS; A WIDE FIELD MUST NOT TURN THAT INTO A RECIPE LINE
        test.each([
            ['Number', () => fakerService.buildNumericRecipeValueWithPrecisionAndScale(2, 4)],
            ['Currency', () => fakerService.buildCurrencyRecipeValueWithPrecisionAndScale(2, 4)]
        ])('a %s with scale greater than precision still throws', (_field, buildRecipeValue) => {

            expect(buildRecipeValue).toThrow(RangeError);

        });

    });

    describe('generated values', () => {

        beforeEach(() => {
            faker.seed(594);
        });

        test.each([
            ['Number (18, 0)', () => fakerService.buildNumericRecipeValueWithPrecisionAndScale(18, 0), /^\d{1,18}$/],
            ['Number (16, 0)', () => fakerService.buildNumericRecipeValueWithPrecisionAndScale(16, 0), /^\d{1,16}$/],
            ['Currency (18, 2)', () => fakerService.buildCurrencyRecipeValueWithPrecisionAndScale(18, 2), /^\d{1,16}\.\d{2}$/],
            ['Percent (18, 2)', () => fakerService.buildNumericRecipeValueWithPrecisionAndScale(18, 2), /^\d{1,16}\.\d{2}$/]
        ])('%s gives exact digits within the field, not rounded', (_field, buildRecipeValue, fieldShape) => {

            const fakerExpression = expressionOf(buildRecipeValue());
            const generatedValues = Array.from({ length: 1000 }, () => String(fakerProcessor.getFakerJSExpressionEvaluation(fakerExpression)));

            generatedValues.forEach(generatedValue => expect(generatedValue).toMatch(fieldShape));

            // A ROUNDED DOUBLE PAST 16 DIGITS ENDS IN 0 FAR MORE THAN ONE TIME IN TEN
            const wholeDigitsEndingInZero = generatedValues.filter(generatedValue => generatedValue.split('.')[0].endsWith('0')).length;
            expect(wholeDigitsEndingInZero).toBeLessThan(200);

            // AND A ROUNDED CURRENCY LOSES ITS CENTS TO .00
            const valuesEndingInNoCents = generatedValues.filter(generatedValue => generatedValue.endsWith('.00')).length;
            expect(valuesEndingInNoCents).toBeLessThan(50);

        });

    });

});
