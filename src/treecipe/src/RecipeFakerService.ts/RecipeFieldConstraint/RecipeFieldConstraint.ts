/*
    A field's faker constraint (#323): the bounds a reader set on a field in the Recipe Cockpit, and
    the one rule both faker backends, the cockpit host and the panel's host-side checks hold them to.
    It imports NOTHING, so a backend and the recipe writer can depend on it without a cycle.

    What is STORED is what the reader typed, one optional string per bound; an absent bound is the
    default. What a backend is handed is RESOLVED: both bounds present, in order, inside what the
    field's metadata allows, and in a form the backend writes without escaping -- a number is
    canonical decimal digits, a date bound is a whole number of days from the run or a UTC instant.
*/

export type RecipeFieldConstraintKind = 'number' | 'length' | 'date';

export interface IStoredRecipeFieldConstraint {
    min?: string;
    max?: string;
}

export type RecipeFieldConstraintDateBound = { relativeDays: number } | { utcDateTime: string };

export type ResolvedRecipeFieldConstraint =
    | { kind: 'number'; min: string; max: string; scale: number }
    | { kind: 'length'; min: number; max: number }
    | { kind: 'date'; from: RecipeFieldConstraintDateBound; to: RecipeFieldConstraintDateBound };

// WHAT THE CONSTRAINT IS CHECKED AGAINST: THE FIELD'S METADATA TYPE AND THE SIZE ITS XML RECORDS, WHEN IT RECORDS ONE
export interface IRecipeFieldConstraintTarget {
    fieldType: string;
    length?: number;
    precision?: number;
    scale?: number;
}

export type RecipeFieldConstraintResolution = { constraint: ResolvedRecipeFieldConstraint } | { refusal: string };

export const RECIPE_FIELD_CONSTRAINT_NUMBER_FIELD_TYPES = ['Number', 'Currency', 'Percent'];
export const RECIPE_FIELD_CONSTRAINT_LENGTH_FIELD_TYPES = ['Text', 'TextArea', 'LongTextArea'];
export const RECIPE_FIELD_CONSTRAINT_DATE_FIELD_TYPES = ['Date', 'DateTime'];

// A DOUBLE HOLDS 15 SIGNIFICANT DIGITS EXACTLY; faker-js GENERATES IN DOUBLES, SO A BOUND PAST THAT IS NOT THE BOUND TYPED
export const RECIPE_FIELD_CONSTRAINT_MAX_NUMBER_DIGITS = 15;
export const RECIPE_FIELD_CONSTRAINT_DEFAULT_NUMBER_MAX = 999999;
export const RECIPE_FIELD_CONSTRAINT_MAX_RELATIVE_DAYS = 36500;
export const RECIPE_FIELD_CONSTRAINT_DEFAULT_SPAN_DAYS = 365;
export const RECIPE_FIELD_CONSTRAINT_MAX_BOUND_LENGTH = 40;

// A FIELD WHOSE XML RECORDS NO <length>: TextArea IS ALWAYS 255; THE OTHERS CARRY ONE, SO THIS IS ONLY A CEILING FOR AN OLDER RUN
export const RECIPE_FIELD_CONSTRAINT_DEFAULT_LENGTHS: Readonly<Record<string, number>> = { Text: 255, TextArea: 255, LongTextArea: 131072 };

const NUMBER_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;
const RELATIVE_DAYS_PATTERN = /^([+-]?)(\d{1,5})d$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?Z?$/;
const MILLISECONDS_PER_DAY = 86400000;
// THE SIZES SALESFORCE ALLOWS; THE OBJECTS WRAPPER IS A WORKSPACE FILE, SO A SIZE OUTSIDE THEM IS REFUSED RATHER THAN BUILT FROM
const MAX_PRECISION = 18;
const MAX_LENGTH = 131072;

export class RecipeFieldConstraint {

    static getConstraintKind(fieldType: string): RecipeFieldConstraintKind | undefined {

        if ( RECIPE_FIELD_CONSTRAINT_NUMBER_FIELD_TYPES.includes(fieldType) ) {
            return 'number';
        }
        if ( RECIPE_FIELD_CONSTRAINT_LENGTH_FIELD_TYPES.includes(fieldType) ) {
            return 'length';
        }
        if ( RECIPE_FIELD_CONSTRAINT_DATE_FIELD_TYPES.includes(fieldType) ) {
            return 'date';
        }
        return undefined;

    }

    /*
        What a stored bound may be at all, before the field it belongs to is known: short, and in one
        of the forms some kind takes. Read from workspaceState, which is a file on disk, so a bound
        that is neither is dropped there rather than handed to a backend.
    */
    static isStorableBound(bound: unknown): bound is string {

        return typeof bound === 'string'
            && bound.length > 0
            && bound.length <= RECIPE_FIELD_CONSTRAINT_MAX_BOUND_LENGTH
            && ( NUMBER_PATTERN.test(bound) || RELATIVE_DAYS_PATTERN.test(bound) || bound === 'today'
                || ISO_DATE_PATTERN.test(bound) || ISO_DATE_TIME_PATTERN.test(bound) );

    }

    static isStoredConstraint(storedConstraint: unknown): storedConstraint is IStoredRecipeFieldConstraint {

        if ( typeof storedConstraint !== 'object' || storedConstraint === null || Array.isArray(storedConstraint) ) {
            return false;
        }
        const { min, max } = storedConstraint as Record<string, unknown>;
        return ( min !== undefined || max !== undefined )
            && ( min === undefined || this.isStorableBound(min) )
            && ( max === undefined || this.isStorableBound(max) );

    }

    // WHY ONE TYPED BOUND CANNOT BE A BOUND OF THIS FIELD, ON ITS OWN, OR undefined; THE ORDER OF THE TWO IS resolve's
    static checkBound(target: IRecipeFieldConstraintTarget, bound: string, boundName: 'min' | 'max'): string | undefined {

        const kind = this.getConstraintKind(target.fieldType);
        const targetRefusal = this.findTargetRefusal(target);

        if ( targetRefusal !== undefined ) {
            return targetRefusal;
        }

        if ( kind === 'number' ) {
            return this.checkNumberBound(target, bound);
        }
        if ( kind === 'length' ) {
            return this.checkLengthBound(target, bound);
        }
        if ( kind === 'date' ) {
            return this.parseDateBound(target, bound) === undefined
                ? this.describeDateForm(target, boundName)
                : undefined;
        }
        return 'This field type has no faker constraints.';

    }

    /*
        The constraint a backend is handed, or why there is none: each typed bound checked on its own,
        the absent ones filled with defaults that cannot cross the typed one, then the order. now is
        what a relative date is measured from when the two bounds' order is compared; a backend still
        writes a relative bound as relative, so the run measures it again.
    */
    static resolve(target: IRecipeFieldConstraintTarget, storedConstraint: IStoredRecipeFieldConstraint, now: Date = new Date()): RecipeFieldConstraintResolution {

        const kind = this.getConstraintKind(target.fieldType);

        if ( kind === undefined ) {
            return { refusal: 'This field type has no faker constraints.' };
        }
        const targetRefusal = this.findTargetRefusal(target);
        if ( targetRefusal !== undefined ) {
            return { refusal: targetRefusal };
        }
        if ( storedConstraint.min === undefined && storedConstraint.max === undefined ) {
            return { refusal: 'Set at least one bound.' };
        }

        for ( const boundName of ['min', 'max'] as const ) {
            const bound = storedConstraint[boundName];
            const boundRefusal = bound === undefined ? undefined : this.checkBound(target, bound, boundName);
            if ( boundRefusal !== undefined ) {
                return { refusal: boundRefusal };
            }
        }

        if ( kind === 'number' ) {
            return this.resolveNumber(target, storedConstraint);
        }
        if ( kind === 'length' ) {
            return this.resolveLength(target, storedConstraint);
        }
        return this.resolveDate(target, storedConstraint, now);

    }

    // THE FORM A DATE BOUND IS TYPED IN, FOR AN INPUT BOX'S PROMPT AND ITS REFUSAL
    static describeDateForm(target: IRecipeFieldConstraintTarget, boundName: 'min' | 'max'): string {

        const example = boundName === 'min' ? '-30d' : '+90d';
        return target.fieldType === 'DateTime'
            ? `Type a date as YYYY-MM-DD, a UTC time as YYYY-MM-DDTHH:MM:SSZ, today, or days from the run such as ${example}.`
            : `Type a date as YYYY-MM-DD, today, or days from the run such as ${example}.`;

    }

    static findTargetRefusal(target: IRecipeFieldConstraintTarget): string | undefined {

        const isWholeNumberIn = (value: number | undefined, minimum: number, maximum: number) => value === undefined || ( Number.isInteger(value) && value >= minimum && value <= maximum );

        return isWholeNumberIn(target.precision, 1, MAX_PRECISION)
                && isWholeNumberIn(target.scale, 0, target.precision ?? MAX_PRECISION)
                && isWholeNumberIn(target.length, 1, MAX_LENGTH)
            ? undefined
            : 'The size recorded for this field is not one Salesforce allows, so it cannot be constrained.';

    }

    static getNumberCeilingDigits(target: IRecipeFieldConstraintTarget): number {
        return target.precision !== undefined
            ? Math.min(target.precision - ( target.scale ?? 0 ), RECIPE_FIELD_CONSTRAINT_MAX_NUMBER_DIGITS)
            : RECIPE_FIELD_CONSTRAINT_MAX_NUMBER_DIGITS;
    }

    static getLengthCeiling(target: IRecipeFieldConstraintTarget): number {
        return target.length ?? RECIPE_FIELD_CONSTRAINT_DEFAULT_LENGTHS[target.fieldType] ?? RECIPE_FIELD_CONSTRAINT_DEFAULT_LENGTHS.Text;
    }

    private static checkNumberBound(target: IRecipeFieldConstraintTarget, bound: string): string | undefined {

        const numberMatch = NUMBER_PATTERN.exec(bound);
        if ( !numberMatch ) {
            return 'Type a plain number, such as 42, -7 or 3.25.';
        }

        const wholeDigits = numberMatch[2].replace(/^0+/, '');
        const decimalDigits = numberMatch[3] ?? '';
        const scale = target.scale ?? 0;

        if ( decimalDigits.length > scale ) {
            return scale === 0
                ? 'This field takes whole numbers only.'
                : `This field takes at most ${scale} decimal place${scale === 1 ? '' : 's'}.`;
        }

        const ceilingDigits = this.getNumberCeilingDigits(target);
        if ( wholeDigits.length > ceilingDigits ) {
            return ceilingDigits === 0
                ? 'This field takes no digits before the decimal point.'
                : `This field takes at most ${ceilingDigits} digit${ceilingDigits === 1 ? '' : 's'} before the decimal point${target.precision !== undefined ? ` (precision ${target.precision}, scale ${scale})` : ''}.`;
        }
        if ( wholeDigits.length + decimalDigits.length > RECIPE_FIELD_CONSTRAINT_MAX_NUMBER_DIGITS ) {
            return `A bound can have at most ${RECIPE_FIELD_CONSTRAINT_MAX_NUMBER_DIGITS} digits.`;
        }

        return undefined;

    }

    private static checkLengthBound(target: IRecipeFieldConstraintTarget, bound: string): string | undefined {

        if ( !/^\d{1,7}$/.test(bound) ) {
            return 'Type a length as a whole number of characters, such as 10.';
        }

        const ceiling = this.getLengthCeiling(target);
        if ( Number(bound) > ceiling ) {
            return `This field takes at most ${ceiling} characters.`;
        }

        return undefined;

    }

    // "0042.50" IS "42.50" AND "-0" IS "0": DIGITS ONLY, SO A BACKEND WRITES IT AS A LITERAL WITHOUT ESCAPING
    private static canonicalizeNumber(bound: string): string {

        const [, sign, whole, decimals] = NUMBER_PATTERN.exec(bound) as RegExpExecArray;
        const canonicalWhole = whole.replace(/^0+(?=\d)/, '');
        const isZero = /^0+$/.test(whole) && /^0*$/.test(decimals ?? '');

        return `${sign && !isZero ? '-' : ''}${canonicalWhole}${decimals !== undefined ? `.${decimals}` : ''}`;

    }

    private static resolveNumber(target: IRecipeFieldConstraintTarget, storedConstraint: IStoredRecipeFieldConstraint): RecipeFieldConstraintResolution {

        const scale = target.scale ?? 0;
        const ceilingDigits = this.getNumberCeilingDigits(target);
        // THE LARGEST VALUE THE FIELD HOLDS: precision - scale NINES, THEN scale NINES AFTER THE POINT
        const ceiling = `${ceilingDigits > 0 ? '9'.repeat(ceilingDigits) : '0'}${scale > 0 ? `.${'9'.repeat(scale)}` : ''}`;
        const unsizedDefaultMax = String(RECIPE_FIELD_CONSTRAINT_DEFAULT_NUMBER_MAX);

        const typedMin = storedConstraint.min === undefined ? undefined : this.canonicalizeNumber(storedConstraint.min);
        const typedMax = storedConstraint.max === undefined ? undefined : this.canonicalizeNumber(storedConstraint.max);

        const min = typedMin ?? ( typedMax !== undefined && Number(typedMax) <= 0 ? `-${ceiling}` : '0' );
        const defaultMax = target.precision === undefined && Number(min) <= RECIPE_FIELD_CONSTRAINT_DEFAULT_NUMBER_MAX ? unsizedDefaultMax : ceiling;
        const max = typedMax ?? defaultMax;

        if ( Number(min) > Number(max) ) {
            return { refusal: `The minimum ${min} is greater than the maximum ${max}.` };
        }
        // Faker's pydecimal REFUSES EQUAL BOUNDS, AND ONE VALUE ON EVERY RECORD IS WHAT A FIXED VALUE IS FOR
        if ( Number(min) === Number(max) ) {
            return { refusal: `The minimum and maximum are both ${min}; give the field a fixed value instead.` };
        }

        return { constraint: { kind: 'number', min: min, max: max, scale: scale } };

    }

    private static resolveLength(target: IRecipeFieldConstraintTarget, storedConstraint: IStoredRecipeFieldConstraint): RecipeFieldConstraintResolution {

        const typedMin = storedConstraint.min === undefined ? undefined : Number(storedConstraint.min);
        const typedMax = storedConstraint.max === undefined ? undefined : Number(storedConstraint.max);

        const max = typedMax ?? this.getLengthCeiling(target);
        const min = typedMin ?? Math.min(1, max);

        if ( min > max ) {
            return { refusal: `The minimum length ${min} is greater than the maximum length ${max}.` };
        }

        return { constraint: { kind: 'length', min: min, max: max } };

    }

    /*
        A date bound as typed: days from the run ("-30d", "+90d", "today"), or an instant -- a date, or
        for a DateTime a UTC time, held as YYYY-MM-DDTHH:MM:SS so a backend writes it without parsing.
        A calendar date that does not exist (2026-02-30) is refused, not rolled over.
    */
    static parseDateBound(target: IRecipeFieldConstraintTarget, bound: string): RecipeFieldConstraintDateBound | undefined {

        if ( bound === 'today' ) {
            return { relativeDays: 0 };
        }

        const relativeMatch = RELATIVE_DAYS_PATTERN.exec(bound);
        if ( relativeMatch ) {
            const days = Number(relativeMatch[2]);
            return days <= RECIPE_FIELD_CONSTRAINT_MAX_RELATIVE_DAYS
                ? { relativeDays: relativeMatch[1] === '-' && days !== 0 ? -days : days }
                : undefined;
        }

        if ( this.isCalendarDate(bound) ) {
            return { utcDateTime: `${bound}T00:00:00` };
        }

        const dateTimeMatch = ISO_DATE_TIME_PATTERN.exec(bound);
        if ( target.fieldType === 'DateTime' && dateTimeMatch && this.isCalendarDate(dateTimeMatch[1]) ) {
            return { utcDateTime: `${dateTimeMatch[1]}T${dateTimeMatch[2]}:${dateTimeMatch[3]}:${dateTimeMatch[4] ?? '00'}` };
        }

        return undefined;

    }

    static isCalendarDate(value: string): boolean {

        const dateMatch = ISO_DATE_PATTERN.exec(value);
        if ( !dateMatch ) {
            return false;
        }
        const parsedDate = new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])));
        return parsedDate.getUTCFullYear() === Number(dateMatch[1])
                && parsedDate.getUTCMonth() === Number(dateMatch[2]) - 1
                && parsedDate.getUTCDate() === Number(dateMatch[3])
                && Number(dateMatch[1]) >= 1700 && Number(dateMatch[1]) <= 4000;

    }

    // A Date FIELD IS COMPARED BY UTC DAY: "today" IS THE WHOLE DAY, NOT THE INSTANT THE CHECK RAN
    static toComparableMilliseconds(target: IRecipeFieldConstraintTarget, dateBound: RecipeFieldConstraintDateBound, now: Date): number {
        const milliseconds = this.toEpochMilliseconds(dateBound, now);
        return target.fieldType === 'Date' ? Math.floor(milliseconds / MILLISECONDS_PER_DAY) * MILLISECONDS_PER_DAY : milliseconds;
    }

    static toEpochMilliseconds(dateBound: RecipeFieldConstraintDateBound, now: Date): number {
        return 'relativeDays' in dateBound
            ? now.getTime() + dateBound.relativeDays * MILLISECONDS_PER_DAY
            : Date.parse(`${dateBound.utcDateTime}Z`);
    }

    // A DEFAULT KEEPS THE FORM OF THE BOUND IT IS MEASURED FROM, SO A RELATIVE RANGE STAYS RELATIVE TO EACH RUN
    private static shiftDateBound(dateBound: RecipeFieldConstraintDateBound, days: number): RecipeFieldConstraintDateBound {
        return 'relativeDays' in dateBound
            ? { relativeDays: dateBound.relativeDays + days }
            : { utcDateTime: new Date(Date.parse(`${dateBound.utcDateTime}Z`) + days * MILLISECONDS_PER_DAY).toISOString().slice(0, 19) };
    }

    private static resolveDate(target: IRecipeFieldConstraintTarget, storedConstraint: IStoredRecipeFieldConstraint, now: Date): RecipeFieldConstraintResolution {

        const typedFrom = storedConstraint.min === undefined ? undefined : this.parseDateBound(target, storedConstraint.min) as RecipeFieldConstraintDateBound;
        const typedTo = storedConstraint.max === undefined ? undefined : this.parseDateBound(target, storedConstraint.max) as RecipeFieldConstraintDateBound;
        const span = RECIPE_FIELD_CONSTRAINT_DEFAULT_SPAN_DAYS;

        const comparable = (dateBound: RecipeFieldConstraintDateBound) => this.toComparableMilliseconds(target, dateBound, now);

        // AN EMPTY BOUND IS A YEAR ENDING TODAY, UNLESS THE TYPED ONE IS TODAY OR LATER (OR A YEAR AGO OR EARLIER): THEN IT IS A YEAR FROM IT
        const from = typedFrom
            ?? ( typedTo && comparable(typedTo) <= comparable({ relativeDays: -span })
                ? this.shiftDateBound(typedTo, -span)
                : { relativeDays: -span } );
        const to = typedTo
            ?? ( comparable(from) >= comparable({ relativeDays: 0 })
                ? this.shiftDateBound(from, span)
                : { relativeDays: 0 } );

        if ( comparable(from) > comparable(to) ) {
            return { refusal: `The earliest date ${storedConstraint.min ?? 'default'} is later than the latest date ${storedConstraint.max ?? 'default'}.` };
        }

        return { constraint: { kind: 'date', from: from, to: to } };

    }

    // THE BOUNDS AS THE PANEL AND A NOTIFICATION SAY THEM: "min 5 · max 10", AN ABSENT ONE SAID AS THE DEFAULT
    static describeStoredConstraint(storedConstraint: IStoredRecipeFieldConstraint): string {
        return `min ${storedConstraint.min ?? 'default'} · max ${storedConstraint.max ?? 'default'}`;
    }

}
