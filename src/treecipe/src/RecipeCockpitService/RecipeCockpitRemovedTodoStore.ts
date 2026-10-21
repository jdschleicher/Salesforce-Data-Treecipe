import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { RecipeCockpitRecipeWriter, IRemovedTodoComment } from './RecipeCockpitRecipeWriter';

/*
    The removed-TODOs file (#391): <recipe>.removedTodos.json beside a recipe the Recipe Cockpit
    removed a TODO comment from. Per removed TODO, the occurrence and field it sat in and what
    RecipeCockpitRecipeWriter.restoreTodoComment needs to put it back exactly. It is a file in the
    reader's workspace -- committed, merged, edited -- so every entry is type-checked here, every name
    is held to SalesforceApiName, every line must be one the writer could have recorded, and a file
    that cannot be read is NO entries rather than a failure. Text in, text out: the cockpit does the
    reading and writing.
*/

export const RECIPE_COCKPIT_REMOVED_TODO_FILE_VERSION = 1;
export const RECIPE_COCKPIT_REMOVED_TODO_FILE_SUFFIX = '.removedTodos.json';

const MAX_ENTRIES = 5000;
const MAX_TEXT_LENGTH = 100000;
const MAX_TODO_LINES = 500;
const LINE_BREAK_PATTERN = /[\r\n\u0085\u2028\u2029]/;

export interface IRemovedTodoFileRead {
    entries: IRemovedTodoComment[];
    // SET WHEN THE TEXT WAS THERE AND WAS NOT A REMOVED-TODOS FILE THIS VERSION WRITES
    isUnreadable: boolean;
}

export class RecipeCockpitRemovedTodoStore {

    static buildFilePath(recipeFilePath: string): string {
        return `${recipeFilePath.replace(/\.ya?ml$/i, '')}${RECIPE_COCKPIT_REMOVED_TODO_FILE_SUFFIX}`;
    }

    static parse(fileText: string | undefined): IRemovedTodoFileRead {

        if ( fileText === undefined ) {
            return { entries: [], isUnreadable: false };
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(fileText);
        } catch {
            return { entries: [], isUnreadable: true };
        }

        if ( !this.isPlainRecord(parsed) || parsed.version !== RECIPE_COCKPIT_REMOVED_TODO_FILE_VERSION || !Array.isArray(parsed.todos) ) {
            return { entries: [], isUnreadable: true };
        }

        const entries: IRemovedTodoComment[] = [];
        const seenKeys = new Set<string>();

        parsed.todos.slice(0, MAX_ENTRIES).forEach((storedEntry: unknown) => {

            const entry = this.readEntry(storedEntry);
            const entryKey = entry ? this.buildEntryKey(entry) : undefined;
            if ( !entry || seenKeys.has(entryKey) ) {
                return;
            }

            seenKeys.add(entryKey);
            entries.push(entry);

        });

        return { entries: entries, isUnreadable: false };

    }

    // SORTED WITH < AND WRITTEN WITH A FIXED KEY ORDER, SO THE SAME REMOVALS WRITE THE SAME BYTES ON EVERY MACHINE
    static serialize(entries: readonly IRemovedTodoComment[]): string {

        const byText = (left: string, right: string) => ( left < right ? -1 : left > right ? 1 : 0 );
        const sortedEntries = [...entries].sort((left, right) => (
            byText(left.objectApiName, right.objectApiName)
            || byText(left.objectNickname ?? '', right.objectNickname ?? '')
            || byText(left.fieldApiName ?? '', right.fieldApiName ?? '')
            || left.lineNumber - right.lineNumber
            || byText(left.originalLine, right.originalLine)
        ));

        return `${JSON.stringify({
            version: RECIPE_COCKPIT_REMOVED_TODO_FILE_VERSION,
            todos: sortedEntries.map(entry => this.toStoredEntry(entry))
        }, null, 2)}\n`;

    }

    static addEntry(entries: readonly IRemovedTodoComment[], removed: IRemovedTodoComment): IRemovedTodoComment[] {
        const removedKey = this.buildEntryKey(removed);
        return [...entries.filter(entry => this.buildEntryKey(entry) !== removedKey), removed];
    }

    static removeEntry(entries: readonly IRemovedTodoComment[], removed: IRemovedTodoComment): IRemovedTodoComment[] {
        const removedKey = this.buildEntryKey(removed);
        return entries.filter(entry => this.buildEntryKey(entry) !== removedKey);
    }

    static isSameEntry(left: IRemovedTodoComment, right: IRemovedTodoComment): boolean {
        return this.buildEntryKey(left) === this.buildEntryKey(right);
    }

    private static readEntry(storedEntry: unknown): IRemovedTodoComment | undefined {

        if ( !this.isPlainRecord(storedEntry)
                || !SalesforceApiName.isApiName(storedEntry.objectApiName)
                || ( storedEntry.objectNickname !== undefined && !this.isOneLineText(storedEntry.objectNickname) )
                || ( storedEntry.fieldApiName !== undefined && !SalesforceApiName.isApiName(storedEntry.fieldApiName) )
                || !Number.isSafeInteger(storedEntry.lineNumber) || ( storedEntry.lineNumber as number ) < 1
                || !this.isOneLineText(storedEntry.todoText) || !this.isOneLineText(storedEntry.originalLine)
                || ( storedEntry.kind !== 'line' && storedEntry.kind !== 'trailing' ) ) {
            return undefined;
        }

        const entry: IRemovedTodoComment = {
            objectApiName: storedEntry.objectApiName as string,
            ...( storedEntry.objectNickname !== undefined ? { objectNickname: storedEntry.objectNickname as string } : {} ),
            ...( storedEntry.fieldApiName !== undefined ? { fieldApiName: storedEntry.fieldApiName as string } : {} ),
            lineNumber: storedEntry.lineNumber as number,
            todoText: storedEntry.todoText as string,
            originalLine: storedEntry.originalLine as string,
            kind: storedEntry.kind,
            ...( storedEntry.kind === 'line' ? {
                lineEnding: storedEntry.lineEnding as string,
                previousLine: storedEntry.previousLine as string,
                ...( storedEntry.previousTodoLines !== undefined ? { previousTodoLines: this.readTodoLines(storedEntry.previousTodoLines) } : {} ),
                ...( storedEntry.nextTodoLines !== undefined ? { nextTodoLines: this.readTodoLines(storedEntry.nextTodoLines) } : {} )
            } : { cutLine: storedEntry.cutLine as string } )
        };

        // THE WRITER'S OWN CHECK: A LINE IT COULD NOT HAVE RECORDED IS NOT ONE IT IS ASKED TO PUT BACK
        return RecipeCockpitRecipeWriter.isUsableRemovedTodo(entry) ? entry : undefined;

    }

    // A LIST THAT IS NOT ONE IS HANDED ON AS IT IS, SO isUsableRemovedTodo REFUSES THE WHOLE ENTRY RATHER THAN A SHORTER LIST LOOKING WHOLE
    private static readTodoLines(storedLines: unknown): string[] {
        return Array.isArray(storedLines) && storedLines.length <= MAX_TODO_LINES && storedLines.every(storedLine => this.isOneLineText(storedLine))
            ? storedLines.slice()
            : storedLines as string[];
    }

    private static toStoredEntry(entry: IRemovedTodoComment): Record<string, unknown> {
        return {
            objectApiName: entry.objectApiName,
            ...( entry.objectNickname !== undefined ? { objectNickname: entry.objectNickname } : {} ),
            ...( entry.fieldApiName !== undefined ? { fieldApiName: entry.fieldApiName } : {} ),
            lineNumber: entry.lineNumber,
            todoText: entry.todoText,
            originalLine: entry.originalLine,
            kind: entry.kind,
            ...( entry.kind === 'line' ? {
                lineEnding: entry.lineEnding,
                previousLine: entry.previousLine,
                ...( entry.previousTodoLines !== undefined ? { previousTodoLines: entry.previousTodoLines } : {} ),
                ...( entry.nextTodoLines !== undefined ? { nextTodoLines: entry.nextTodoLines } : {} )
            } : { cutLine: entry.cutLine } )
        };
    }

    private static buildEntryKey(entry: IRemovedTodoComment): string {
        return JSON.stringify(this.toStoredEntry(entry));
    }

    private static isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
        return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
    }

    private static isOneLineText(candidate: unknown): candidate is string {
        return typeof candidate === 'string' && candidate !== '' && candidate.length <= MAX_TEXT_LENGTH && !LINE_BREAK_PATTERN.test(candidate);
    }

}
