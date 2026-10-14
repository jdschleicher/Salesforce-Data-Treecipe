import { IObjectRecordTypeSelection, RecordTypeSelection } from '../RecordTypeService/RecordTypeSelection';
import { RecordTypeWrapper } from '../RecordTypeService/RecordTypesWrapper';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { RecipeYamlScalar } from '../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';

export const RECORD_TYPE_SELECTIONS_CONFIG_KEY = 'recordTypeSelections';
export const RECORD_TYPES_WHEN_SELECTION_SAVED_CONFIG_KEY = 'recordTypesWhenSelectionSaved';

export const CHANGE_RECORD_TYPES_ACTION_LABEL = 'Change record types';

export const SAVED_RECORD_TYPE_SELECTION_MAXIMUM_NAMED_ENTRIES = 10;

export interface IDroppedSavedRecordTypeEntry {
    objectApiName: string;
    missingDeveloperNames: string[];
}

export interface INewRecordTypesOfSavedObject {
    objectApiName: string;
    developerNames: string[];
}

// WHAT ONE WALK FOUND OUT ABOUT A SAVED SELECTION: EVERY LIST EMPTY MEANS IT STILL MATCHES THE METADATA
export interface ISavedRecordTypeSelectionReport {
    droppedEntries: IDroppedSavedRecordTypeEntry[];
    missingObjectApiNames: string[];
    newRecordTypes: INewRecordTypesOfSavedObject[];
}

export interface ISavedRecordTypeSelectionParseResult {
    // UNDEFINED WHEN NOTHING USABLE IS SAVED, WHICH GENERATES EXACTLY AS WITH NO SAVED SELECTION
    savedSelection?: SavedRecordTypeSelection;
    // EACH ALREADY ESCAPED FOR A NOTIFICATION
    invalidEntryDescriptions: string[];
}

/*
    A record type selection saved in treecipe.config.json (#196): recordTypeSelections (object api
    name -> developer names, in the order chosen) and recordTypesWhenSelectionSaved (object api name
    -> every record type the object had then, which is how a record type added since is noticed).

    Unlike a selection handed to the command, a saved one can go STALE: an entry naming a record
    type or object the metadata no longer has is dropped WHOLE for that object, which then generates
    its default -- a partial entry would write a choice the user never made. Nothing is written to
    the recipe about it; the command warns instead, from the report the walk leaves behind.
*/
export class SavedRecordTypeSelection extends RecordTypeSelection {

    private readonly knownDeveloperNamesByObjectApiName: Map<string, string[]>;
    private readonly savedObjectApiNames: string[];
    private readonly resolvedObjectApiNames = new Set<string>();
    private readonly droppedEntriesByObjectApiName = new Map<string, IDroppedSavedRecordTypeEntry>();
    private readonly newRecordTypesByObjectApiName = new Map<string, INewRecordTypesOfSavedObject>();

    constructor(developerNamesByObjectApiName: Iterable<[string, readonly string[]]>,
                knownDeveloperNamesByObjectApiName?: Iterable<[string, readonly string[]]>) {

        const savedEntries = [...developerNamesByObjectApiName];
        super(savedEntries);

        this.savedObjectApiNames = savedEntries.map(([objectApiName]) => objectApiName);
        this.knownDeveloperNamesByObjectApiName = new Map();
        for (const [objectApiName, developerNames] of knownDeveloperNamesByObjectApiName ?? []) {
            this.knownDeveloperNamesByObjectApiName.set(objectApiName, [...developerNames]);
        }

    }

    /*
        treecipe.config.json is hand-edited, so each entry is checked rather than trusted: an object
        key and every developer name must be an api name (generation refuses any other), and an
        object's list must be a non-empty list of strings. An entry that is not is IGNORED and
        named, never thrown, so the rest of the selection still applies.
    */
    static fromConfigurationValues(savedSelections: unknown, savedKnownRecordTypes: unknown): ISavedRecordTypeSelectionParseResult {

        const invalidEntryDescriptions: string[] = [];

        if ( savedSelections === undefined ) {
            return { invalidEntryDescriptions };
        }

        if ( !this.isPlainObject(savedSelections) ) {
            invalidEntryDescriptions.push(`"${RECORD_TYPE_SELECTIONS_CONFIG_KEY}" is not an object of object api names to lists of record type developer names`);
            return { invalidEntryDescriptions };
        }

        const selectionEntries = this.readNameListEntries(savedSelections, false, RECORD_TYPE_SELECTIONS_CONFIG_KEY, invalidEntryDescriptions);
        const selectedObjectApiNames = new Set(selectionEntries.map(([objectApiName]) => objectApiName));

        let knownEntries: [string, string[]][] = [];
        if ( this.isPlainObject(savedKnownRecordTypes) ) {
            knownEntries = this.readNameListEntries(savedKnownRecordTypes, true, RECORD_TYPES_WHEN_SELECTION_SAVED_CONFIG_KEY, invalidEntryDescriptions)
                .filter(([objectApiName]) => selectedObjectApiNames.has(objectApiName));
        } else if ( savedKnownRecordTypes !== undefined ) {
            invalidEntryDescriptions.push(`"${RECORD_TYPES_WHEN_SELECTION_SAVED_CONFIG_KEY}" is not an object of object api names to lists of record type developer names`);
        }

        return {
            ...( selectionEntries.length > 0 ? { savedSelection: new SavedRecordTypeSelection(selectionEntries, knownEntries) } : {} ),
            invalidEntryDescriptions
        };

    }

    private static readNameListEntries(savedValue: Record<string, unknown>,
                                        isEmptyListAllowed: boolean,
                                        configKey: string,
                                        invalidEntryDescriptions: string[]): [string, string[]][] {

        const entries: [string, string[]][] = [];

        Object.keys(savedValue).forEach((objectApiName) => {

            const developerNames: unknown = savedValue[objectApiName];
            const isUsableEntry = SalesforceApiName.isApiName(objectApiName)
                                    && Array.isArray(developerNames)
                                    && ( isEmptyListAllowed || developerNames.length > 0 )
                                    && developerNames.every(developerName => SalesforceApiName.isApiName(developerName));

            if ( isUsableEntry ) {
                entries.push([objectApiName, [...new Set(developerNames as string[])]]);
            } else {
                invalidEntryDescriptions.push(`"${configKey}" entry "${RecipeYamlScalar.escapeForNotification(objectApiName)}"`);
            }

        });

        return entries;

    }

    private static isPlainObject(value: unknown): value is Record<string, unknown> {

        return typeof value === 'object' && value !== null && !Array.isArray(value);

    }

    static buildInvalidEntriesWarning(invalidEntryDescriptions: string[]): string | undefined {

        if ( invalidEntryDescriptions.length === 0 ) {
            return undefined;
        }

        return `treecipe.config.json has record type selections that are not usable, so they were ignored: ${this.joinWithLimit(invalidEntryDescriptions)}. Each entry must map an object api name to a list of record type developer names.`;

    }

    resolve(objectApiName: string, writableRecordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>): IObjectRecordTypeSelection {

        const savedDeveloperNames = this.getDeveloperNames(objectApiName);
        if ( !savedDeveloperNames ) {
            return super.resolve(objectApiName, writableRecordTypeApiToRecordTypeWrapperMap);
        }

        this.resolvedObjectApiNames.add(objectApiName);

        const writableDeveloperNames = Object.keys(writableRecordTypeApiToRecordTypeWrapperMap);
        const knownDeveloperNames = this.knownDeveloperNamesByObjectApiName.get(objectApiName);
        const addedDeveloperNames = knownDeveloperNames
            ? writableDeveloperNames.filter(developerName => !knownDeveloperNames.includes(developerName))
            : [];
        if ( addedDeveloperNames.length > 0 ) {
            this.newRecordTypesByObjectApiName.set(objectApiName, { objectApiName, developerNames: addedDeveloperNames });
        }

        const missingDeveloperNames = savedDeveloperNames.filter(developerName => !Object.prototype.hasOwnProperty.call(writableRecordTypeApiToRecordTypeWrapperMap, developerName));
        if ( missingDeveloperNames.length > 0 ) {
            this.droppedEntriesByObjectApiName.set(objectApiName, { objectApiName, missingDeveloperNames });
            return { selectedRecordTypeApiNames: [], ignoredDeveloperNames: [] };
        }

        return super.resolve(objectApiName, writableRecordTypeApiToRecordTypeWrapperMap);

    }

    // READ ONCE THE WALK HAS ENDED: AN OBJECT IT NEVER RESOLVED IS ONE THE METADATA NO LONGER HAS
    buildReport(): ISavedRecordTypeSelectionReport {

        return {
            droppedEntries: [...this.droppedEntriesByObjectApiName.values()],
            missingObjectApiNames: this.savedObjectApiNames.filter(objectApiName => !this.resolvedObjectApiNames.has(objectApiName)),
            newRecordTypes: [...this.newRecordTypesByObjectApiName.values()]
        };

    }

    static isReportEmpty(report: ISavedRecordTypeSelectionReport): boolean {

        return report.droppedEntries.length === 0 && report.missingObjectApiNames.length === 0 && report.newRecordTypes.length === 0;

    }

    /*
        One warning for everything a walk found, every name from the metadata or the hand-edited
        config escaped, since a notification renders [label](command:...) as a link that runs it.
    */
    static buildReportWarning(report: ISavedRecordTypeSelectionReport): string | undefined {

        if ( this.isReportEmpty(report) ) {
            return undefined;
        }

        const quote = (name: string) => `"${RecipeYamlScalar.escapeForNotification(name)}"`;
        const sentences = ['The record types saved in treecipe.config.json no longer match the metadata.'];

        if ( report.droppedEntries.length > 0 ) {
            const droppedDescriptions = report.droppedEntries.map(droppedEntry =>
                `${quote(droppedEntry.objectApiName)} (no ${droppedEntry.missingDeveloperNames.map(quote).join(', ')})`);
            sentences.push(`These objects name a record type they no longer have, so their saved choice was dropped and each was generated with its default record type: ${this.joinWithLimit(droppedDescriptions)}.`);
        }

        if ( report.missingObjectApiNames.length > 0 ) {
            sentences.push(`These saved objects are no longer in the metadata, so their saved choice was dropped: ${this.joinWithLimit(report.missingObjectApiNames.map(quote))}.`);
        }

        if ( report.newRecordTypes.length > 0 ) {
            const newDescriptions = report.newRecordTypes.map(newRecordTypes =>
                `${quote(newRecordTypes.objectApiName)} (${newRecordTypes.developerNames.map(quote).join(', ')})`);
            sentences.push(`These objects have record types added since the selection was saved, which were not generated: ${this.joinWithLimit(newDescriptions)}. Choose them in the Recipe Cockpit's Record types tab, and tick "Remember this selection".`);
        }

        return sentences.join(' ');

    }

    // THE OBJECT "Change record types" OPENS THE TAB ON: ONE WITH A NEW RECORD TYPE FIRST, SINCE THAT IS A CHOICE STILL TO MAKE
    static findObjectToReview(report: ISavedRecordTypeSelectionReport): string | undefined {

        return report.newRecordTypes[0]?.objectApiName ?? report.droppedEntries[0]?.objectApiName;

    }

    private static joinWithLimit(descriptions: string[]): string {

        const namedDescriptions = descriptions.slice(0, SAVED_RECORD_TYPE_SELECTION_MAXIMUM_NAMED_ENTRIES);
        const unnamedCount = descriptions.length - namedDescriptions.length;
        return namedDescriptions.join(', ') + ( unnamedCount > 0 ? ` and ${unnamedCount} more` : '' );

    }

}
