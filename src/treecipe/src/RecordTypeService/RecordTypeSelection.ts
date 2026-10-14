import { RecordTypeWrapper } from './RecordTypesWrapper';

export type RecordTypeSelectionIgnoredReason = 'notAWritableRecordType' | 'onlyOneRecordTypePerObject';

export interface IRecordTypeSelectionIgnoredName {
    developerName: string;
    reason: RecordTypeSelectionIgnoredReason;
}

export interface IObjectRecordTypeSelection {
    // UNDEFINED: NOTHING USABLE WAS SELECTED FOR THE OBJECT, SO GENERATION WRITES TODAY'S DEFAULT AND ITS COMMENTED ALTERNATIVES
    selectedRecordTypeApiName?: string;
    ignoredNames: IRecordTypeSelectionIgnoredName[];
}

/*
    Which record types the user chose per object (#193): object api name -> developer names, in the
    order chosen. Generation honours the FIRST usable name of an object; slice B (#194) writes one
    block per name. Names are matched against the object's WRITABLE record types (the ones
    RecipeService.partitionRecordTypesByWritableDeveloperName keeps), so a selected name only ever
    reaches a recipe if it is a record type the metadata holds under a valid api name.
*/
export class RecordTypeSelection {

    private readonly developerNamesByObjectApiName: Map<string, string[]>;

    constructor(developerNamesByObjectApiName?: Iterable<[string, readonly string[]]>) {

        this.developerNamesByObjectApiName = new Map();
        for (const [objectApiName, developerNames] of developerNamesByObjectApiName ?? []) {
            this.developerNamesByObjectApiName.set(objectApiName, [...new Set(developerNames)]);
        }

    }

    /*
        A selection can arrive through a command argument, so its shape is checked rather than
        trusted: a plain object of string arrays. Anything else is ignored -- for that entry, or
        wholly when the value is not an object -- and generation falls back to the defaults.
    */
    static fromUnknown(value: unknown): RecordTypeSelection | undefined {

        if ( typeof value !== 'object' || value === null || Array.isArray(value) ) {
            return undefined;
        }

        const entries: [string, string[]][] = [];
        Object.keys(value).forEach((objectApiName) => {

            const developerNames: unknown = (value as Record<string, unknown>)[objectApiName];
            if ( Array.isArray(developerNames) && developerNames.every(developerName => typeof developerName === 'string') ) {
                entries.push([objectApiName, developerNames as string[]]);
            }

        });

        return new RecordTypeSelection(entries);

    }

    getDeveloperNames(objectApiName: string): readonly string[] | undefined {

        return this.developerNamesByObjectApiName.get(objectApiName);

    }

    static resolveForObject(recordTypeSelection: RecordTypeSelection | undefined,
                            objectApiName: string,
                            writableRecordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>
                        ): IObjectRecordTypeSelection {

        const resolution: IObjectRecordTypeSelection = { ignoredNames: [] };
        const developerNames = recordTypeSelection?.getDeveloperNames(objectApiName) ?? [];

        developerNames.forEach((developerName) => {

            if ( !Object.prototype.hasOwnProperty.call(writableRecordTypeApiToRecordTypeWrapperMap, developerName) ) {
                resolution.ignoredNames.push({ developerName, reason: 'notAWritableRecordType' });
            } else if ( resolution.selectedRecordTypeApiName === undefined ) {
                resolution.selectedRecordTypeApiName = developerName;
            } else {
                resolution.ignoredNames.push({ developerName, reason: 'onlyOneRecordTypePerObject' });
            }

        });

        return resolution;

    }

    /*
        A record type's picklist section for a field, or undefined when the record type does not
        list the field -- which leaves the field unrestricted by it. Own-key only: a field named
        "constructor" must not read Object.prototype's member as its values.
    */
    static getRecordTypePicklistValues(recordTypeWrapper: RecordTypeWrapper, fieldApiName: string): string[] | undefined {

        const picklistSections = recordTypeWrapper?.PicklistFieldSectionsToPicklistDetail;
        if ( !picklistSections || !Object.prototype.hasOwnProperty.call(picklistSections, fieldApiName) ) {
            return undefined;
        }

        const picklistValues: unknown = picklistSections[fieldApiName];
        return Array.isArray(picklistValues) ? picklistValues.filter(picklistValue => typeof picklistValue === 'string') : undefined;

    }

    /*
        A dependent picklist under ONE record type: a controlling value the record type does not
        make available can never be on a record of it, so its choice is dropped; the dependent
        values left under a kept choice are those the record type also makes available, and a
        choice left with none is dropped too. A field the record type does not list (a Checkbox
        controller never is) restricts nothing. Order is kept, so the output does not depend on
        which side was iterated.
    */
    static narrowControllingValueToPicklistOptions(controllingValueToPicklistOptions: Record<string, string[]>,
                                                    recordTypeWrapper: RecordTypeWrapper,
                                                    controllingFieldApiName: string,
                                                    dependentFieldApiName: string
                                                ): Record<string, string[]> {

        const controllingValuesOfRecordType = RecordTypeSelection.getRecordTypePicklistValues(recordTypeWrapper, controllingFieldApiName);
        const dependentValuesOfRecordType = RecordTypeSelection.getRecordTypePicklistValues(recordTypeWrapper, dependentFieldApiName);

        // NULL PROTOTYPED: THE KEYS ARE PICKLIST VALUES (#160)
        const narrowedControllingValueToPicklistOptions: Record<string, string[]> = Object.create(null);
        Object.keys(controllingValueToPicklistOptions).forEach((controllingValue) => {

            if ( controllingValuesOfRecordType && !controllingValuesOfRecordType.includes(controllingValue) ) {
                return;
            }

            const picklistOptions = dependentValuesOfRecordType
                ? controllingValueToPicklistOptions[controllingValue].filter(picklistOption => dependentValuesOfRecordType.includes(picklistOption))
                : [...controllingValueToPicklistOptions[controllingValue]];

            if ( picklistOptions.length > 0 ) {
                narrowedControllingValueToPicklistOptions[controllingValue] = picklistOptions;
            }

        });

        return narrowedControllingValueToPicklistOptions;

    }

}
