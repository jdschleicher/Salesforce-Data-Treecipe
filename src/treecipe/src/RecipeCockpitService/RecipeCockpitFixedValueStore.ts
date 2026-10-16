import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { RecipeCockpitRecipeWriter, RecipeFixedValueKind } from './RecipeCockpitRecipeWriter';

/*
    The fixed-values file (#342): <recipe>.fixedValues.json beside a recipe the Recipe Cockpit wrote a
    pin into. It is what tells a pinned field from one edited by hand, and what Clear puts back: per
    field, the value and, per occurrence of the object, the one line written and the lines it
    replaced. It is a file in the reader's workspace -- committed, merged, edited -- so every field is
    type-checked here, every name is held to SalesforceApiName, every written line must be the line its
    value writes, and a file that cannot be read is NO
    entries rather than a failure. Text in, text out: the cockpit does the reading and writing.
*/

export const RECIPE_COCKPIT_FIXED_VALUE_FILE_VERSION = 1;
export const RECIPE_COCKPIT_FIXED_VALUE_FILE_SUFFIX = '.fixedValues.json';

const MAX_ENTRIES = 2000;
const MAX_OCCURRENCES = 500;
const MAX_TEXT_LENGTH = 100000;

export interface IFixedValueOccurrence {
    occurrenceIndex: number;
    nickname?: string;
    writtenLine: string;
    // ABSENT WHEN THE FILE DOES NOT HOLD A USABLE ONE: Clear THEN RE-DERIVES THE FIELD'S VALUE INSTEAD
    originalText?: string;
}

export interface IFixedValueEntry {
    objectApiName: string;
    fieldApiName: string;
    value: string;
    occurrences: IFixedValueOccurrence[];
}

export interface IFixedValueFileRead {
    entries: IFixedValueEntry[];
    // SET WHEN THE TEXT WAS THERE AND WAS NOT A FIXED-VALUES FILE THIS VERSION WRITES
    isUnreadable: boolean;
}

export class RecipeCockpitFixedValueStore {

    static buildFilePath(recipeFilePath: string): string {
        return `${recipeFilePath.replace(/\.ya?ml$/i, '')}${RECIPE_COCKPIT_FIXED_VALUE_FILE_SUFFIX}`;
    }

    static parse(fileText: string | undefined): IFixedValueFileRead {

        if ( fileText === undefined ) {
            return { entries: [], isUnreadable: false };
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(fileText);
        } catch {
            return { entries: [], isUnreadable: true };
        }

        if ( !this.isPlainRecord(parsed) || parsed.version !== RECIPE_COCKPIT_FIXED_VALUE_FILE_VERSION || !Array.isArray(parsed.fields) ) {
            return { entries: [], isUnreadable: true };
        }

        const entries: IFixedValueEntry[] = [];
        const seenKeys = new Set<string>();

        parsed.fields.slice(0, MAX_ENTRIES).forEach((storedEntry: unknown) => {

            if ( !this.isPlainRecord(storedEntry)
                    || !SalesforceApiName.isApiName(storedEntry.objectApiName) || !SalesforceApiName.isApiName(storedEntry.fieldApiName)
                    || !this.isBoundedText(storedEntry.value) || storedEntry.value === ''
                    || !Array.isArray(storedEntry.occurrences) ) {
                return;
            }

            const entryKey = this.buildEntryKey(storedEntry.objectApiName, storedEntry.fieldApiName);
            const occurrences = this.readOccurrences(storedEntry.occurrences, storedEntry.fieldApiName, storedEntry.value);
            if ( seenKeys.has(entryKey) || occurrences.length === 0 ) {
                return;
            }

            seenKeys.add(entryKey);
            entries.push({ objectApiName: storedEntry.objectApiName, fieldApiName: storedEntry.fieldApiName, value: storedEntry.value, occurrences: occurrences });

        });

        return { entries: entries, isUnreadable: false };

    }

    // SORTED WITH < AND WRITTEN WITH A FIXED KEY ORDER, SO THE SAME PINS WRITE THE SAME BYTES ON EVERY MACHINE
    static serialize(entries: readonly IFixedValueEntry[]): string {

        const byText = (left: string, right: string) => ( left < right ? -1 : left > right ? 1 : 0 );
        const sortedEntries = [...entries].sort((left, right) => byText(left.objectApiName, right.objectApiName) || byText(left.fieldApiName, right.fieldApiName));

        return `${JSON.stringify({
            version: RECIPE_COCKPIT_FIXED_VALUE_FILE_VERSION,
            fields: sortedEntries.map(entry => ({
                objectApiName: entry.objectApiName,
                fieldApiName: entry.fieldApiName,
                value: entry.value,
                occurrences: [...entry.occurrences]
                    .sort((left, right) => left.occurrenceIndex - right.occurrenceIndex)
                    .map(occurrence => ({
                        occurrenceIndex: occurrence.occurrenceIndex,
                        ...( occurrence.nickname !== undefined ? { nickname: occurrence.nickname } : {} ),
                        writtenLine: occurrence.writtenLine,
                        ...( occurrence.originalText !== undefined ? { originalText: occurrence.originalText } : {} )
                    }))
            }))
        }, null, 2)}\n`;

    }

    static findEntry(entries: readonly IFixedValueEntry[], objectApiName: string, fieldApiName: string): IFixedValueEntry | undefined {
        return entries.find(entry => entry.objectApiName === objectApiName && entry.fieldApiName === fieldApiName);
    }

    /*
        A pin over a field the cockpit already pinned keeps the lines from before the FIRST pin: an
        occurrence whose lines were exactly the line the earlier pin wrote takes that pin's original,
        so Clear goes back to what Generate Treecipe wrote rather than to the earlier fixed value.
    */
    static upsertEntry(entries: readonly IFixedValueEntry[], pinnedEntry: IFixedValueEntry): IFixedValueEntry[] {

        const previousEntry = this.findEntry(entries, pinnedEntry.objectApiName, pinnedEntry.fieldApiName);
        const previousOccurrences = previousEntry?.occurrences ?? [];
        const occurrences = pinnedEntry.occurrences.map(occurrence => {
            const { originalText: currentText, ...occurrenceWithoutOriginal } = occurrence;
            // THE SAME OCCURRENCE BY NICKNAME, ELSE BY PLACE; OR A COPY OF A PINNED BLOCK MADE SINCE (Add friend), WHICH HOLDS A PINNED LINE AT ANOTHER DEPTH
            const previousOccurrence = previousOccurrences.find(candidate => ( occurrence.nickname !== undefined
                                                                                ? candidate.nickname === occurrence.nickname
                                                                                : candidate.nickname === undefined && candidate.occurrenceIndex === occurrence.occurrenceIndex )
                                                                            && currentText === candidate.writtenLine)
                ?? previousOccurrences.find(candidate => currentText?.trimStart() === candidate.writtenLine.trimStart());
            if ( !previousOccurrence ) {
                return occurrence;
            }
            const previousOriginal = previousOccurrence.originalText === undefined
                ? undefined
                : RecipeCockpitRecipeWriter.reindentFieldText(previousOccurrence.originalText,
                                                                RecipeCockpitRecipeWriter.countIndent(previousOccurrence.writtenLine),
                                                                RecipeCockpitRecipeWriter.countIndent(occurrence.writtenLine));
            return previousOriginal !== undefined ? { ...occurrenceWithoutOriginal, originalText: previousOriginal } : occurrenceWithoutOriginal;
        });

        return [
            ...entries.filter(entry => entry !== previousEntry),
            { ...pinnedEntry, occurrences: occurrences }
        ];

    }

    static removeEntry(entries: readonly IFixedValueEntry[], objectApiName: string, fieldApiName: string): IFixedValueEntry[] {
        return entries.filter(entry => !( entry.objectApiName === objectApiName && entry.fieldApiName === fieldApiName ));
    }

    // FIELD → VALUE BY OBJECT, WHAT A CARD DRAWS AS PINNED
    static listValuesByObject(entries: readonly IFixedValueEntry[]): Map<string, Map<string, string>> {

        const valuesByObject = new Map<string, Map<string, string>>();
        entries.forEach(entry => {
            const valuesByField = valuesByObject.get(entry.objectApiName) ?? new Map<string, string>();
            valuesByField.set(entry.fieldApiName, entry.value);
            valuesByObject.set(entry.objectApiName, valuesByField);
        });
        return valuesByObject;

    }

    /*
        An occurrence needs a whole-number index, at most one per index, a one-line writtenLine that
        is the field's own line, and a nickname only as text. An originalText is kept only when its
        first line is that field's line and no line of it is broken by a bare CR or by a break only
        PyYAML sees; otherwise the occurrence is kept WITHOUT it, so Clear re-derives the value.
    */
    private static readOccurrences(storedOccurrences: unknown[], fieldApiName: string, value: string): IFixedValueOccurrence[] {

        const fieldLinePattern = new RegExp(`^ *${fieldApiName}:`);
        // THE LINE A PIN OF THIS VALUE WRITES, FOR WHICHEVER KIND COULD WRITE IT: A writtenLine THAT IS NOT ONE WOULD DRAW A PIN THE RECIPE DOES NOT HOLD
        const pinnedLineTexts = new Set((['text', 'number', 'boolean'] as RecipeFixedValueKind[])
            .filter(kind => RecipeCockpitRecipeWriter.checkFixedValue({ value: value, kind: kind }) === undefined)
            .map(kind => `${fieldApiName}: ${RecipeCockpitRecipeWriter.toFixedValueScalar({ value: value, kind: kind })}`));
        const occurrences: IFixedValueOccurrence[] = [];
        const seenIndexes = new Set<number>();

        storedOccurrences.slice(0, MAX_OCCURRENCES).forEach((storedOccurrence: unknown) => {

            if ( !this.isPlainRecord(storedOccurrence)
                    || !Number.isSafeInteger(storedOccurrence.occurrenceIndex) || ( storedOccurrence.occurrenceIndex as number ) < 0
                    || seenIndexes.has(storedOccurrence.occurrenceIndex as number)
                    || ( storedOccurrence.nickname !== undefined && !this.isBoundedText(storedOccurrence.nickname) )
                    || !this.isBoundedText(storedOccurrence.writtenLine)
                    || /[\r\n\u0085\u2028\u2029]/.test(storedOccurrence.writtenLine)
                    || !pinnedLineTexts.has(storedOccurrence.writtenLine.replace(/^ +/, '')) ) {
                return;
            }

            const occurrenceIndex = storedOccurrence.occurrenceIndex as number;
            const originalText = storedOccurrence.originalText;
            const isUsableOriginal = this.isBoundedText(originalText)
                && fieldLinePattern.test(originalText)
                && !/[\u0085\u2028\u2029]|\r(?!\n)/.test(originalText);

            seenIndexes.add(occurrenceIndex);
            occurrences.push({
                occurrenceIndex: occurrenceIndex,
                ...( storedOccurrence.nickname !== undefined ? { nickname: storedOccurrence.nickname as string } : {} ),
                writtenLine: storedOccurrence.writtenLine,
                ...( isUsableOriginal ? { originalText: originalText } : {} )
            });

        });

        return occurrences;

    }

    private static buildEntryKey(objectApiName: string, fieldApiName: string): string {
        return `${objectApiName}\n${fieldApiName}`;
    }

    private static isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
        return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
    }

    private static isBoundedText(candidate: unknown): candidate is string {
        return typeof candidate === 'string' && candidate.length <= MAX_TEXT_LENGTH;
    }

}
