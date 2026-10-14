import * as xml2js from 'xml2js';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { RecipeFieldConstraint } from '../RecipeFakerService.ts/RecipeFieldConstraint/RecipeFieldConstraint';

/*
    What a validation rule says about the one field it names (#324, reviving #41). A rule's formula
    is TRUE when a record is INVALID, so each shape is read inverted: "Amount__c < 100" means a valid
    record has Amount__c >= 100.

    Every rule file is workspace text. Numbers and dates are PARSED and written back from what was
    parsed, never copied; a field reference must be an api name; a regex is translated into atoms a
    backend can generate from, or refused. Nothing here writes a recipe -- RecipeService decides what
    a field's rules come to, and each backend formats it.
*/

export type ValidationRuleConstraintType =
    | 'regex'
    | 'numericMin'
    | 'numericMax'
    | 'picklistExclude'
    | 'required'
    | 'lengthMin'
    | 'lengthMax'
    | 'dateMin'
    | 'dateMax';

// ONE PIECE OF A GENERATABLE REGEX: ONE OF characters, REPEATED min TO max TIMES; A LITERAL IS A SET OF ONE
export interface IValidationRuleRegexAtom {
    characters: string;
    min: number;
    max: number;
}

/*
    One rule's constraint on one field. value is canonical: a number's decimal digits, a length, a
    date bound in the form RecipeFieldConstraint stores one ("today", "+1d", "2024-01-31"), a picklist
    value, or the regex pattern as the formula's string literal reads. A numeric bound the formula
    excludes ("<=", ">=") is marked isExclusive, because the next value in depends on the field's scale.
*/
export interface IValidationRuleFieldConstraint {
    ruleName: string;
    fieldReference: string;
    type: ValidationRuleConstraintType;
    value?: string;
    isExclusive?: boolean;
    regexAtoms?: IValidationRuleRegexAtom[];
    // A SHAPE THAT MATCHED BUT CAN BE APPLIED TO NO FIELD (A REGEX NO BACKEND CAN GENERATE FROM, A DATE THAT DOES NOT EXIST)
    refusal?: string;
}

export interface IValidationRuleAnalysis {
    ruleName: string;
    constraint?: IValidationRuleFieldConstraint;
    notAppliedReason?: string;
}

// WHAT THE OBJECTS WRAPPER RECORDS PER FIELD: THE RULE, WHAT IT ASKS, AND WHETHER GENERATION APPLIED IT
export interface IValidationRuleConstraintRecord {
    ruleName: string;
    type: ValidationRuleConstraintType;
    value?: string;
    isExclusive?: boolean;
    applied: boolean;
    reason?: string;
}

// A RULE THAT NAMES NO FIELD THE WALK READ, OR MATCHES NO SHAPE: RECORDED ON THE OBJECT
export interface IValidationRuleNotApplied {
    ruleName: string;
    reason: string;
}

export const VALIDATION_RULE_FILE_SUFFIX = '.validationRule-meta.xml';
export const VALIDATION_RULES_DIRECTORY_NAME = 'validationRules';

// A FORMULA STRING HOLDING ANY OF THESE IS REFUSED: EACH OPENS A TEMPLATE IN ONE OF THE BACKENDS
export const VALIDATION_RULE_TEMPLATE_OPENERS = ['${{', '${%', '${', '{{', '{%', '<<', '<%'];

// SALESFORCE'S OWN LIMIT ON <errorConditionFormula>; A LONGER ONE CAME FROM NO ORG, AND IS REFUSED BEFORE ANY SHAPE IS MATCHED
export const VALIDATION_RULE_MAX_FORMULA_LENGTH = 3900;
export const VALIDATION_RULE_REGEX_MAX_ATOMS = 100;
export const VALIDATION_RULE_REGEX_MAX_REPEAT = 1000;
// "*", "+" AND "{n,}" HAVE NO END; A GENERATED VALUE STOPS THIS MANY REPEATS PAST THE MINIMUM
export const VALIDATION_RULE_REGEX_OPEN_REPEAT_SPAN = 8;

// LINE BREAKS FOR EITHER YAML PARSER AND EVERY OTHER CONTROL CHARACTER
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff]/;

const FIELD = '([^\\s(),<>=!"\']+)';
const OPERATOR = '(<=|>=|<|>)';
const STRING_LITERAL = '("(?:[^"\\\\]|\\\\[\\s\\S])*"|\'(?:[^\'\\\\]|\\\\[\\s\\S])*\')';
const NUMBER = '([+-]?\\d+(?:\\.\\d+)?)';

const REGEX_SHAPE = new RegExp(`^NOT\\s*\\(\\s*REGEX\\s*\\(\\s*${FIELD}\\s*,\\s*${STRING_LITERAL}\\s*\\)\\s*\\)$`, 'i');
const ISBLANK_SHAPE = new RegExp(`^ISBLANK\\s*\\(\\s*${FIELD}\\s*\\)$`, 'i');
const ISPICKVAL_SHAPE = new RegExp(`^ISPICKVAL\\s*\\(\\s*${FIELD}\\s*,\\s*${STRING_LITERAL}\\s*\\)$`, 'i');
const LEN_SHAPE = new RegExp(`^LEN\\s*\\(\\s*${FIELD}\\s*\\)\\s*${OPERATOR}\\s*(\\d{1,7})$`, 'i');
const TODAY_SHAPE = new RegExp(`^${FIELD}\\s*${OPERATOR}\\s*TODAY\\s*\\(\\s*\\)$`, 'i');
const DATE_SHAPE = new RegExp(`^${FIELD}\\s*${OPERATOR}\\s*DATE\\s*\\(\\s*(\\d{4})\\s*,\\s*(\\d{1,2})\\s*,\\s*(\\d{1,2})\\s*\\)$`, 'i');
const NUMERIC_SHAPE = new RegExp(`^${FIELD}\\s*${OPERATOR}\\s*${NUMBER}$`);

const DIGITS = '0123456789';
const UPPER_CASE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER_CASE_LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const ALPHANUMERIC = `${DIGITS}${UPPER_CASE_LETTERS}${LOWER_CASE_LETTERS}`;
const CLASS_SHORTHANDS: Readonly<Record<string, string>> = { d: DIGITS, w: `${ALPHANUMERIC}_`, s: ' ' };
const MILLISECONDS_PER_DAY = 86400000;

type RegexParseResult = { atoms: IValidationRuleRegexAtom[] } | { refusal: string };

export class ValidationRuleAnalyzerService {

    static isValidationRuleFileName(fileName: string): boolean {
        return fileName.endsWith(VALIDATION_RULE_FILE_SUFFIX) && fileName.length > VALIDATION_RULE_FILE_SUFFIX.length;
    }

    /*
        One rule file, or undefined for a rule that is not active -- only <active>true</active> rules
        are applied. A file that does not parse, or is not a ValidationRule, is a rule that was not
        applied rather than a failure of the walk reading it.
    */
    static async analyzeValidationRuleXml(xmlContent: string, fileName: string): Promise<IValidationRuleAnalysis | undefined> {

        const fileRuleName = fileName.endsWith(VALIDATION_RULE_FILE_SUFFIX) ? fileName.slice(0, -VALIDATION_RULE_FILE_SUFFIX.length) : fileName;

        let parsedXml: unknown;
        try {
            parsedXml = await xml2js.parseStringPromise(xmlContent);
        } catch {
            return { ruleName: fileRuleName, notAppliedReason: 'the file could not be parsed as XML' };
        }

        const validationRule = ( parsedXml as Record<string, unknown> | null )?.ValidationRule;
        if ( typeof validationRule !== 'object' || validationRule === null ) {
            return { ruleName: fileRuleName, notAppliedReason: 'the file is not a ValidationRule' };
        }

        const readText = (elementName: string): string | undefined => {
            const element = ( validationRule as Record<string, unknown> )[elementName];
            return Array.isArray(element) && element.length === 1 && typeof element[0] === 'string' ? element[0] : undefined;
        };

        if ( readText('active') !== 'true' ) {
            return undefined;
        }

        const ruleName = readText('fullName') ?? fileRuleName;
        const formula = readText('errorConditionFormula');
        if ( formula === undefined ) {
            return { ruleName: ruleName, notAppliedReason: 'it has no errorConditionFormula' };
        }

        return this.analyzeFormula(formula, ruleName);

    }

    /*
        The single-field shapes #41 recognised. Anything else -- AND/OR, two fields, a cross-object
        reference, a function this does not know -- is not applied, never partly applied.
    */
    static analyzeFormula(formula: string, ruleName: string): IValidationRuleAnalysis {

        if ( formula.length > VALIDATION_RULE_MAX_FORMULA_LENGTH ) {
            return { ruleName: ruleName, notAppliedReason: `its formula is longer than the ${VALIDATION_RULE_MAX_FORMULA_LENGTH} characters Salesforce allows` };
        }

        const trimmedFormula = formula.trim();
        const shaped = (fieldReference: string, constraint: Omit<IValidationRuleFieldConstraint, 'ruleName' | 'fieldReference'>): IValidationRuleAnalysis =>
            SalesforceApiName.isApiName(fieldReference)
                ? { ruleName: ruleName, constraint: { ruleName: ruleName, fieldReference: fieldReference, ...constraint } }
                : { ruleName: ruleName, notAppliedReason: `it names "${fieldReference}", which is not a field api name` };

        const regexMatch = REGEX_SHAPE.exec(trimmedFormula);
        if ( regexMatch ) {
            const pattern = this.readFormulaStringLiteral(regexMatch[2]);
            const parsedPattern = this.parseGeneratableRegex(pattern);
            return shaped(regexMatch[1], 'atoms' in parsedPattern
                ? { type: 'regex', value: pattern, regexAtoms: parsedPattern.atoms }
                : { type: 'regex', value: pattern, refusal: parsedPattern.refusal });
        }

        const isBlankMatch = ISBLANK_SHAPE.exec(trimmedFormula);
        if ( isBlankMatch ) {
            return shaped(isBlankMatch[1], { type: 'required' });
        }

        const isPickValMatch = ISPICKVAL_SHAPE.exec(trimmedFormula);
        if ( isPickValMatch ) {
            return shaped(isPickValMatch[1], { type: 'picklistExclude', value: this.readFormulaStringLiteral(isPickValMatch[2]) });
        }

        const lengthMatch = LEN_SHAPE.exec(trimmedFormula);
        if ( lengthMatch ) {
            return shaped(lengthMatch[1], this.buildLengthConstraint(lengthMatch[2], Number(lengthMatch[3])));
        }

        const todayMatch = TODAY_SHAPE.exec(trimmedFormula);
        if ( todayMatch ) {
            return shaped(todayMatch[1], this.buildRelativeDateConstraint(todayMatch[2]));
        }

        const dateMatch = DATE_SHAPE.exec(trimmedFormula);
        if ( dateMatch ) {
            return shaped(dateMatch[1], this.buildAbsoluteDateConstraint(dateMatch[2], Number(dateMatch[3]), Number(dateMatch[4]), Number(dateMatch[5])));
        }

        const numericMatch = NUMERIC_SHAPE.exec(trimmedFormula);
        if ( numericMatch && !/^(?:TODAY|NOW|DATE)$/i.test(numericMatch[1]) ) {
            const isMinimum = numericMatch[2].startsWith('<');
            return shaped(numericMatch[1], {
                type: isMinimum ? 'numericMin' : 'numericMax',
                value: this.canonicalizeNumber(numericMatch[3]),
                isExclusive: numericMatch[2].endsWith('=')
            });
        }

        return { ruleName: ruleName, notAppliedReason: 'its formula is not one of the single-field shapes Treecipe applies' };

    }

    // LEN(f) < N MEANS A VALID VALUE IS AT LEAST N LONG; "<=" AT LEAST N + 1; ">" AT MOST N; ">=" AT MOST N - 1
    private static buildLengthConstraint(operator: string, length: number): Omit<IValidationRuleFieldConstraint, 'ruleName' | 'fieldReference'> {

        if ( operator.startsWith('<') ) {
            return { type: 'lengthMin', value: String(operator === '<=' ? length + 1 : length) };
        }
        if ( operator === '>=' && length === 0 ) {
            return { type: 'lengthMax', value: '0', refusal: 'no length is less than 0' };
        }
        return { type: 'lengthMax', value: String(operator === '>=' ? length - 1 : length) };

    }

    // A Date FIELD AGAINST TODAY(): "<" IS "ON OR AFTER TODAY", "<=" IS "AFTER TODAY", AND SO ON, A DAY AT A TIME
    private static buildRelativeDateConstraint(operator: string): Omit<IValidationRuleFieldConstraint, 'ruleName' | 'fieldReference'> {

        const relativeDaysByOperator: Record<string, string> = { '<': 'today', '<=': '+1d', '>': 'today', '>=': '-1d' };
        return { type: operator.startsWith('<') ? 'dateMin' : 'dateMax', value: relativeDaysByOperator[operator] };

    }

    private static buildAbsoluteDateConstraint(operator: string, year: number, month: number, day: number): Omit<IValidationRuleFieldConstraint, 'ruleName' | 'fieldReference'> {

        const type = operator.startsWith('<') ? 'dateMin' : 'dateMax';
        const isoDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if ( !RecipeFieldConstraint.isCalendarDate(isoDate) ) {
            return { type: type, value: isoDate, refusal: `DATE(${year}, ${month}, ${day}) is not a date` };
        }

        const shiftDays = operator === '<=' ? 1 : ( operator === '>=' ? -1 : 0 );
        const shiftedDate = new Date(Date.parse(`${isoDate}T00:00:00Z`) + shiftDays * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
        return { type: type, value: shiftedDate };

    }

    // "+007.50" IS "7.50" AND "-0" IS "0": WRITTEN FROM THE PARSED DIGITS, NEVER FROM THE FORMULA'S TEXT
    static canonicalizeNumber(numberText: string): string {

        const [, sign, wholeDigits, decimalDigits] = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(numberText) as RegExpExecArray;
        const whole = wholeDigits.replace(/^0+(?=\d)/, '');
        const isZero = /^0+$/.test(wholeDigits) && /^0*$/.test(decimalDigits ?? '');
        return `${sign === '-' && !isZero ? '-' : ''}${whole}${decimalDigits !== undefined ? `.${decimalDigits}` : ''}`;

    }

    // A FORMULA STRING LITERAL, QUOTES REMOVED AND ITS BACKSLASH ESCAPES READ: "\\d{3}" IS THE PATTERN \d{3}
    static readFormulaStringLiteral(literal: string): string {

        const escapedCharacters: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
        return literal
            .slice(1, -1)
            .replace(/\\([\s\S])/g, (unusedMatch, escapedCharacter: string) => escapedCharacters[escapedCharacter] ?? escapedCharacter);

    }

    /*
        A Salesforce REGEX matches the WHOLE value, so a pattern is a sequence of atoms -- a literal, a
        character class, ".", \d, \w or \s -- each with an optional quantifier, and a value made of
        one draw per atom always matches. Groups, alternation, back-references, lookarounds and
        anything else a sequence cannot express are refused rather than approximated, as is a
        pattern that holds a template opener or a control character.
    */
    static parseGeneratableRegex(pattern: string): RegexParseResult {

        if ( CONTROL_CHARACTER_PATTERN.test(pattern) ) {
            return { refusal: 'the pattern contains a line break or control character' };
        }
        const templateOpener = VALIDATION_RULE_TEMPLATE_OPENERS.find(opener => pattern.includes(opener));
        if ( templateOpener !== undefined ) {
            return { refusal: `the pattern contains "${templateOpener}", which opens a template` };
        }

        let body = pattern.startsWith('^') ? pattern.slice(1) : pattern;
        // A "$" IS AN ANCHOR WHEN AN EVEN NUMBER OF BACKSLASHES PRECEDES IT; COUNTED BACKWARDS, BECAUSE AN UNANCHORED /\\*\$$/ IS QUADRATIC IN A BACKSLASH RUN
        if ( body.endsWith('$') ) {
            let backslashIndex = body.length - 2;
            while ( backslashIndex >= 0 && body[backslashIndex] === '\\' ) {
                backslashIndex--;
            }
            if ( ( body.length - 2 - backslashIndex ) % 2 === 0 ) {
                body = body.slice(0, -1);
            }
        }
        if ( body.length === 0 ) {
            return { refusal: 'the pattern matches only an empty value' };
        }

        const atoms: IValidationRuleRegexAtom[] = [];
        let position = 0;

        while ( position < body.length ) {

            const atomResult = this.readRegexAtom(body, position);
            if ( 'refusal' in atomResult ) {
                return { refusal: atomResult.refusal };
            }
            const quantifierResult = this.readRegexQuantifier(body, atomResult.nextPosition);
            if ( 'refusal' in quantifierResult ) {
                return { refusal: quantifierResult.refusal };
            }

            atoms.push({ characters: atomResult.characters, min: quantifierResult.min, max: quantifierResult.max });
            if ( atoms.length > VALIDATION_RULE_REGEX_MAX_ATOMS ) {
                return { refusal: `the pattern has more than ${VALIDATION_RULE_REGEX_MAX_ATOMS} parts` };
            }
            position = quantifierResult.nextPosition;

        }

        return { atoms: atoms };

    }

    private static readRegexAtom(body: string, position: number): { characters: string; nextPosition: number } | { refusal: string } {

        const character = body[position];

        if ( character === '[' ) {
            return this.readRegexCharacterClass(body, position);
        }
        if ( character === '.' ) {
            return { characters: ALPHANUMERIC, nextPosition: position + 1 };
        }
        if ( character === '\\' ) {
            const escapedCharacter = body[position + 1];
            if ( escapedCharacter === undefined ) {
                return { refusal: 'the pattern ends in a lone backslash' };
            }
            if ( Object.prototype.hasOwnProperty.call(CLASS_SHORTHANDS, escapedCharacter) ) {
                return { characters: CLASS_SHORTHANDS[escapedCharacter], nextPosition: position + 2 };
            }
            if ( this.isPrintableAscii(escapedCharacter) && !/[A-Za-z0-9]/.test(escapedCharacter) ) {
                return { characters: escapedCharacter, nextPosition: position + 2 };
            }
            return { refusal: `the pattern uses \\${escapedCharacter}, which Treecipe cannot generate from` };
        }
        if ( '(|)'.includes(character) ) {
            return { refusal: 'the pattern uses a group or alternation, which Treecipe cannot generate from' };
        }
        if ( '{?*+^$'.includes(character) ) {
            return { refusal: `the pattern has "${character}" where a character was expected` };
        }
        if ( !this.isPrintableAscii(character) ) {
            return { refusal: 'the pattern contains a character outside printable ASCII' };
        }
        return { characters: character, nextPosition: position + 1 };

    }

    private static readRegexCharacterClass(body: string, position: number): { characters: string; nextPosition: number } | { refusal: string } {

        let index = position + 1;
        const isNegated = body[index] === '^';
        if ( isNegated ) {
            index++;
        }

        const members = new Set<string>();
        let isFirstMember = true;

        const readMember = (): { characters: string } | { refusal: string } => {
            const memberCharacter = body[index];
            if ( memberCharacter === '\\' ) {
                const escapedCharacter = body[index + 1];
                index += 2;
                if ( escapedCharacter !== undefined && Object.prototype.hasOwnProperty.call(CLASS_SHORTHANDS, escapedCharacter) ) {
                    return { characters: CLASS_SHORTHANDS[escapedCharacter] };
                }
                if ( escapedCharacter !== undefined && this.isPrintableAscii(escapedCharacter) && !/[A-Za-z0-9]/.test(escapedCharacter) ) {
                    return { characters: escapedCharacter };
                }
                return { refusal: `the pattern uses \\${escapedCharacter ?? ''} in a character class, which Treecipe cannot generate from` };
            }
            if ( memberCharacter === '[' || ( memberCharacter === '&' && body[index + 1] === '&' ) ) {
                return { refusal: 'the pattern nests or intersects character classes, which Treecipe cannot generate from' };
            }
            if ( !this.isPrintableAscii(memberCharacter) ) {
                return { refusal: 'the pattern contains a character outside printable ASCII' };
            }
            index++;
            return { characters: memberCharacter };
        };

        while ( index < body.length && !( body[index] === ']' && !isFirstMember ) ) {

            if ( body[index] === ']' ) {
                return { refusal: 'the pattern has an empty character class' };
            }

            const startMember = readMember();
            if ( 'refusal' in startMember ) {
                return startMember;
            }
            isFirstMember = false;

            const isRange = startMember.characters.length === 1 && body[index] === '-' && index + 1 < body.length && body[index + 1] !== ']';
            if ( !isRange ) {
                [...startMember.characters].forEach(member => members.add(member));
                continue;
            }

            index++;
            const endMember = readMember();
            if ( 'refusal' in endMember ) {
                return endMember;
            }
            const rangeStart = startMember.characters.charCodeAt(0);
            const rangeEnd = endMember.characters.charCodeAt(0);
            if ( endMember.characters.length !== 1 || rangeStart > rangeEnd ) {
                return { refusal: 'the pattern has a character range that is out of order' };
            }
            for ( let codePoint = rangeStart; codePoint <= rangeEnd; codePoint++ ) {
                members.add(String.fromCharCode(codePoint));
            }

        }

        if ( index >= body.length ) {
            return { refusal: 'the pattern has a character class that is never closed' };
        }

        // A NEGATED CLASS IS DRAWN FROM LETTERS AND DIGITS ONLY: EVERY ONE IT LEAVES MATCHES, AND NONE IS PUNCTUATION AN INSERT MIGHT TRIM OR REFUSE
        const characters = isNegated
            ? [...ALPHANUMERIC].filter(candidate => !members.has(candidate)).join('')
            : [...members].sort((first, second) => first.charCodeAt(0) - second.charCodeAt(0)).join('');

        return characters.length === 0
            ? { refusal: 'the pattern has a character class no character satisfies' }
            : { characters: characters, nextPosition: index + 1 };

    }

    private static readRegexQuantifier(body: string, position: number): { min: number; max: number; nextPosition: number } | { refusal: string } {

        const quantifierCharacter = body[position];
        let min = 1;
        let max = 1;
        let nextPosition = position;

        if ( quantifierCharacter === '?' || quantifierCharacter === '*' || quantifierCharacter === '+' ) {
            min = quantifierCharacter === '+' ? 1 : 0;
            max = quantifierCharacter === '?' ? 1 : min + VALIDATION_RULE_REGEX_OPEN_REPEAT_SPAN;
            nextPosition = position + 1;
        } else if ( quantifierCharacter === '{' ) {
            const repeatMatch = /^\{(\d{1,4})(,(\d{0,4}))?\}/.exec(body.slice(position));
            if ( !repeatMatch ) {
                return { refusal: 'the pattern has a "{" that is not a repeat count' };
            }
            min = Number(repeatMatch[1]);
            max = repeatMatch[2] === undefined
                ? min
                : ( repeatMatch[3] === '' ? min + VALIDATION_RULE_REGEX_OPEN_REPEAT_SPAN : Number(repeatMatch[3]) );
            nextPosition = position + repeatMatch[0].length;
        } else {
            return { min: min, max: max, nextPosition: nextPosition };
        }

        if ( min > max ) {
            return { refusal: 'the pattern has a repeat count that is out of order' };
        }
        if ( max > VALIDATION_RULE_REGEX_MAX_REPEAT ) {
            return { refusal: `the pattern repeats a part more than ${VALIDATION_RULE_REGEX_MAX_REPEAT} times` };
        }
        // A LAZY "?" MATCHES THE SAME VALUES; A POSSESSIVE "+" DOES NOT, SO IT IS REFUSED
        if ( body[nextPosition] === '?' ) {
            nextPosition++;
        } else if ( body[nextPosition] === '+' ) {
            return { refusal: 'the pattern uses a possessive quantifier, which Treecipe cannot generate from' };
        }
        if ( nextPosition < body.length && '?*+{'.includes(body[nextPosition]) ) {
            return { refusal: 'the pattern repeats a repeat, which Treecipe cannot generate from' };
        }

        return { min: min, max: max, nextPosition: nextPosition };

    }

    private static isPrintableAscii(character: string): boolean {
        return character !== undefined && character.length === 1 && character >= ' ' && character <= '~';
    }

    // FIELD REFERENCES IN A FORMULA ARE CASE-INSENSITIVE, SO THE ANALYSES ARE KEYED BY THE LOWER-CASED NAME
    static groupConstraintsByFieldReference(analyses: IValidationRuleAnalysis[]): Map<string, IValidationRuleFieldConstraint[]> {

        const constraintsByFieldReference = new Map<string, IValidationRuleFieldConstraint[]>();
        analyses.forEach(analysis => {
            if ( analysis.constraint === undefined ) {
                return;
            }
            const fieldKey = analysis.constraint.fieldReference.toLowerCase();
            constraintsByFieldReference.set(fieldKey, [...( constraintsByFieldReference.get(fieldKey) ?? [] ), analysis.constraint]);
        });
        return constraintsByFieldReference;

    }

}
