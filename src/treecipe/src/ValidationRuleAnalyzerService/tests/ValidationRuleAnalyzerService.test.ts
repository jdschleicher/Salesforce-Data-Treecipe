import * as fs from 'fs';
import * as path from 'path';
import { IValidationRuleAnalysis, ValidationRuleAnalyzerService, VALIDATION_RULE_REGEX_OPEN_REPEAT_SPAN } from '../ValidationRuleAnalyzerService';

const MOCKS_PATH = path.join(__dirname, 'mocks');

async function analyzeMock(ruleName: string): Promise<IValidationRuleAnalysis | undefined> {
    const fileName = `Opportunity.${ruleName}.validationRule-meta.xml`;
    return ValidationRuleAnalyzerService.analyzeValidationRuleXml(fs.readFileSync(path.join(MOCKS_PATH, fileName), 'utf8'), fileName);
}

const ruleXml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata">\n${body}\n</ValidationRule>`;

describe('ValidationRuleAnalyzerService.analyzeValidationRuleXml, over #41\'s rule files', () => {

    test.each([
        ['Require_Amount_Minimum', { fieldReference: 'Amount', type: 'numericMin', value: '100', isExclusive: false }],
        ['Require_Amount_Maximum', { fieldReference: 'Amount', type: 'numericMax', value: '1000000', isExclusive: false }],
        ['Require_CloseDate_Future', { fieldReference: 'CloseDate', type: 'dateMin', value: 'today' }],
        ['Require_Description', { fieldReference: 'Description', type: 'required' }],
        ['Limit_Description_Length', { fieldReference: 'Description', type: 'lengthMax', value: '500' }],
        ['Require_Min_Description_Length', { fieldReference: 'Description', type: 'lengthMin', value: '10' }],
        ['Restrict_Lost_Stage', { fieldReference: 'StageName', type: 'picklistExclude', value: 'Closed Lost' }],
        ['Require_Phone_Format', { fieldReference: 'Phone', type: 'regex', value: '^[0-9]{10}$', regexAtoms: [{ characters: '0123456789', min: 10, max: 10 }] }]
    ])('%s is read as its single-field shape', async (ruleName, expectedConstraint) => {
        expect(await analyzeMock(ruleName)).toEqual({
            ruleName: ruleName,
            constraint: { ruleName: ruleName, ...expectedConstraint }
        });
    });

    test('an inactive rule is not analyzed at all', async () => {
        expect(await analyzeMock('Inactive_Rule')).toBeUndefined();
    });

    test('a formula combining several fields is not applied, never partly applied', async () => {
        expect(await analyzeMock('Complex_Formula')).toEqual({
            ruleName: 'Complex_Formula',
            notAppliedReason: 'its formula is not one of the single-field shapes Treecipe applies'
        });
    });

    test('a rule with no <fullName> takes its name from the file', async () => {
        const analysis = await ValidationRuleAnalyzerService.analyzeValidationRuleXml(
            ruleXml('<active>true</active><errorConditionFormula>ISBLANK(Name)</errorConditionFormula>'),
            'Gadget__c.Named_By_File.validationRule-meta.xml'
        );
        expect(analysis?.ruleName).toBe('Gadget__c.Named_By_File');
    });

    test.each([
        ['unparseable XML', '<ValidationRule><active>true', 'the file could not be parsed as XML'],
        ['another metadata type', '<?xml version="1.0"?><CustomField><fullName>X</fullName></CustomField>', 'the file is not a ValidationRule'],
        ['no formula', ruleXml('<fullName>No_Formula</fullName><active>true</active>'), 'it has no errorConditionFormula']
    ])('%s is a rule that was not applied', async (unusedCase, xmlContent, expectedReason) => {
        const analysis = await ValidationRuleAnalyzerService.analyzeValidationRuleXml(xmlContent, 'Broken.validationRule-meta.xml');
        expect(analysis?.notAppliedReason).toBe(expectedReason);
    });

    test('an <active> that is not exactly "true" is not active', async () => {
        const analysis = await ValidationRuleAnalyzerService.analyzeValidationRuleXml(
            ruleXml('<fullName>Odd</fullName><active>TRUE </active><errorConditionFormula>ISBLANK(Name)</errorConditionFormula>'),
            'Odd.validationRule-meta.xml'
        );
        expect(analysis).toBeUndefined();
    });

    test('recognizes a rule file name only by its suffix', () => {
        expect(ValidationRuleAnalyzerService.isValidationRuleFileName('Rule.validationRule-meta.xml')).toBe(true);
        expect(ValidationRuleAnalyzerService.isValidationRuleFileName('.validationRule-meta.xml')).toBe(false);
        expect(ValidationRuleAnalyzerService.isValidationRuleFileName('Rule.field-meta.xml')).toBe(false);
    });

});

describe('ValidationRuleAnalyzerService.analyzeFormula', () => {

    const constraintOf = (formula: string) => ValidationRuleAnalyzerService.analyzeFormula(formula, 'Rule').constraint;

    test.each([
        ['Amount__c < 100', 'numericMin', '100', false],
        ['Amount__c <= 100', 'numericMin', '100', true],
        ['Amount__c > 99.50', 'numericMax', '99.50', false],
        ['Amount__c >= -5', 'numericMax', '-5', true],
        ['Amount__c<+007.5', 'numericMin', '7.5', false],
        ['Amount__c > -0', 'numericMax', '0', false]
    ])('%s: a number is parsed and written back from its digits', (formula, type, value, isExclusive) => {
        expect(constraintOf(formula)).toEqual({ ruleName: 'Rule', fieldReference: 'Amount__c', type: type, value: value, isExclusive: isExclusive });
    });

    test.each([
        ['LEN(Code__c) < 5', 'lengthMin', '5'],
        ['LEN(Code__c) <= 5', 'lengthMin', '6'],
        ['LEN(Code__c) > 5', 'lengthMax', '5'],
        ['len( Code__c ) >= 5', 'lengthMax', '4']
    ])('%s', (formula, type, value) => {
        expect(constraintOf(formula)).toEqual({ ruleName: 'Rule', fieldReference: 'Code__c', type: type, value: value });
    });

    test('LEN(f) >= 0 leaves no length, and says so', () => {
        expect(constraintOf('LEN(Code__c) >= 0')?.refusal).toBe('no length is less than 0');
    });

    test.each([
        ['Due__c < TODAY()', 'dateMin', 'today'],
        ['Due__c <= TODAY()', 'dateMin', '+1d'],
        ['Due__c > today( )', 'dateMax', 'today'],
        ['Due__c >= TODAY()', 'dateMax', '-1d'],
        ['Due__c < DATE(2024, 1, 1)', 'dateMin', '2024-01-01'],
        ['Due__c <= DATE(2024,2,28)', 'dateMin', '2024-02-29'],
        ['Due__c > DATE(2030, 12, 31)', 'dateMax', '2030-12-31'],
        ['Due__c >= DATE(2030, 1, 1)', 'dateMax', '2029-12-31']
    ])('%s', (formula, type, value) => {
        expect(constraintOf(formula)).toEqual({ ruleName: 'Rule', fieldReference: 'Due__c', type: type, value: value });
    });

    test('a DATE() that does not exist is refused, not rolled over', () => {
        expect(constraintOf('Due__c < DATE(2023, 2, 30)')?.refusal).toBe('DATE(2023, 2, 30) is not a date');
    });

    test('ISPICKVAL reads the formula string literal, escapes and either quote included', () => {
        expect(constraintOf('ISPICKVAL(Stage__c, "Say \\"hi\\" \\\\ bye")')?.value).toBe('Say "hi" \\ bye');
        expect(constraintOf("ISPICKVAL(Stage__c, 'Rock \\'n\\' Roll')")?.value).toBe("Rock 'n' Roll");
    });

    test('field references keep their case, and are grouped case-insensitively', () => {
        const analyses = ['ISBLANK(Code__c)', 'LEN(code__C) > 4', 'Amount__c < 1'].map(formula => ValidationRuleAnalyzerService.analyzeFormula(formula, formula));
        const grouped = ValidationRuleAnalyzerService.groupConstraintsByFieldReference([...analyses, { ruleName: 'none', notAppliedReason: 'x' }]);
        expect([...grouped.keys()]).toEqual(['code__c', 'amount__c']);
        expect(grouped.get('code__c')?.map(constraint => constraint.fieldReference)).toEqual(['Code__c', 'code__C']);
    });

    test.each([
        ['AND(ISBLANK(A__c), ISBLANK(B__c))'],
        ['Amount__c < Other__c'],
        ['TODAY() > Due__c'],
        ['Amount__c < 1e5'],
        ['ISBLANK(Code__c) /* note */'],
        ['TODAY < 5']
    ])('%s is not one of the shapes', (formula) => {
        expect(ValidationRuleAnalyzerService.analyzeFormula(formula, 'Rule')).toEqual({
            ruleName: 'Rule',
            notAppliedReason: 'its formula is not one of the single-field shapes Treecipe applies'
        });
    });

    test.each([
        ['ISBLANK($User.Id)', '$User.Id'],
        ['ISBLANK(1Field)', '1Field'],
        ['LEN(Bad-Name) > 3', 'Bad-Name'],
        ['Account.Name < 5', 'Account.Name']
    ])('%s names something that is not an api name, so it is not applied', (formula, fieldReference) => {
        expect(ValidationRuleAnalyzerService.analyzeFormula(formula, 'Rule').notAppliedReason).toBe(`it names "${fieldReference}", which is not a field api name`);
    });

    test('canonicalizeNumber writes the parsed digits', () => {
        expect(ValidationRuleAnalyzerService.canonicalizeNumber('+0042.50')).toBe('42.50');
        expect(ValidationRuleAnalyzerService.canonicalizeNumber('-0.00')).toBe('0.00');
        expect(ValidationRuleAnalyzerService.canonicalizeNumber('-000')).toBe('0');
    });

});

describe('ValidationRuleAnalyzerService.parseGeneratableRegex', () => {

    test.each([
        ['[A-Z]{3}-\\d{4}', [{ characters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', min: 3, max: 3 }, { characters: '-', min: 1, max: 1 }, { characters: '0123456789', min: 4, max: 4 }]],
        ['^ab?$', [{ characters: 'a', min: 1, max: 1 }, { characters: 'b', min: 0, max: 1 }]],
        ['x*y+', [{ characters: 'x', min: 0, max: VALIDATION_RULE_REGEX_OPEN_REPEAT_SPAN }, { characters: 'y', min: 1, max: 1 + VALIDATION_RULE_REGEX_OPEN_REPEAT_SPAN }]],
        ['\\s{2,}', [{ characters: ' ', min: 2, max: 2 + VALIDATION_RULE_REGEX_OPEN_REPEAT_SPAN }]],
        ['[-a-c_]', [{ characters: '-_abc', min: 1, max: 1 }]],
        ['[a\\-z]', [{ characters: '-az', min: 1, max: 1 }]],
        ['[^0-9a-zA-Y]', [{ characters: 'Z', min: 1, max: 1 }]],
        ['\\.\\$', [{ characters: '.', min: 1, max: 1 }, { characters: '$', min: 1, max: 1 }]],
        ['a$\\$', undefined],
        ['a\\$', [{ characters: 'a', min: 1, max: 1 }, { characters: '$', min: 1, max: 1 }]],
        ['a{2,3}?', [{ characters: 'a', min: 2, max: 3 }]],
        ['[\\d_.]', [{ characters: '.0123456789_', min: 1, max: 1 }]]
    ])('%s', (pattern, expectedAtoms) => {
        const parsedPattern = ValidationRuleAnalyzerService.parseGeneratableRegex(pattern);
        if ( expectedAtoms === undefined ) {
            expect(parsedPattern).toHaveProperty('refusal');
        } else {
            expect(parsedPattern).toEqual({ atoms: expectedAtoms });
        }
    });

    test.each([
        ['(ab)+', 'the pattern uses a group or alternation, which Treecipe cannot generate from'],
        ['a|b', 'the pattern uses a group or alternation, which Treecipe cannot generate from'],
        ['\\bword', 'the pattern uses \\b, which Treecipe cannot generate from'],
        ['\\D', 'the pattern uses \\D, which Treecipe cannot generate from'],
        ['[[a]]', 'the pattern nests or intersects character classes, which Treecipe cannot generate from'],
        ['[a-z&&[^b]]', 'the pattern nests or intersects character classes, which Treecipe cannot generate from'],
        ['[z-a]', 'the pattern has a character range that is out of order'],
        ['[abc', 'the pattern has a character class that is never closed'],
        ['[]a]', 'the pattern has an empty character class'],
        ['[^a-zA-Z0-9]', 'the pattern has a character class no character satisfies'],
        ['[\\B]', 'the pattern uses \\B in a character class, which Treecipe cannot generate from'],
        ['[a-\\B]', 'the pattern uses \\B in a character class, which Treecipe cannot generate from'],
        ['[a-\\d]', 'the pattern has a character range that is out of order'],
        ['[\u00e9]', 'the pattern contains a character outside printable ASCII'],
        ['a{3,1}', 'the pattern has a repeat count that is out of order'],
        ['a{2000}', 'the pattern repeats a part more than 1000 times'],
        ['a{x}', 'the pattern has a "{" that is not a repeat count'],
        ['a++', 'the pattern uses a possessive quantifier, which Treecipe cannot generate from'],
        ['a**', 'the pattern repeats a repeat, which Treecipe cannot generate from'],
        ['*a', 'the pattern has "*" where a character was expected'],
        ['a^b', 'the pattern has "^" where a character was expected'],
        ['é', 'the pattern contains a character outside printable ASCII'],
        ['a\\', 'the pattern ends in a lone backslash'],
        ['^$', 'the pattern matches only an empty value'],
        ['a\nb', 'the pattern contains a line break or control character'],
        ['a\u2028b', 'the pattern contains a line break or control character'],
        ['a${{ 1 }}', 'the pattern contains "${{", which opens a template'],
        ['a${% x %}', 'the pattern contains "${%", which opens a template'],
        ['a{{b', 'the pattern contains "{{", which opens a template'],
        ['a{%b', 'the pattern contains "{%", which opens a template'],
        ['a<<b', 'the pattern contains "<<", which opens a template'],
        ['a<%b', 'the pattern contains "<%", which opens a template']
    ])('%j is refused', (pattern, expectedRefusal) => {
        expect(ValidationRuleAnalyzerService.parseGeneratableRegex(pattern)).toEqual({ refusal: expectedRefusal });
    });

    test('a pattern with more than the maximum parts is refused', () => {
        expect(ValidationRuleAnalyzerService.parseGeneratableRegex('a'.repeat(101))).toEqual({ refusal: 'the pattern has more than 100 parts' });
    });

    test('a regex rule the parser refuses is still a regex constraint, carrying the refusal', () => {
        expect(ValidationRuleAnalyzerService.analyzeFormula('NOT(REGEX(Code__c, "(a|b)"))', 'Rule').constraint).toEqual({
            ruleName: 'Rule',
            fieldReference: 'Code__c',
            type: 'regex',
            value: '(a|b)',
            refusal: 'the pattern uses a group or alternation, which Treecipe cannot generate from'
        });
    });

});
