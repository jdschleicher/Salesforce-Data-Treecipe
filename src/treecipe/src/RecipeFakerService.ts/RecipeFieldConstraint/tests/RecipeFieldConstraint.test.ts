import { RecipeFieldConstraint, IRecipeFieldConstraintTarget } from '../RecipeFieldConstraint';

const NOW = new Date('2026-10-14T12:00:00Z');

const numberTarget: IRecipeFieldConstraintTarget = { fieldType: 'Number', precision: 5, scale: 0 };
const currencyTarget: IRecipeFieldConstraintTarget = { fieldType: 'Currency', precision: 6, scale: 2 };
const textTarget: IRecipeFieldConstraintTarget = { fieldType: 'Text', length: 20 };
const dateTarget: IRecipeFieldConstraintTarget = { fieldType: 'Date' };
const dateTimeTarget: IRecipeFieldConstraintTarget = { fieldType: 'DateTime' };

describe('RecipeFieldConstraint', () => {

    describe('getConstraintKind', () => {

        test.each([
            ['Number', 'number'], ['Currency', 'number'], ['Percent', 'number'],
            ['Text', 'length'], ['TextArea', 'length'], ['LongTextArea', 'length'],
            ['Date', 'date'], ['DateTime', 'date'],
            ['Email', undefined], ['Phone', undefined], ['Url', undefined], ['Checkbox', undefined], ['Picklist', undefined], ['', undefined]
        ])('%s is %s', (fieldType, expectedKind) => {
            expect(RecipeFieldConstraint.getConstraintKind(fieldType)).toBe(expectedKind);
        });

    });

    describe('isStoredConstraint', () => {

        test.each([
            [{ min: '1' }, true],
            [{ max: '-30d' }, true],
            [{ min: '2026-01-01', max: '2026-01-02T10:00:00Z' }, true],
            [{ min: 'today' }, true],
            [{}, false],
            [null, false],
            [[], false],
            ['1', false],
            [{ min: 1 }, false],
            [{ min: '' }, false],
            [{ min: '${{ evil }}' }, false],
            [{ min: '1\n- object: X' }, false],
            [{ min: '1'.repeat(41) }, false]
        ])('%j is %s', (storedConstraint, expected) => {
            expect(RecipeFieldConstraint.isStoredConstraint(storedConstraint)).toBe(expected);
        });

    });

    describe('number', () => {

        test('both bounds typed resolve as typed, canonicalized', () => {
            expect(RecipeFieldConstraint.resolve(numberTarget, { min: '-0010', max: '00500' }))
                .toEqual({ constraint: { kind: 'number', min: '-10', max: '500', scale: 0 } });
        });

        test('-0 is 0', () => {
            expect(RecipeFieldConstraint.resolve(currencyTarget, { min: '-0.00', max: '5' }))
                .toEqual({ constraint: { kind: 'number', min: '0.00', max: '5', scale: 2 } });
        });

        test('an empty max is the precision ceiling', () => {
            expect(RecipeFieldConstraint.resolve(currencyTarget, { min: '10.5' }))
                .toEqual({ constraint: { kind: 'number', min: '10.5', max: '9999.99', scale: 2 } });
        });

        test('an empty min is 0, or the negative ceiling under a negative max', () => {
            expect(RecipeFieldConstraint.resolve(numberTarget, { max: '50' })).toEqual({ constraint: { kind: 'number', min: '0', max: '50', scale: 0 } });
            expect(RecipeFieldConstraint.resolve(numberTarget, { max: '-50' })).toEqual({ constraint: { kind: 'number', min: '-99999', max: '-50', scale: 0 } });
        });

        test('an unsized number defaults its max to the recipe default, or the digit ceiling above it', () => {
            expect(RecipeFieldConstraint.resolve({ fieldType: 'Number' }, { min: '5' })).toEqual({ constraint: { kind: 'number', min: '5', max: '999999', scale: 0 } });
            expect(RecipeFieldConstraint.resolve({ fieldType: 'Number' }, { min: '5000000' })).toEqual({ constraint: { kind: 'number', min: '5000000', max: '9'.repeat(15), scale: 0 } });
        });

        test('Number(2,2) takes 0.5 and caps at 0.99', () => {
            expect(RecipeFieldConstraint.resolve({ fieldType: 'Percent', precision: 2, scale: 2 }, { min: '0.5' }))
                .toEqual({ constraint: { kind: 'number', min: '0.5', max: '0.99', scale: 2 } });
        });

        test('min > max is refused', () => {
            expect(RecipeFieldConstraint.resolve(numberTarget, { min: '10', max: '5' })).toEqual({ refusal: 'The minimum 10 is greater than the maximum 5.' });
        });

        test('a typed min above the default max is refused rather than silently swapped', () => {
            expect(RecipeFieldConstraint.resolve(numberTarget, { min: '99999' })).toHaveProperty('refusal');
        });

        test('equal bounds point at a fixed value', () => {
            expect((RecipeFieldConstraint.resolve(numberTarget, { min: '5', max: '5' }) as { refusal: string }).refusal).toContain('fixed value');
        });

        test('a bound past precision - scale digits is refused', () => {
            expect((RecipeFieldConstraint.resolve(currencyTarget, { max: '10000' }) as { refusal: string }).refusal)
                .toBe('This field takes at most 4 digits before the decimal point (precision 6, scale 2).');
        });

        test('more decimals than the scale are refused', () => {
            expect((RecipeFieldConstraint.resolve(currencyTarget, { max: '1.234' }) as { refusal: string }).refusal).toBe('This field takes at most 2 decimal places.');
            expect((RecipeFieldConstraint.resolve(numberTarget, { max: '1.5' }) as { refusal: string }).refusal).toBe('This field takes whole numbers only.');
        });

        test('more than 15 digits are refused even on an unsized field', () => {
            expect(RecipeFieldConstraint.resolve({ fieldType: 'Number' }, { max: '1'.repeat(16) })).toHaveProperty('refusal');
            expect(RecipeFieldConstraint.resolve({ fieldType: 'Number', precision: 18, scale: 0 }, { max: '1'.repeat(16) })).toHaveProperty('refusal');
            expect(RecipeFieldConstraint.checkBound({ fieldType: 'Currency', precision: 18, scale: 2 }, `${'1'.repeat(14)}.25`, 'max')).toBe('A bound can have at most 15 digits.');
        });

        test.each(['abc', '1e5', '+5', '5.', '.5', '1,000', ' 5', 'today'])('%s is not a number', bound => {
            expect(RecipeFieldConstraint.checkBound(numberTarget, bound, 'min')).toBe('Type a plain number, such as 42, -7 or 3.25.');
        });

    });

    describe('length', () => {

        test('an empty max is the field length and an empty min is 1', () => {
            expect(RecipeFieldConstraint.resolve(textTarget, { min: '5' })).toEqual({ constraint: { kind: 'length', min: 5, max: 20 } });
            expect(RecipeFieldConstraint.resolve(textTarget, { max: '8' })).toEqual({ constraint: { kind: 'length', min: 1, max: 8 } });
            expect(RecipeFieldConstraint.resolve(textTarget, { max: '0' })).toEqual({ constraint: { kind: 'length', min: 0, max: 0 } });
        });

        test('equal bounds are an exact length', () => {
            expect(RecipeFieldConstraint.resolve(textTarget, { min: '7', max: '7' })).toEqual({ constraint: { kind: 'length', min: 7, max: 7 } });
        });

        test('a length past the field <length> is refused', () => {
            expect(RecipeFieldConstraint.checkBound(textTarget, '21', 'max')).toBe('This field takes at most 20 characters.');
        });

        test('a TextArea with no length caps at 255', () => {
            expect(RecipeFieldConstraint.checkBound({ fieldType: 'TextArea' }, '256', 'max')).toBe('This field takes at most 255 characters.');
        });

        test('min > max is refused', () => {
            expect(RecipeFieldConstraint.resolve(textTarget, { min: '10', max: '3' })).toEqual({ refusal: 'The minimum length 10 is greater than the maximum length 3.' });
        });

        test.each(['-1', '1.5', 'ten', '12345678'])('%s is not a length', bound => {
            expect(RecipeFieldConstraint.checkBound(textTarget, bound, 'min')).toBe('Type a length as a whole number of characters, such as 10.');
        });

    });

    describe('date', () => {

        test('relative bounds stay relative', () => {
            expect(RecipeFieldConstraint.resolve(dateTarget, { min: '-30d', max: '+90d' }, NOW))
                .toEqual({ constraint: { kind: 'date', from: { relativeDays: -30 }, to: { relativeDays: 90 } } });
        });

        test('today and an unsigned count are relative', () => {
            expect(RecipeFieldConstraint.resolve(dateTarget, { min: 'today', max: '10d' }, NOW))
                .toEqual({ constraint: { kind: 'date', from: { relativeDays: 0 }, to: { relativeDays: 10 } } });
        });

        test('ISO dates become UTC midnights', () => {
            expect(RecipeFieldConstraint.resolve(dateTarget, { min: '2024-01-01', max: '2024-02-29' }, NOW))
                .toEqual({ constraint: { kind: 'date', from: { utcDateTime: '2024-01-01T00:00:00' }, to: { utcDateTime: '2024-02-29T00:00:00' } } });
        });

        test('a DateTime takes a UTC time, with or without seconds and Z', () => {
            expect(RecipeFieldConstraint.resolve(dateTimeTarget, { min: '2024-01-01T09:30Z', max: '2024-01-02T10:00:15' }, NOW))
                .toEqual({ constraint: { kind: 'date', from: { utcDateTime: '2024-01-01T09:30:00' }, to: { utcDateTime: '2024-01-02T10:00:15' } } });
        });

        test('a Date refuses a time', () => {
            expect(RecipeFieldConstraint.checkBound(dateTarget, '2024-01-01T09:30Z', 'min')).toBe(RecipeFieldConstraint.describeDateForm(dateTarget, 'min'));
        });

        test('empty bounds default to a year ending today', () => {
            expect(RecipeFieldConstraint.resolve(dateTarget, { min: '-30d' }, NOW)).toEqual({ constraint: { kind: 'date', from: { relativeDays: -30 }, to: { relativeDays: 0 } } });
            expect(RecipeFieldConstraint.resolve(dateTarget, { max: '+30d' }, NOW)).toEqual({ constraint: { kind: 'date', from: { relativeDays: -365 }, to: { relativeDays: 30 } } });
        });

        test('a default never crosses the typed bound', () => {
            expect(RecipeFieldConstraint.resolve(dateTarget, { min: '+30d' }, NOW)).toEqual({ constraint: { kind: 'date', from: { relativeDays: 30 }, to: { relativeDays: 395 } } });
            expect(RecipeFieldConstraint.resolve(dateTarget, { max: '2020-06-01' }, NOW)).toEqual({ constraint: { kind: 'date', from: { utcDateTime: '2019-06-02T00:00:00' }, to: { utcDateTime: '2020-06-01T00:00:00' } } });
            expect(RecipeFieldConstraint.resolve(dateTarget, { min: '2030-01-01' }, NOW)).toEqual({ constraint: { kind: 'date', from: { utcDateTime: '2030-01-01T00:00:00' }, to: { utcDateTime: '2031-01-01T00:00:00' } } });
        });

        test('from later than to is refused, mixed forms compared at now', () => {
            expect(RecipeFieldConstraint.resolve(dateTarget, { min: '+10d', max: '-10d' }, NOW)).toHaveProperty('refusal');
            expect(RecipeFieldConstraint.resolve(dateTarget, { min: '2026-12-01', max: '+10d' }, NOW)).toHaveProperty('refusal');
            expect(RecipeFieldConstraint.resolve(dateTarget, { min: '2026-10-01', max: '+10d' }, NOW)).toHaveProperty('constraint');
        });

        test.each(['2026-02-30', '2026-13-01', '26-01-01', 'yesterday', '-30', '-36501d', '1600-01-01', '2026-01-01T25:00Z'])('%s is not a date', bound => {
            expect(RecipeFieldConstraint.checkBound(dateTimeTarget, bound, 'min')).toBe(RecipeFieldConstraint.describeDateForm(dateTimeTarget, 'min'));
        });

    });

    describe('review fixes (#328)', () => {

        test('a max of 0 alone reaches down to the negative ceiling rather than refusing a zero-width range', () => {
            expect(RecipeFieldConstraint.resolve(numberTarget, { max: '0' })).toEqual({ constraint: { kind: 'number', min: '-99999', max: '0', scale: 0 } });
        });

        test('today as the earliest date defaults the latest to a year from it, not a zero-width range', () => {
            expect(RecipeFieldConstraint.resolve(dateTarget, { min: 'today' }, NOW)).toEqual({ constraint: { kind: 'date', from: { relativeDays: 0 }, to: { relativeDays: 365 } } });
            expect(RecipeFieldConstraint.resolve(dateTimeTarget, { min: '+0d' }, NOW)).toEqual({ constraint: { kind: 'date', from: { relativeDays: 0 }, to: { relativeDays: 365 } } });
        });

        test('a Date field compares by UTC day, so today and today\'s date are one day', () => {
            expect(RecipeFieldConstraint.resolve(dateTarget, { min: 'today', max: '2026-10-14' }, NOW)).toHaveProperty('constraint');
            expect(RecipeFieldConstraint.resolve(dateTarget, { min: '2026-10-14', max: 'today' }, NOW)).toHaveProperty('constraint');
            expect(RecipeFieldConstraint.resolve(dateTimeTarget, { min: 'today', max: '2026-10-14' }, NOW)).toHaveProperty('refusal');
        });

        test.each([
            [{ fieldType: 'Number', precision: 19, scale: 0 }],
            [{ fieldType: 'Number', precision: 5, scale: 6 }],
            [{ fieldType: 'Currency', precision: 18, scale: 300000000 }],
            [{ fieldType: 'Number', precision: 0 }],
            [{ fieldType: 'Number', precision: 2.5 }],
            [{ fieldType: 'Text', length: 99999999999 }],
            [{ fieldType: 'Text', length: 0 }]
        ])('refuses a size Salesforce does not allow, from a hand-edited wrapper: %j', target => {
            const refusal = 'The size recorded for this field is not one Salesforce allows, so it cannot be constrained.';
            expect(RecipeFieldConstraint.checkBound(target, '1', 'min')).toBe(refusal);
            expect(RecipeFieldConstraint.resolve(target, { min: '1' })).toEqual({ refusal: refusal });
        });

    });

    test('a type with no constraints refuses', () => {
        expect(RecipeFieldConstraint.resolve({ fieldType: 'Email' }, { min: '1' })).toEqual({ refusal: 'This field type has no faker constraints.' });
        expect(RecipeFieldConstraint.checkBound({ fieldType: 'Checkbox' }, '1', 'min')).toBe('This field type has no faker constraints.');
    });

    test('no bounds is not a constraint', () => {
        expect(RecipeFieldConstraint.resolve(numberTarget, {})).toEqual({ refusal: 'Set at least one bound.' });
    });

    test('describeStoredConstraint names an empty bound as the default', () => {
        expect(RecipeFieldConstraint.describeStoredConstraint({ min: '5' })).toBe('min 5 · max default');
    });

    test('imports nothing', () => {
        const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'RecipeFieldConstraint.ts'), 'utf-8');
        expect(source).not.toMatch(/^\s*import\s/m);
    });

});
