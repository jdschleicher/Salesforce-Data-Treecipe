import * as xml2js from 'xml2js';

export type ValidationRuleConstraintType =
    | 'regex'
    | 'numericMin'
    | 'numericMax'
    | 'picklistExclude'
    | 'required'
    | 'lengthMin'
    | 'lengthMax'
    | 'dateMin'
    | 'dateMax'
    | 'dateRelativeMin'
    | 'dateRelativeMax'
    | 'unknown';

export interface ValidationRuleConstraint {
    fieldApiName: string;
    constraintType: ValidationRuleConstraintType;
    value?: string | number;
    rawFormula: string;
    errorMessage: string;
    ruleName: string;
}

export interface ParsedValidationRule {
    fullName: string;
    active: boolean;
    errorConditionFormula: string;
    errorMessage: string;
    description?: string;
    errorDisplayField?: string;
}

export class ValidationRuleAnalyzerService {

    // Regex patterns to recognize single-field formula shapes.
    // Each validation formula is TRUE when data is invalid, so constraints are inverted.

    // NOT(REGEX(FieldName, "pattern")) → field must match the pattern
    private static readonly REGEX_PATTERN = /^NOT\(REGEX\((\w+),\s*"([^"]+)"\)\)$/i;

    // FieldName < N → field must be >= N (numericMin)
    // FieldName <= N → field must be > N, i.e. numericMin = N + 1
    private static readonly NUMERIC_LT_PATTERN = /^(\w+)\s*(<=?)\s*(-?\d+(?:\.\d+)?)$/;

    // FieldName > N → field must be <= N (numericMax)
    // FieldName >= N → field must be < N, i.e. numericMax = N - 1
    private static readonly NUMERIC_GT_PATTERN = /^(\w+)\s*(>=?)\s*(-?\d+(?:\.\d+)?)$/;

    // ISPICKVAL(FieldName, "value") → field cannot equal "value"
    private static readonly ISPICKVAL_PATTERN = /^ISPICKVAL\((\w+),\s*"([^"]+)"\)$/i;

    // ISBLANK(FieldName) → field is required (must not be blank)
    private static readonly ISBLANK_PATTERN = /^ISBLANK\((\w+)\)$/i;

    // LEN(FieldName) > N → field length must be <= N (lengthMax)
    // LEN(FieldName) >= N → field length must be < N, i.e. lengthMax = N - 1
    private static readonly LEN_GT_PATTERN = /^LEN\((\w+)\)\s*(>=?)\s*(\d+)$/i;

    // LEN(FieldName) < N → field length must be >= N (lengthMin)
    // LEN(FieldName) <= N → field length must be > N, i.e. lengthMin = N + 1
    private static readonly LEN_LT_PATTERN = /^LEN\((\w+)\)\s*(<=?)\s*(\d+)$/i;

    // FieldName < TODAY() → field must be >= today (dateRelativeMin)
    // FieldName <= TODAY() → same
    private static readonly DATE_LT_TODAY_PATTERN = /^(\w+)\s*<=?\s*TODAY\(\)$/i;

    // FieldName > TODAY() → field must be <= today, i.e. in the past (dateRelativeMax)
    // FieldName >= TODAY() → same
    private static readonly DATE_GT_TODAY_PATTERN = /^(\w+)\s*>=?\s*TODAY\(\)$/i;

    // FieldName < DATE(Y, M, D) → field must be >= that date (dateMin)
    private static readonly DATE_LT_ABSOLUTE_PATTERN = /^(\w+)\s*<=?\s*DATE\(\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\)$/i;

    // FieldName > DATE(Y, M, D) → field must be <= that date (dateMax)
    private static readonly DATE_GT_ABSOLUTE_PATTERN = /^(\w+)\s*>=?\s*DATE\(\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\)$/i;

    static parseValidationRuleXml(xmlContent: string): ParsedValidationRule | null {

        let parsed: any;
        xml2js.parseString(xmlContent, (error, result) => {
            if (error) {
                throw new Error(`Error parsing validation rule XML: ${error.message}`);
            }
            parsed = result;
        });

        const rule = parsed?.ValidationRule;
        if (!rule) {
            return null;
        }

        const activeRaw = rule.active?.[0];
        const active = activeRaw === 'true';

        return {
            fullName: rule.fullName?.[0] ?? '',
            active,
            errorConditionFormula: rule.errorConditionFormula?.[0] ?? '',
            errorMessage: rule.errorMessage?.[0] ?? '',
            description: rule.description?.[0],
            errorDisplayField: rule.errorDisplayField?.[0]
        };

    }

    static extractConstraintsFromFormula(
        formula: string,
        errorMessage: string,
        ruleName: string
    ): ValidationRuleConstraint[] {

        const trimmed = formula.trim();

        const regexMatch = trimmed.match(this.REGEX_PATTERN);
        if (regexMatch) {
            return [{
                fieldApiName: regexMatch[1],
                constraintType: 'regex',
                value: regexMatch[2],
                rawFormula: formula,
                errorMessage,
                ruleName
            }];
        }

        const isblankMatch = trimmed.match(this.ISBLANK_PATTERN);
        if (isblankMatch) {
            return [{
                fieldApiName: isblankMatch[1],
                constraintType: 'required',
                rawFormula: formula,
                errorMessage,
                ruleName
            }];
        }

        const ispickvalMatch = trimmed.match(this.ISPICKVAL_PATTERN);
        if (ispickvalMatch) {
            return [{
                fieldApiName: ispickvalMatch[1],
                constraintType: 'picklistExclude',
                value: ispickvalMatch[2],
                rawFormula: formula,
                errorMessage,
                ruleName
            }];
        }

        const dateLtTodayMatch = trimmed.match(this.DATE_LT_TODAY_PATTERN);
        if (dateLtTodayMatch) {
            return [{
                fieldApiName: dateLtTodayMatch[1],
                constraintType: 'dateRelativeMin',
                value: 'TODAY',
                rawFormula: formula,
                errorMessage,
                ruleName
            }];
        }

        const dateGtTodayMatch = trimmed.match(this.DATE_GT_TODAY_PATTERN);
        if (dateGtTodayMatch) {
            return [{
                fieldApiName: dateGtTodayMatch[1],
                constraintType: 'dateRelativeMax',
                value: 'TODAY',
                rawFormula: formula,
                errorMessage,
                ruleName
            }];
        }

        const dateLtAbsoluteMatch = trimmed.match(this.DATE_LT_ABSOLUTE_PATTERN);
        if (dateLtAbsoluteMatch) {
            const iso = `${dateLtAbsoluteMatch[2]}-${dateLtAbsoluteMatch[3].padStart(2, '0')}-${dateLtAbsoluteMatch[4].padStart(2, '0')}`;
            return [{
                fieldApiName: dateLtAbsoluteMatch[1],
                constraintType: 'dateMin',
                value: iso,
                rawFormula: formula,
                errorMessage,
                ruleName
            }];
        }

        const dateGtAbsoluteMatch = trimmed.match(this.DATE_GT_ABSOLUTE_PATTERN);
        if (dateGtAbsoluteMatch) {
            const iso = `${dateGtAbsoluteMatch[2]}-${dateGtAbsoluteMatch[3].padStart(2, '0')}-${dateGtAbsoluteMatch[4].padStart(2, '0')}`;
            return [{
                fieldApiName: dateGtAbsoluteMatch[1],
                constraintType: 'dateMax',
                value: iso,
                rawFormula: formula,
                errorMessage,
                ruleName
            }];
        }

        const numericLtMatch = trimmed.match(this.NUMERIC_LT_PATTERN);
        if (numericLtMatch) {
            const operator = numericLtMatch[2];
            const rawNum = parseFloat(numericLtMatch[3]);
            // Formula: field < N or field <= N → error when field is too small → min valid value
            const minValue = operator === '<' ? rawNum : rawNum + 1;
            return [{
                fieldApiName: numericLtMatch[1],
                constraintType: 'numericMin',
                value: minValue,
                rawFormula: formula,
                errorMessage,
                ruleName
            }];
        }

        const numericGtMatch = trimmed.match(this.NUMERIC_GT_PATTERN);
        if (numericGtMatch) {
            const operator = numericGtMatch[2];
            const rawNum = parseFloat(numericGtMatch[3]);
            // Formula: field > N or field >= N → error when field is too large → max valid value
            const maxValue = operator === '>' ? rawNum : rawNum - 1;
            return [{
                fieldApiName: numericGtMatch[1],
                constraintType: 'numericMax',
                value: maxValue,
                rawFormula: formula,
                errorMessage,
                ruleName
            }];
        }

        const lenGtMatch = trimmed.match(this.LEN_GT_PATTERN);
        if (lenGtMatch) {
            const operator = lenGtMatch[2];
            const rawLen = parseInt(lenGtMatch[3], 10);
            // Formula: LEN(field) > N or >= N → error when too long → max valid length
            const maxLen = operator === '>' ? rawLen : rawLen - 1;
            return [{
                fieldApiName: lenGtMatch[1],
                constraintType: 'lengthMax',
                value: maxLen,
                rawFormula: formula,
                errorMessage,
                ruleName
            }];
        }

        const lenLtMatch = trimmed.match(this.LEN_LT_PATTERN);
        if (lenLtMatch) {
            const operator = lenLtMatch[2];
            const rawLen = parseInt(lenLtMatch[3], 10);
            // Formula: LEN(field) < N or <= N → error when too short → min valid length
            const minLen = operator === '<' ? rawLen : rawLen + 1;
            return [{
                fieldApiName: lenLtMatch[1],
                constraintType: 'lengthMin',
                value: minLen,
                rawFormula: formula,
                errorMessage,
                ruleName
            }];
        }

        // Formula is too complex to parse — return as unknown so caller can emit a YAML comment
        const referencedField = this.extractFirstFieldReferenceFromFormula(trimmed);
        return [{
            fieldApiName: referencedField ?? 'UNKNOWN_FIELD',
            constraintType: 'unknown',
            rawFormula: formula,
            errorMessage,
            ruleName
        }];

    }

    static getConstraintsFromValidationRuleXml(xmlContent: string): ValidationRuleConstraint[] {

        const parsed = this.parseValidationRuleXml(xmlContent);
        if (!parsed || !parsed.active) {
            return [];
        }

        return this.extractConstraintsFromFormula(
            parsed.errorConditionFormula,
            parsed.errorMessage,
            parsed.fullName
        );

    }

    static groupConstraintsByField(
        constraints: ValidationRuleConstraint[]
    ): Record<string, ValidationRuleConstraint[]> {

        const grouped: Record<string, ValidationRuleConstraint[]> = {};
        for (const constraint of constraints) {
            if (!grouped[constraint.fieldApiName]) {
                grouped[constraint.fieldApiName] = [];
            }
            grouped[constraint.fieldApiName].push(constraint);
        }
        return grouped;

    }

    static buildUnknownRuleYamlComment(constraint: ValidationRuleConstraint): string {
        return `# VALIDATION RULE "${constraint.ruleName}": ${constraint.errorMessage} | Formula: ${constraint.rawFormula}`;
    }

    private static extractFirstFieldReferenceFromFormula(formula: string): string | null {
        // Heuristic: grab the first word-token that looks like a field API name
        // (starts with a letter, may end with __c or be a standard field name)
        const match = formula.match(/\b([A-Za-z]\w*(?:__c)?)\b/);
        return match ? match[1] : null;
    }

}
