import * as fs from 'fs';
import * as path from 'path';
import {
    ValidationRuleAnalyzerService,
    ValidationRuleConstraint
} from '../ValidationRuleAnalyzerService';

const MOCKS_DIR = path.join(__dirname, 'mocks');

function readMock(fileName: string): string {
    return fs.readFileSync(path.join(MOCKS_DIR, fileName), 'utf-8');
}

describe('ValidationRuleAnalyzerService', () => {

    describe('parseValidationRuleXml', () => {

        test('given active rule XML, returns parsed rule with active=true', () => {
            const xml = readMock('Opportunity.Require_Description.validationRule-meta.xml');
            const result = ValidationRuleAnalyzerService.parseValidationRuleXml(xml);

            expect(result).not.toBeNull();
            expect(result!.fullName).toBe('Require_Description');
            expect(result!.active).toBe(true);
            expect(result!.errorConditionFormula).toBe('ISBLANK(Description)');
            expect(result!.errorMessage).toBe('Description is required on all Opportunity records.');
        });

        test('given inactive rule XML, returns parsed rule with active=false', () => {
            const xml = readMock('Opportunity.Inactive_Rule.validationRule-meta.xml');
            const result = ValidationRuleAnalyzerService.parseValidationRuleXml(xml);

            expect(result).not.toBeNull();
            expect(result!.fullName).toBe('Inactive_Rule');
            expect(result!.active).toBe(false);
        });

    });

    describe('extractConstraintsFromFormula', () => {

        test('given REGEX formula, returns regex constraint with pattern value', () => {
            const formula = 'NOT(REGEX(Phone, "^[0-9]{10}$"))';
            const constraints = ValidationRuleAnalyzerService.extractConstraintsFromFormula(
                formula, 'Phone must be 10 digits', 'Require_Phone_Format'
            );

            expect(constraints).toHaveLength(1);
            expect(constraints[0].constraintType).toBe('regex');
            expect(constraints[0].fieldApiName).toBe('Phone');
            expect(constraints[0].value).toBe('^[0-9]{10}$');
        });

        test('given ISBLANK formula, returns required constraint', () => {
            const formula = 'ISBLANK(Description)';
            const constraints = ValidationRuleAnalyzerService.extractConstraintsFromFormula(
                formula, 'Description is required', 'Require_Description'
            );

            expect(constraints).toHaveLength(1);
            expect(constraints[0].constraintType).toBe('required');
            expect(constraints[0].fieldApiName).toBe('Description');
            expect(constraints[0].value).toBeUndefined();
        });

        test('given ISPICKVAL formula, returns picklistExclude constraint with the excluded value', () => {
            const formula = 'ISPICKVAL(StageName, "Closed Lost")';
            const constraints = ValidationRuleAnalyzerService.extractConstraintsFromFormula(
                formula, 'Cannot set stage to Closed Lost', 'Restrict_Lost_Stage'
            );

            expect(constraints).toHaveLength(1);
            expect(constraints[0].constraintType).toBe('picklistExclude');
            expect(constraints[0].fieldApiName).toBe('StageName');
            expect(constraints[0].value).toBe('Closed Lost');
        });

        describe('numeric range constraints', () => {

            test('given "Amount < 100" formula, returns numericMin=100', () => {
                const constraints = ValidationRuleAnalyzerService.extractConstraintsFromFormula(
                    'Amount < 100', 'Amount must be at least 100', 'Require_Amount_Minimum'
                );

                expect(constraints).toHaveLength(1);
                expect(constraints[0].constraintType).toBe('numericMin');
                expect(constraints[0].fieldApiName).toBe('Amount');
                expect(constraints[0].value).toBe(100);
            });

            test('given "Amount <= 100" formula, returns numericMin=101', () => {
                const constraints = ValidationRuleAnalyzerService.extractConstraintsFromFormula(
                    'Amount <= 100', 'Amount must be greater than 100', 'Require_Amount_Over_100'
                );

                expect(constraints[0].constraintType).toBe('numericMin');
                expect(constraints[0].value).toBe(101);
            });

            test('given "Amount > 1000000" formula, returns numericMax=1000000', () => {
                const constraints = ValidationRuleAnalyzerService.extractConstraintsFromFormula(
                    'Amount > 1000000', 'Amount cannot exceed 1000000', 'Require_Amount_Maximum'
                );

                expect(constraints).toHaveLength(1);
                expect(constraints[0].constraintType).toBe('numericMax');
                expect(constraints[0].fieldApiName).toBe('Amount');
                expect(constraints[0].value).toBe(1000000);
            });

            test('given "Amount >= 1000000" formula, returns numericMax=999999', () => {
                const constraints = ValidationRuleAnalyzerService.extractConstraintsFromFormula(
                    'Amount >= 1000000', 'Amount must be under 1000000', 'Require_Amount_Under_Max'
                );

                expect(constraints[0].constraintType).toBe('numericMax');
                expect(constraints[0].value).toBe(999999);
            });

        });

        describe('length constraints', () => {

            test('given "LEN(Description) > 500" formula, returns lengthMax=500', () => {
                const constraints = ValidationRuleAnalyzerService.extractConstraintsFromFormula(
                    'LEN(Description) > 500', 'Description cannot exceed 500 chars', 'Limit_Description_Length'
                );

                expect(constraints).toHaveLength(1);
                expect(constraints[0].constraintType).toBe('lengthMax');
                expect(constraints[0].fieldApiName).toBe('Description');
                expect(constraints[0].value).toBe(500);
            });

            test('given "LEN(Description) >= 500" formula, returns lengthMax=499', () => {
                const constraints = ValidationRuleAnalyzerService.extractConstraintsFromFormula(
                    'LEN(Description) >= 500', 'Description must be under 500 chars', 'Limit_Description_Length_Inclusive'
                );

                expect(constraints[0].constraintType).toBe('lengthMax');
                expect(constraints[0].value).toBe(499);
            });

            test('given "LEN(Description) < 10" formula, returns lengthMin=10', () => {
                const constraints = ValidationRuleAnalyzerService.extractConstraintsFromFormula(
                    'LEN(Description) < 10', 'Description must be at least 10 chars', 'Require_Min_Description_Length'
                );

                expect(constraints).toHaveLength(1);
                expect(constraints[0].constraintType).toBe('lengthMin');
                expect(constraints[0].fieldApiName).toBe('Description');
                expect(constraints[0].value).toBe(10);
            });

            test('given "LEN(Description) <= 10" formula, returns lengthMin=11', () => {
                const constraints = ValidationRuleAnalyzerService.extractConstraintsFromFormula(
                    'LEN(Description) <= 10', 'Description must be over 10 chars', 'Require_Min_Description_Over_10'
                );

                expect(constraints[0].constraintType).toBe('lengthMin');
                expect(constraints[0].value).toBe(11);
            });

        });

        describe('date constraints', () => {

            test('given "CloseDate < TODAY()" formula, returns dateRelativeMin with value TODAY', () => {
                const constraints = ValidationRuleAnalyzerService.extractConstraintsFromFormula(
                    'CloseDate < TODAY()', 'Close Date must be today or later', 'Require_CloseDate_Future'
                );

                expect(constraints).toHaveLength(1);
                expect(constraints[0].constraintType).toBe('dateRelativeMin');
                expect(constraints[0].fieldApiName).toBe('CloseDate');
                expect(constraints[0].value).toBe('TODAY');
            });

            test('given "CloseDate > TODAY()" formula, returns dateRelativeMax with value TODAY', () => {
                const constraints = ValidationRuleAnalyzerService.extractConstraintsFromFormula(
                    'CloseDate > TODAY()', 'Close Date must be today or earlier', 'Require_CloseDate_Past'
                );

                expect(constraints).toHaveLength(1);
                expect(constraints[0].constraintType).toBe('dateRelativeMax');
                expect(constraints[0].fieldApiName).toBe('CloseDate');
                expect(constraints[0].value).toBe('TODAY');
            });

            test('given "CloseDate < DATE(2020, 1, 1)" formula, returns dateMin with ISO date string', () => {
                const constraints = ValidationRuleAnalyzerService.extractConstraintsFromFormula(
                    'CloseDate < DATE(2020, 1, 1)', 'Close Date must be on or after 2020-01-01', 'Require_CloseDate_After_2020'
                );

                expect(constraints).toHaveLength(1);
                expect(constraints[0].constraintType).toBe('dateMin');
                expect(constraints[0].fieldApiName).toBe('CloseDate');
                expect(constraints[0].value).toBe('2020-01-01');
            });

            test('given "CloseDate > DATE(2025, 12, 31)" formula, returns dateMax with ISO date string', () => {
                const constraints = ValidationRuleAnalyzerService.extractConstraintsFromFormula(
                    'CloseDate > DATE(2025, 12, 31)', 'Close Date must be on or before 2025-12-31', 'Require_CloseDate_Before_2026'
                );

                expect(constraints).toHaveLength(1);
                expect(constraints[0].constraintType).toBe('dateMax');
                expect(constraints[0].fieldApiName).toBe('CloseDate');
                expect(constraints[0].value).toBe('2025-12-31');
            });

        });

        test('given a complex multi-field formula, returns unknown constraint with first detected field', () => {
            const formula = 'AND(ISPICKVAL(StageName, "Closed Won"), ISBLANK(CloseDate), NOT(ISBLANK(Description)), Amount > 50000)';
            const constraints = ValidationRuleAnalyzerService.extractConstraintsFromFormula(
                formula, 'Complex rule message', 'Complex_Formula'
            );

            expect(constraints).toHaveLength(1);
            expect(constraints[0].constraintType).toBe('unknown');
            expect(constraints[0].rawFormula).toBe(formula);
        });

    });

    describe('getConstraintsFromValidationRuleXml', () => {

        test('given inactive rule XML, returns empty constraints array', () => {
            const xml = readMock('Opportunity.Inactive_Rule.validationRule-meta.xml');
            const constraints = ValidationRuleAnalyzerService.getConstraintsFromValidationRuleXml(xml);

            expect(constraints).toHaveLength(0);
        });

        test('given REGEX rule XML, returns regex constraint', () => {
            const xml = readMock('Opportunity.Require_Phone_Format.validationRule-meta.xml');
            const constraints = ValidationRuleAnalyzerService.getConstraintsFromValidationRuleXml(xml);

            expect(constraints).toHaveLength(1);
            expect(constraints[0].constraintType).toBe('regex');
            expect(constraints[0].fieldApiName).toBe('Phone');
            expect(constraints[0].value).toBe('^[0-9]{10}$');
            expect(constraints[0].ruleName).toBe('Require_Phone_Format');
        });

        test('given numeric min rule XML (Amount < 100), returns numericMin constraint', () => {
            const xml = readMock('Opportunity.Require_Amount_Minimum.validationRule-meta.xml');
            const constraints = ValidationRuleAnalyzerService.getConstraintsFromValidationRuleXml(xml);

            expect(constraints).toHaveLength(1);
            expect(constraints[0].constraintType).toBe('numericMin');
            expect(constraints[0].fieldApiName).toBe('Amount');
            expect(constraints[0].value).toBe(100);
        });

        test('given numeric max rule XML (Amount > 1000000), returns numericMax constraint', () => {
            const xml = readMock('Opportunity.Require_Amount_Maximum.validationRule-meta.xml');
            const constraints = ValidationRuleAnalyzerService.getConstraintsFromValidationRuleXml(xml);

            expect(constraints).toHaveLength(1);
            expect(constraints[0].constraintType).toBe('numericMax');
            expect(constraints[0].fieldApiName).toBe('Amount');
            expect(constraints[0].value).toBe(1000000);
        });

        test('given ISPICKVAL rule XML, returns picklistExclude constraint', () => {
            const xml = readMock('Opportunity.Restrict_Lost_Stage.validationRule-meta.xml');
            const constraints = ValidationRuleAnalyzerService.getConstraintsFromValidationRuleXml(xml);

            expect(constraints).toHaveLength(1);
            expect(constraints[0].constraintType).toBe('picklistExclude');
            expect(constraints[0].fieldApiName).toBe('StageName');
            expect(constraints[0].value).toBe('Closed Lost');
        });

        test('given ISBLANK rule XML, returns required constraint', () => {
            const xml = readMock('Opportunity.Require_Description.validationRule-meta.xml');
            const constraints = ValidationRuleAnalyzerService.getConstraintsFromValidationRuleXml(xml);

            expect(constraints).toHaveLength(1);
            expect(constraints[0].constraintType).toBe('required');
            expect(constraints[0].fieldApiName).toBe('Description');
        });

        test('given LEN > max rule XML, returns lengthMax constraint', () => {
            const xml = readMock('Opportunity.Limit_Description_Length.validationRule-meta.xml');
            const constraints = ValidationRuleAnalyzerService.getConstraintsFromValidationRuleXml(xml);

            expect(constraints).toHaveLength(1);
            expect(constraints[0].constraintType).toBe('lengthMax');
            expect(constraints[0].fieldApiName).toBe('Description');
            expect(constraints[0].value).toBe(500);
        });

        test('given LEN < min rule XML, returns lengthMin constraint', () => {
            const xml = readMock('Opportunity.Require_Min_Description_Length.validationRule-meta.xml');
            const constraints = ValidationRuleAnalyzerService.getConstraintsFromValidationRuleXml(xml);

            expect(constraints).toHaveLength(1);
            expect(constraints[0].constraintType).toBe('lengthMin');
            expect(constraints[0].fieldApiName).toBe('Description');
            expect(constraints[0].value).toBe(10);
        });

        test('given date future rule XML (CloseDate < TODAY()), returns dateRelativeMin constraint', () => {
            const xml = readMock('Opportunity.Require_CloseDate_Future.validationRule-meta.xml');
            const constraints = ValidationRuleAnalyzerService.getConstraintsFromValidationRuleXml(xml);

            expect(constraints).toHaveLength(1);
            expect(constraints[0].constraintType).toBe('dateRelativeMin');
            expect(constraints[0].fieldApiName).toBe('CloseDate');
            expect(constraints[0].value).toBe('TODAY');
        });

        test('given complex formula rule XML, returns unknown constraint', () => {
            const xml = readMock('Opportunity.Complex_Formula.validationRule-meta.xml');
            const constraints = ValidationRuleAnalyzerService.getConstraintsFromValidationRuleXml(xml);

            expect(constraints).toHaveLength(1);
            expect(constraints[0].constraintType).toBe('unknown');
            expect(constraints[0].ruleName).toBe('Complex_Formula');
        });

    });

    describe('groupConstraintsByField', () => {

        test('given constraints for multiple fields, groups them correctly by fieldApiName', () => {
            const constraints: ValidationRuleConstraint[] = [
                { fieldApiName: 'Amount', constraintType: 'numericMin', value: 100, rawFormula: 'Amount < 100', errorMessage: 'min', ruleName: 'R1' },
                { fieldApiName: 'Amount', constraintType: 'numericMax', value: 1000000, rawFormula: 'Amount > 1000000', errorMessage: 'max', ruleName: 'R2' },
                { fieldApiName: 'Description', constraintType: 'required', rawFormula: 'ISBLANK(Description)', errorMessage: 'req', ruleName: 'R3' }
            ];

            const grouped = ValidationRuleAnalyzerService.groupConstraintsByField(constraints);

            expect(Object.keys(grouped)).toHaveLength(2);
            expect(grouped['Amount']).toHaveLength(2);
            expect(grouped['Description']).toHaveLength(1);
        });

        test('given empty constraints array, returns empty grouped object', () => {
            const grouped = ValidationRuleAnalyzerService.groupConstraintsByField([]);
            expect(grouped).toEqual({});
        });

    });

    describe('buildUnknownRuleYamlComment', () => {

        test('given unknown constraint, returns YAML comment with rule name, message, and formula', () => {
            const constraint: ValidationRuleConstraint = {
                fieldApiName: 'StageName',
                constraintType: 'unknown',
                rawFormula: 'AND(ISPICKVAL(StageName, "Closed Won"), ISBLANK(CloseDate))',
                errorMessage: 'Complex rule error',
                ruleName: 'Complex_Formula'
            };

            const comment = ValidationRuleAnalyzerService.buildUnknownRuleYamlComment(constraint);

            expect(comment).toContain('# VALIDATION RULE "Complex_Formula"');
            expect(comment).toContain('Complex rule error');
            expect(comment).toContain(constraint.rawFormula);
        });

    });

    describe('buildDrivenByValidationRuleComment', () => {

        test('given single constraint, returns comment with quoted rule name', () => {
            const constraints: ValidationRuleConstraint[] = [{
                fieldApiName: 'Amount',
                constraintType: 'numericMin',
                value: 100,
                rawFormula: 'Amount < 100',
                errorMessage: 'Amount must be at least 100',
                ruleName: 'Opportunity_Validation_LessThanMax'
            }];

            const comment = ValidationRuleAnalyzerService.buildDrivenByValidationRuleComment(constraints);

            expect(comment).toBe('### Driven by ValidationRule "Opportunity_Validation_LessThanMax"');
        });

        test('given multiple constraints with different rule names, returns comma-separated quoted names', () => {
            const constraints: ValidationRuleConstraint[] = [
                {
                    fieldApiName: 'Amount',
                    constraintType: 'numericMin',
                    value: 100,
                    rawFormula: 'Amount < 100',
                    errorMessage: 'Amount too low',
                    ruleName: 'Rule_Min'
                },
                {
                    fieldApiName: 'Amount',
                    constraintType: 'numericMax',
                    value: 9999,
                    rawFormula: 'Amount > 9999',
                    errorMessage: 'Amount too high',
                    ruleName: 'Rule_Max'
                }
            ];

            const comment = ValidationRuleAnalyzerService.buildDrivenByValidationRuleComment(constraints);

            expect(comment).toBe('### Driven by ValidationRule "Rule_Min", "Rule_Max"');
        });

        test('given multiple constraints with the same rule name, deduplicates to single entry', () => {
            const constraints: ValidationRuleConstraint[] = [
                {
                    fieldApiName: 'Amount',
                    constraintType: 'numericMin',
                    value: 100,
                    rawFormula: 'Amount < 100',
                    errorMessage: 'Amount too low',
                    ruleName: 'Same_Rule'
                },
                {
                    fieldApiName: 'Amount',
                    constraintType: 'numericMax',
                    value: 9999,
                    rawFormula: 'Amount > 9999',
                    errorMessage: 'Amount too high',
                    ruleName: 'Same_Rule'
                }
            ];

            const comment = ValidationRuleAnalyzerService.buildDrivenByValidationRuleComment(constraints);

            expect(comment).toBe('### Driven by ValidationRule "Same_Rule"');
        });

    });

});
