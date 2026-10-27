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
const MAX_ORG_NAME_LENGTH = 255;

const SALESFORCE_RECORD_ID_PATTERN = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

export interface IFixedValueOccurrence {
    occurrenceIndex: number;
    nickname?: string;
    writtenLine: string;
    // ABSENT WHEN THE FILE DOES NOT HOLD A USABLE ONE: Clear THEN RE-DERIVES THE FIELD'S VALUE INSTEAD
    originalText?: string;
}

/*
    Where a lookup's pinned Id came from (#421): the org it was chosen in, and the parent object it
    is a record of. Present only on an entry written by "Use existing <Parent> from org…", whose
    value is a Salesforce Id; it is what lets a lookup -- otherwise never pinned -- hold a value.
*/
export interface IFixedValueOrgRecord {
    orgUsername: string;
    orgAlias?: string;
    parentObjectApiName: string;
}

/*
    scopeNickname is set on a pin of ONE occurrence of an object written more than once (#467): the
    nickname of the occurrence it was written into, which is its only recorded occurrence. Without it
    the entry is a pin of every occurrence its occurrences list, as every entry before #467 was.
*/
export interface IFixedValueEntry {
    objectApiName: string;
    scopeNickname?: string;
    fieldApiName: string;
    value: string;
    orgRecord?: IFixedValueOrgRecord;
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

            // A SCOPED PIN NAMES ONE OCCURRENCE BY AN API-NAME NICKNAME AND RECORDS THAT ONE ONLY; ANYTHING ELSE IS NOT A PIN THIS FILE WROTE
            if ( storedEntry.scopeNickname !== undefined && !SalesforceApiName.isApiName(storedEntry.scopeNickname) ) {
                return;
            }
            const scopeNickname = storedEntry.scopeNickname as string | undefined;

            const entryKey = this.buildEntryKey(storedEntry.objectApiName, storedEntry.fieldApiName, scopeNickname);
            const occurrences = this.readOccurrences(storedEntry.occurrences, storedEntry.fieldApiName, storedEntry.value);
            if ( seenKeys.has(entryKey) || occurrences.length === 0
                    || ( scopeNickname !== undefined && ( occurrences.length !== 1 || occurrences[0].nickname !== scopeNickname ) ) ) {
                return;
            }

            seenKeys.add(entryKey);
            const orgRecord = this.readOrgRecord(storedEntry.orgRecord, storedEntry.value);
            entries.push({
                objectApiName: storedEntry.objectApiName,
                ...( scopeNickname !== undefined ? { scopeNickname: scopeNickname } : {} ),
                fieldApiName: storedEntry.fieldApiName,
                value: storedEntry.value,
                ...( orgRecord ? { orgRecord: orgRecord } : {} ),
                occurrences: occurrences
            });

        });

        return { entries: entries, isUnreadable: false };

    }

    // SORTED WITH < AND WRITTEN WITH A FIXED KEY ORDER, SO THE SAME PINS WRITE THE SAME BYTES ON EVERY MACHINE
    static serialize(entries: readonly IFixedValueEntry[]): string {

        const byText = (left: string, right: string) => ( left < right ? -1 : left > right ? 1 : 0 );
        const sortedEntries = [...entries].sort((left, right) => byText(left.objectApiName, right.objectApiName)
                                                                    || byText(left.fieldApiName, right.fieldApiName)
                                                                    || byText(left.scopeNickname ?? '', right.scopeNickname ?? ''));

        return `${JSON.stringify({
            version: RECIPE_COCKPIT_FIXED_VALUE_FILE_VERSION,
            fields: sortedEntries.map(entry => ({
                objectApiName: entry.objectApiName,
                ...( entry.scopeNickname !== undefined ? { scopeNickname: entry.scopeNickname } : {} ),
                fieldApiName: entry.fieldApiName,
                value: entry.value,
                ...( entry.orgRecord ? {
                    orgRecord: {
                        orgUsername: entry.orgRecord.orgUsername,
                        ...( entry.orgRecord.orgAlias !== undefined ? { orgAlias: entry.orgRecord.orgAlias } : {} ),
                        parentObjectApiName: entry.orgRecord.parentObjectApiName
                    }
                } : {} ),
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

    // THE ENTRY OF ONE SCOPE: A PIN OF THE OCCURRENCE NAMED, OR -- WITH NO NICKNAME -- A PIN OF EVERY OCCURRENCE IT RECORDS
    static findEntry(entries: readonly IFixedValueEntry[], objectApiName: string, fieldApiName: string, scopeNickname?: string): IFixedValueEntry | undefined {
        return entries.find(entry => entry.objectApiName === objectApiName && entry.fieldApiName === fieldApiName && entry.scopeNickname === scopeNickname);
    }

    /*
        The entry whose pin one occurrence's field holds now (#467): its own scoped pin, else a pin of
        every occurrence that recorded it by that nickname. An occurrence of an object written once
        has no nickname to scope by and is held by its object's one entry.
    */
    static findHoldingEntry(entries: readonly IFixedValueEntry[], objectApiName: string, fieldApiName: string, occurrenceNickname?: string): IFixedValueEntry | undefined {
        // AN OBJECT NOW WRITTEN ONCE (ITS ITERATIONS REMOVED BY HAND) IS STILL HELD BY A PIN OF ONE OF ITS OCCURRENCES
        if ( occurrenceNickname === undefined ) {
            return this.findEntry(entries, objectApiName, fieldApiName)
                ?? entries.find(entry => entry.objectApiName === objectApiName && entry.fieldApiName === fieldApiName);
        }
        return this.findEntry(entries, objectApiName, fieldApiName, occurrenceNickname)
            ?? entries.find(entry => entry.objectApiName === objectApiName && entry.fieldApiName === fieldApiName && entry.scopeNickname === undefined
                                        && entry.occurrences.some(occurrence => occurrence.nickname === occurrenceNickname));
    }

    /*
        A pin over a field the cockpit already pinned keeps the lines from before the FIRST pin: an
        occurrence whose lines were exactly the line the earlier pin wrote takes that pin's original,
        so Clear goes back to what Generate Treecipe wrote rather than to the earlier fixed value.
    */
    /*
        A pin of ONE occurrence over a field a pin of every occurrence holds there takes that
        occurrence out of the wider pin -- its original with it -- so each line is held by one entry,
        and Clear of either puts back only what it holds; a wider pin left holding nothing is dropped.
    */
    static upsertEntry(entries: readonly IFixedValueEntry[], pinnedEntry: IFixedValueEntry): IFixedValueEntry[] {

        const previousEntry = this.findEntry(entries, pinnedEntry.objectApiName, pinnedEntry.fieldApiName, pinnedEntry.scopeNickname);
        const widerEntry = pinnedEntry.scopeNickname === undefined ? undefined : this.findEntry(entries, pinnedEntry.objectApiName, pinnedEntry.fieldApiName);
        const carvedOccurrences = ( widerEntry?.occurrences ?? [] ).filter(occurrence => occurrence.nickname === pinnedEntry.scopeNickname);
        // A PIN OF EVERY OCCURRENCE TAKES IN THE PINS OF ONE OCCURRENCE OF THE SAME FIELD, ORIGINALS AND ALL, SO ONE ENTRY HOLDS EACH LINE
        const absorbedEntries = pinnedEntry.scopeNickname !== undefined ? [] : entries.filter(entry => entry.objectApiName === pinnedEntry.objectApiName
                                                                                                    && entry.fieldApiName === pinnedEntry.fieldApiName
                                                                                                    && entry.scopeNickname !== undefined);
        const previousOccurrences = [...( previousEntry?.occurrences ?? [] ), ...carvedOccurrences, ...absorbedEntries.flatMap(entry => entry.occurrences)];
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

        const narrowedWiderEntry = widerEntry && carvedOccurrences.length > 0
            ? { ...widerEntry, occurrences: widerEntry.occurrences.filter(occurrence => !carvedOccurrences.includes(occurrence)) }
            : widerEntry;

        return [
            ...entries.filter(entry => entry !== previousEntry && entry !== widerEntry && !absorbedEntries.includes(entry)),
            ...( narrowedWiderEntry && narrowedWiderEntry.occurrences.length > 0 ? [narrowedWiderEntry] : [] ),
            { ...pinnedEntry, occurrences: occurrences }
        ];

    }

    static removeEntry(entries: readonly IFixedValueEntry[], objectApiName: string, fieldApiName: string, scopeNickname?: string): IFixedValueEntry[] {
        return entries.filter(entry => !( entry.objectApiName === objectApiName && entry.fieldApiName === fieldApiName && entry.scopeNickname === scopeNickname ));
    }

    /*
        FIELD → VALUE BY OBJECT, WHAT A CARD DRAWS AS PINNED. Every pin is listed under its object AND
        under the occurrence key (RecipeCockpitRecipeWriter.buildOccurrenceKey) of each occurrence it
        holds by nickname (#467): a card reads an object written once by the object, and each
        occurrence of an object written more than once by its own key, so a pin of one occurrence
        is drawn on that row alone.
    */
    static listValuesByObject(entries: readonly IFixedValueEntry[]): Map<string, Map<string, string>> {

        const valuesByObject = new Map<string, Map<string, string>>();
        const setValue = (objectKey: string, entry: IFixedValueEntry) => {
            const valuesByField = valuesByObject.get(objectKey) ?? new Map<string, string>();
            valuesByField.set(entry.fieldApiName, entry.value);
            valuesByObject.set(objectKey, valuesByField);
        };
        // EVERY WIDER PIN FIRST, SO A SCOPED ONE OF THE SAME OCCURRENCE IS WHAT ITS KEY SAYS
        [...entries].sort((left, right) => Number(left.scopeNickname !== undefined) - Number(right.scopeNickname !== undefined)).forEach(entry => {
            // A PIN OF ONE OCCURRENCE IS UNDER ITS OBJECT TOO, SO AN OBJECT WRITTEN ONCE SINCE STILL DRAWS IT; A CARD WITH iterations READS OCCURRENCE KEYS ONLY
            setValue(entry.objectApiName, entry);
            new Set(entry.occurrences.flatMap(occurrence => ( occurrence.nickname !== undefined ? [occurrence.nickname] : [] )))
                .forEach(nickname => setValue(RecipeCockpitRecipeWriter.buildOccurrenceKey(entry.objectApiName, nickname), entry));
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
        const pinnedLineTexts = new Set((['text', 'number', 'boolean', 'expression'] as RecipeFixedValueKind[])
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

    static isSalesforceRecordId(candidate: unknown): candidate is string {
        return typeof candidate === 'string' && SALESFORCE_RECORD_ID_PATTERN.test(candidate);
    }

    /*
        An entry's org record is kept only beside a value that is a Salesforce Id, with a parent that
        is an api name and an org named on one line; anything else is dropped, and the entry then
        reads as a plain fixed value -- which a lookup never takes, so it is not drawn as pinned.
    */
    private static readOrgRecord(storedOrgRecord: unknown, value: string): IFixedValueOrgRecord | undefined {

        if ( storedOrgRecord === undefined || !this.isPlainRecord(storedOrgRecord) || !this.isSalesforceRecordId(value)
                || !this.isOrgName(storedOrgRecord.orgUsername)
                || ( storedOrgRecord.orgAlias !== undefined && !this.isOrgName(storedOrgRecord.orgAlias) )
                || !SalesforceApiName.isApiName(storedOrgRecord.parentObjectApiName) ) {
            return undefined;
        }

        return {
            orgUsername: storedOrgRecord.orgUsername,
            ...( storedOrgRecord.orgAlias !== undefined ? { orgAlias: storedOrgRecord.orgAlias as string } : {} ),
            parentObjectApiName: storedOrgRecord.parentObjectApiName
        };

    }

    private static isOrgName(candidate: unknown): candidate is string {
        return typeof candidate === 'string' && candidate !== '' && candidate.length <= MAX_ORG_NAME_LENGTH && !/[\p{Cc}\u0085\u2028\u2029]/u.test(candidate);
    }

    private static buildEntryKey(objectApiName: string, fieldApiName: string, scopeNickname?: string): string {
        return `${objectApiName}\n${fieldApiName}\n${scopeNickname ?? ''}`;
    }

    private static isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
        return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
    }

    private static isBoundedText(candidate: unknown): candidate is string {
        return typeof candidate === 'string' && candidate.length <= MAX_TEXT_LENGTH;
    }

}
