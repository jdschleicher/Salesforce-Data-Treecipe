import * as yaml from 'js-yaml';

jest.mock('vscode', () => ({}), { virtual: true });

import { RecipeService } from '../RecipeService';
import { XMLFieldDetail } from '../../XMLProcessingService/XMLFieldDetail';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { RecordTypeWrapper } from '../../RecordTypeService/RecordTypesWrapper';
import { IValidationRuleFieldConstraint, ValidationRuleAnalyzerService } from '../../ValidationRuleAnalyzerService/ValidationRuleAnalyzerService';

/*
    What a field's validation rules come to (#324), with each backend: the expression written, the
    "Driven by" line, and the record of every rule, applied or not.
*/

const NOW = new Date('2026-06-15T12:00:00Z');

const fieldDetail = (fieldType: string, size: Partial<XMLFieldDetail> = {}, apiName = 'Field__c'): XMLFieldDetail => ({
    fieldType: fieldType,
    apiName: apiName,
    fieldLabel: apiName,
    xmlMarkup: '',
    ...size
});

const picklistDetail = (values: string[], extra: Partial<XMLFieldDetail> = {}): XMLFieldDetail => fieldDetail('Picklist', {
    picklistValues: values.map(value => ({ picklistOptionApiName: value, label: value })),
    ...extra
});

const rulesFor = (...formulas: string[]): IValidationRuleFieldConstraint[] => formulas.map((formula, index) => {
    const analysis = ValidationRuleAnalyzerService.analyzeFormula(formula, `Rule_${index + 1}`);
    if ( analysis.constraint === undefined ) {
        throw new Error(`${formula}: ${analysis.notAppliedReason}`);
    }
    return analysis.constraint;
});

const backends: Array<[string, () => IRecipeFakerService]> = [
    ['faker-js', () => new FakerJSRecipeFakerService()],
    ['snowfakery', () => new SnowfakeryRecipeFakerService()]
];

function apply(fakerService: IRecipeFakerService, xmlFieldDetail: XMLFieldDetail, formulas: string[], recordTypeMap: Record<string, RecordTypeWrapper> = {}, selectedRecordTypeApiName?: string) {
    const recipeService = new RecipeService(fakerService);
    const unconstrainedRecipeValue = recipeService.getRecipeFakeValueByXMLFieldDetail(xmlFieldDetail, recordTypeMap, selectedRecordTypeApiName);
    return {
        unconstrainedRecipeValue: unconstrainedRecipeValue,
        ...recipeService.applyValidationRules(xmlFieldDetail, unconstrainedRecipeValue, rulesFor(...formulas), recordTypeMap, selectedRecordTypeApiName, NOW)
    };
}

// THE FIELD AS A ONE-FIELD OBJECT RECIPE, LOADED WITH js-yaml, SO A VALUE THAT BREAKS THE FILE FAILS HERE
const loadFieldValue = (recipeValue: string): unknown => {
    const recipe = `- object: Gadget__c\n  nickname: Gadget__c_NickName\n  count: 1\n  fields:\n    Field__c: ${recipeValue}\n`;
    return ( yaml.load(recipe) as Array<{ fields: Record<string, unknown> }> )[0].fields.Field__c;
};

describe.each(backends)('RecipeService.applyValidationRules with %s', (backendName, createFakerService) => {

    const fakerService = createFakerService();

    test('intersects number bounds into one constrained expression, written quoted under one Driven by line', () => {

        const result = apply(fakerService, fieldDetail('Currency', { precision: 10, scale: 2 }), ['Field__c < 100', 'Field__c >= 50000', 'Field__c < 50']);
        const expectedExpression = fakerService.buildConstrainedExpression('Currency', { kind: 'number', min: '100.00', max: '49999.99', scale: 2 });

        expect(result.recipeValue).toBe(`"${expectedExpression}"\n${' '.repeat(20)}### Driven by ValidationRule "Rule_1", "Rule_2", "Rule_3"`);
        expect(loadFieldValue(result.recipeValue)).toBe(expectedExpression);
        expect(result.validationRuleConstraints).toEqual([
            { ruleName: 'Rule_1', type: 'numericMin', value: '100', applied: true },
            { ruleName: 'Rule_2', type: 'numericMax', value: '50000', isExclusive: true, applied: true },
            { ruleName: 'Rule_3', type: 'numericMin', value: '50', applied: true }
        ]);

    });

    test('an empty intersection applies none of the rules, and says why on each', () => {

        const result = apply(fakerService, fieldDetail('Number', { precision: 3, scale: 0 }), ['Field__c < 10', 'Field__c > 5']);
        const expectedReason = 'together these rules leave no value to generate: The minimum 10 is greater than the maximum 5.';

        expect(result.recipeValue).toBe(result.unconstrainedRecipeValue);
        expect(result.validationRuleConstraints).toEqual([
            { ruleName: 'Rule_1', type: 'numericMin', value: '10', applied: false, reason: expectedReason },
            { ruleName: 'Rule_2', type: 'numericMax', value: '5', applied: false, reason: expectedReason }
        ]);

    });

    test('a bound the field cannot hold is that rule\'s refusal, and the others still apply', () => {

        const result = apply(fakerService, fieldDetail('Number', { precision: 3, scale: 0 }), ['Field__c > 100000', 'Field__c < 5']);

        expect(result.validationRuleConstraints.map(record => [record.applied, record.reason])).toEqual([
            [false, 'This field takes at most 3 digits before the decimal point (precision 3, scale 0).'],
            [true, undefined]
        ]);
        expect(loadFieldValue(result.recipeValue)).toBe(fakerService.buildConstrainedExpression('Number', { kind: 'number', min: '5', max: '999', scale: 0 }));

    });

    test('lengths intersect the same way', () => {

        const result = apply(fakerService, fieldDetail('LongTextArea', { length: 1000 }), ['LEN(Field__c) < 10', 'LEN(Field__c) > 200', 'LEN(Field__c) >= 150']);

        expect(loadFieldValue(result.recipeValue)).toBe(fakerService.buildConstrainedExpression('LongTextArea', { kind: 'length', min: 10, max: 149 }));
        expect(result.validationRuleConstraints.every(record => record.applied)).toBe(true);

    });

    test('a Date field takes TODAY() and DATE() bounds, the tightest of each side', () => {

        const result = apply(fakerService, fieldDetail('Date'), ['Field__c < DATE(2024, 1, 1)', 'Field__c < TODAY()', 'Field__c >= DATE(2030, 1, 1)']);

        expect(loadFieldValue(result.recipeValue)).toBe(fakerService.buildConstrainedExpression('Date', { kind: 'date', from: { relativeDays: 0 }, to: { utcDateTime: '2029-12-31T00:00:00' } }));
        expect(result.validationRuleConstraints.every(record => record.applied)).toBe(true);

    });

    test('a date rule on a DateTime field is not applied', () => {

        const result = apply(fakerService, fieldDetail('DateTime'), ['Field__c < TODAY()']);

        expect(result.recipeValue).toBe(result.unconstrainedRecipeValue);
        expect(result.validationRuleConstraints[0]).toEqual({ ruleName: 'Rule_1', type: 'dateMin', value: 'today', applied: false, reason: 'it compares a DateTime field with a date' });

    });

    test.each([
        ['Checkbox', 'Field__c < 5', 'a number bound does not apply to a Checkbox field'],
        ['Email', 'LEN(Field__c) > 5', 'a length bound does not apply to a Email field'],
        ['Number', 'Field__c < TODAY()', 'a date bound does not apply to a Number field'],
        ['Text', 'ISPICKVAL(Field__c, "x")', 'ISPICKVAL excludes a value of a picklist, and this is a Text field']
    ])('a rule on a %s field of the wrong kind is not applied', (fieldType, formula, expectedReason) => {

        const result = apply(fakerService, fieldDetail(fieldType, { length: 80 }), [formula]);

        expect(result.recipeValue).toBe(result.unconstrainedRecipeValue);
        expect(result.validationRuleConstraints[0].reason).toBe(expectedReason);

    });

    test('ISBLANK is applied where the field already generates a value, and changes nothing', () => {

        const result = apply(fakerService, fieldDetail('TextArea'), ['ISBLANK(Field__c)']);

        expect(result.recipeValue).toBe(result.unconstrainedRecipeValue);
        expect(result.validationRuleConstraints).toEqual([{ ruleName: 'Rule_1', type: 'required', applied: true }]);

    });

    test('ISBLANK on a field whose recipe is a TODO is not applied', () => {

        const result = apply(fakerService, fieldDetail('Lookup', { referenceTo: 'Account' }), ['ISBLANK(Field__c)']);

        expect(result.validationRuleConstraints[0]).toEqual({
            ruleName: 'Rule_1', type: 'required', applied: false, reason: "the field's recipe is a TODO, so it generates no value; set one by hand"
        });

    });

    test('ISPICKVAL drops each excluded value from the choices, through the backend\'s own builder', () => {

        const result = apply(fakerService, picklistDetail(['Open', 'Won', 'Lost', 'Gone']), ['ISPICKVAL(Field__c, "Lost")', 'ISPICKVAL(Field__c, "Gone")', 'ISPICKVAL(Field__c, "Never")']);
        const expectedValue = fakerService.buildPicklistRecipeValueByXMLFieldDetail(['Open', 'Won'], {}, 'Field__c');

        expect(result.recipeValue).toBe(`${expectedValue}\n${' '.repeat(20)}### Driven by ValidationRule "Rule_1", "Rule_2", "Rule_3"`);
        expect(result.validationRuleConstraints.every(record => record.applied)).toBe(true);

    });

    test('ISPICKVAL drops the value from every record type variant too, without changing the object\'s wrappers', () => {

        const recordTypeMap: Record<string, RecordTypeWrapper> = {
            Retail: { DeveloperName: 'Retail', PicklistFieldSectionsToPicklistDetail: { Field__c: ['Open', 'Lost'], Other__c: ['Lost'] } }
        };
        const result = apply(fakerService, picklistDetail(['Open', 'Won', 'Lost']), ['ISPICKVAL(Field__c, "Lost")'], recordTypeMap);

        expect(result.recipeValue).toContain(fakerService.buildRecordTypeBasedPicklistRecipeValue({
            Retail: { DeveloperName: 'Retail', PicklistFieldSectionsToPicklistDetail: { Field__c: ['Open'] } }
        }, 'Field__c'));
        expect(recordTypeMap.Retail.PicklistFieldSectionsToPicklistDetail).toEqual({ Field__c: ['Open', 'Lost'], Other__c: ['Lost'] });

    });

    test('a record type section ISPICKVAL empties is dropped, so no variant chooses from nothing', () => {

        const recordTypeMap: Record<string, RecordTypeWrapper> = {
            Retail: { DeveloperName: 'Retail', PicklistFieldSectionsToPicklistDetail: { Field__c: ['Lost'], Other__c: ['Lost'] } }
        };

        expect(RecipeService.excludeRecordTypePicklistValues(recordTypeMap, 'Field__c', new Set(['Lost'])).Retail.PicklistFieldSectionsToPicklistDetail).toEqual({ Other__c: ['Lost'] });
        const result = apply(fakerService, picklistDetail(['Open', 'Lost']), ['ISPICKVAL(Field__c, "Lost")'], recordTypeMap);
        expect(result.recipeValue).not.toContain('Retail');

    });

    test('ISPICKVAL narrows a selected record type\'s values', () => {

        const recordTypeMap: Record<string, RecordTypeWrapper> = {
            Retail: { DeveloperName: 'Retail', PicklistFieldSectionsToPicklistDetail: { Field__c: ['Open', 'Lost'] } }
        };
        const result = apply(fakerService, picklistDetail(['Open', 'Won', 'Lost']), ['ISPICKVAL(Field__c, "Lost")'], recordTypeMap, 'Retail');

        expect(result.recipeValue.split('\n')[0]).toBe(fakerService.buildPicklistRecipeValueByXMLFieldDetail(['Open'], {}, 'Field__c'));

    });

    test('ISPICKVAL that would exclude every value applies none of them', () => {

        const result = apply(fakerService, picklistDetail(['Open', 'Lost']), ['ISPICKVAL(Field__c, "Lost")', 'ISPICKVAL(Field__c, "Open")']);

        expect(result.recipeValue).toBe(result.unconstrainedRecipeValue);
        expect(result.validationRuleConstraints.map(record => record.reason)).toEqual([
            'the excluded values are every value the picklist offers',
            'the excluded values are every value the picklist offers'
        ]);

    });

    test('ISPICKVAL on a picklist with no values Treecipe knows is not applied', () => {

        const result = apply(fakerService, fieldDetail('Picklist', {}, 'NoValues__c'), ['ISPICKVAL(NoValues__c, "x")']);

        expect(result.recipeValue).toBe(result.unconstrainedRecipeValue);
        expect(result.validationRuleConstraints[0].reason).toBe('the picklist has no values Treecipe knows of to exclude a value from');

    });

    test('ISPICKVAL on a dependent picklist drops the value from every choice, and a choice left empty', () => {

        const dependentDetail = picklistDetail([], {
            controllingField: 'Region__c',
            picklistValues: [
                { picklistOptionApiName: 'Boston', label: 'Boston', controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['East'] },
                { picklistOptionApiName: 'Seattle', label: 'Seattle', controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['West'] },
                { picklistOptionApiName: 'Portland', label: 'Portland', controllingValuesFromParentPicklistThatMakeThisValueAvailableAsASelection: ['West', 'North'] }
            ]
        });
        const result = apply(fakerService, dependentDetail, ['ISPICKVAL(Field__c, "Portland")']);
        const choices = loadFieldValue(result.recipeValue) as { if: Array<{ choice: { when: string, pick: { random_choice: string[] } } }> };

        expect(choices.if.map(choice => choice.choice.pick.random_choice)).toEqual([['Boston'], ['Seattle']]);
        expect(result.recipeValue).toContain('### Driven by ValidationRule "Rule_1"');

        const everyValue = apply(fakerService, dependentDetail, ['ISPICKVAL(Field__c, "Portland")', 'ISPICKVAL(Field__c, "Boston")', 'ISPICKVAL(Field__c, "Seattle")']);
        expect(everyValue.recipeValue).toBe(everyValue.unconstrainedRecipeValue);
        expect(everyValue.validationRuleConstraints[0].reason).toBe('the excluded values are every value the dependent picklist offers');

    });

    test('a dependent picklist with no valueSettings has nothing to exclude from', () => {
        const recipeService = new RecipeService(fakerService);
        expect(recipeService.findPicklistExclusionRefusal(picklistDetail(['A'], { controllingField: 'Region__c' }), new Set(['A']), {}))
            .toBe('the dependent picklist has no valueSettings to exclude a value from');
    });

    test('several regex rules on one field cannot be combined', () => {

        const result = apply(fakerService, fieldDetail('Text', { length: 20 }), ['NOT(REGEX(Field__c, "[A-Z]{3}"))', 'NOT(REGEX(Field__c, "\\\\d{3}"))']);

        expect(result.recipeValue).toBe(result.unconstrainedRecipeValue);
        expect(result.validationRuleConstraints.map(record => record.reason)).toEqual(['2 regex rules on one field cannot be combined', '2 regex rules on one field cannot be combined']);

    });

    test('a regex on a field type a pattern cannot stand in for is not applied', () => {

        const result = apply(fakerService, fieldDetail('Email'), ['NOT(REGEX(Field__c, "[a-z]{3}"))']);

        expect(result.validationRuleConstraints[0].reason).toBe('a regex rule is applied to a Text, TextArea, LongTextArea, Phone field, and this is a Email field');

    });

    test('a regex the analyzer refused carries its refusal', () => {

        const result = apply(fakerService, fieldDetail('Text', { length: 20 }), ['NOT(REGEX(Field__c, "(a|b)"))']);

        expect(result.validationRuleConstraints[0].reason).toBe('the pattern uses a group or alternation, which Treecipe cannot generate from');

    });

    test('a rule name is escaped in its Driven by line', () => {

        const recipeService = new RecipeService(fakerService);
        const [constraint] = rulesFor('Field__c < 5');
        const result = recipeService.applyValidationRules(fieldDetail('Number', { precision: 3, scale: 0 }), 'x', [{ ...constraint, ruleName: 'Bad\nInjected__c: 1' }], {}, undefined, NOW);

        expect(result.recipeValue).toContain('### Driven by ValidationRule "Bad\\nInjected__c: 1"');
        expect(loadFieldValue(result.recipeValue)).toBe(fakerService.buildConstrainedExpression('Number', { kind: 'number', min: '5', max: '999', scale: 0 }));

    });

});

describe('RecipeService.applyValidationRules, a regex rule', () => {

    test('faker-js writes it through buildRegexExpression, and a bound on the same field is not combined with it', () => {

        const result = apply(new FakerJSRecipeFakerService(), fieldDetail('Text', { length: 20 }), ['NOT(REGEX(Field__c, "[A-Z]{3}-\\\\d{4}"))', 'LEN(Field__c) > 5']);

        expect(loadFieldValue(result.recipeValue)).toBe(`\${{ faker.helpers.fromRegExp('[A-Z]{3}') + '-' + faker.helpers.fromRegExp('[0-9]{4}') }}`);
        expect(result.validationRuleConstraints).toEqual([
            { ruleName: 'Rule_1', type: 'regex', value: '[A-Z]{3}-\\d{4}', applied: true },
            { ruleName: 'Rule_2', type: 'lengthMax', value: '5', applied: false, reason: 'a regex rule on this field decides its value, and a bound cannot be combined with it' }
        ]);

    });

    test('a regex on a sized field is held to its length: open repeats are cut to fit, in pattern order', () => {

        const result = apply(new FakerJSRecipeFakerService(), fieldDetail('Text', { length: 5 }), ['NOT(REGEX(Field__c, "[A-Z]+-\\\\d*"))']);

        expect(loadFieldValue(result.recipeValue)).toBe(`\${{ faker.helpers.fromRegExp('[A-Z]{1,4}') + '-' + faker.helpers.fromRegExp('[0-9]{0}') }}`);
        expect(result.validationRuleConstraints[0].applied).toBe(true);

    });

    test('a regex whose shortest match is longer than the field is not applied', () => {

        const result = apply(new FakerJSRecipeFakerService(), fieldDetail('Text', { length: 5 }), ['NOT(REGEX(Field__c, "[A-Z]{3}-\\\\d{4}"))']);

        expect(result.recipeValue).toBe(result.unconstrainedRecipeValue);
        expect(result.validationRuleConstraints[0].reason).toBe("the shortest value the pattern matches is longer than the field's 5 characters");

    });

    test('a Phone field is held to the 40 characters Salesforce allows every phone', () => {
        expect(RecipeService.getRegexFieldLengthCeiling(fieldDetail('Phone'))).toBe(40);
        expect(RecipeService.getRegexFieldLengthCeiling(fieldDetail('TextArea'))).toBe(255);
        expect(RecipeService.getRegexFieldLengthCeiling(fieldDetail('Text', { length: 12 }))).toBe(12);
    });

    test('fitRegexAtomsToLength keeps every minimum and hands out what is left', () => {
        expect(RecipeService.fitRegexAtomsToLength([{ characters: 'ab', min: 1, max: 9 }, { characters: 'c', min: 2, max: 9 }], 6))
            .toEqual([{ characters: 'ab', min: 1, max: 4 }, { characters: 'c', min: 2, max: 2 }]);
        expect(RecipeService.fitRegexAtomsToLength([{ characters: 'a', min: 7, max: 7 }], 6)).toBeUndefined();
    });

    test('snowfakery has no regex generator, so it is not applied there', () => {

        const result = apply(new SnowfakeryRecipeFakerService(), fieldDetail('Phone'), ['NOT(REGEX(Field__c, "\\\\d{10}"))']);

        expect(result.recipeValue).toBe(result.unconstrainedRecipeValue);
        expect(result.validationRuleConstraints[0]).toEqual({ ruleName: 'Rule_1', type: 'regex', value: '\\d{10}', applied: false, reason: 'this faker service has no regex generator' });

    });

    test('an expression longer than a cockpit constraint may be is not applied', () => {

        const result = apply(new FakerJSRecipeFakerService(), fieldDetail('LongTextArea', { length: 5000 }), [`NOT(REGEX(Field__c, "${'[a-c]x'.repeat(50)}"))`]);

        expect(result.validationRuleConstraints[0].reason).toBe('the expression it generates is longer than 1000 characters.');

    });

});

describe('RecipeService.roundNumberBoundIntoScale', () => {

    test.each([
        ['100', 0, 'min', false, '100'],
        ['100', 0, 'min', true, '101'],
        ['100.5', 0, 'min', false, '101'],
        ['100.5', 0, 'min', true, '101'],
        ['100.5', 0, 'max', false, '100'],
        ['100.5', 0, 'max', true, '100'],
        ['100', 2, 'max', true, '99.99'],
        ['100.50', 2, 'min', true, '100.51'],
        ['-2.5', 0, 'min', false, '-2'],
        ['-2.5', 0, 'max', false, '-3'],
        ['0', 1, 'min', true, '0.1'],
        ['0', 1, 'max', true, '-0.1'],
        ['-0.001', 2, 'max', false, '-0.01'],
        ['12345678901234567890', 0, 'max', true, '12345678901234567889']
    ] as const)('%s at scale %i as a %s (exclusive %s) is %s', (numberText, scale, boundName, isExclusive, expected) => {
        expect(RecipeService.roundNumberBoundIntoScale(numberText, scale, boundName, isExclusive)).toBe(expected);
    });

});

describe('RecipeService validation rule notes', () => {

    test('a rule naming an OOTB field says the mapping wrote it', () => {
        expect(RecipeService.buildMissingFieldReason('amount', ['Name', 'Amount'])).toBe("amount is written from Treecipe's standard-field mapping, which validation rules do not change");
        expect(RecipeService.buildMissingFieldReason('Gone__c', ['Name'])).toBe("Gone__c is not a field Treecipe read from this object's fields folder");
    });

    test('a not-applied TODO escapes the rule name and reason for a comment', () => {
        expect(new RecipeService(new FakerJSRecipeFakerService()).buildValidationRuleNotAppliedTodo('A\u2028B', 'why\nnot'))
            .toBe('### TODO -- VALIDATION RULE NOT APPLIED -- "A\\u2028B" -- why\\nnot');
    });

});
