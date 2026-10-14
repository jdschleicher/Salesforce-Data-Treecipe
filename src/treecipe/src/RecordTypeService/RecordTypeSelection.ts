import { RecordTypeWrapper } from './RecordTypesWrapper';

export interface IObjectRecordTypeSelection {
    // EMPTY: NOTHING USABLE WAS SELECTED FOR THE OBJECT, SO GENERATION WRITES TODAY'S DEFAULT AND ITS COMMENTED ALTERNATIVES
    selectedRecordTypeApiNames: string[];
    // SELECTED NAMES THE OBJECT DOES NOT HOLD AS A WRITABLE RECORD TYPE
    ignoredDeveloperNames: string[];
}

/*
    One "- object:" block of an object's recipe. recordTypeApiName undefined is the default block,
    written exactly as before any selection existed.
*/
export interface IRecordTypeBlock {
    recordTypeApiName?: string;
    nickname: string;
    ignoredDeveloperNames: string[];
}

/*
    Which record types the user chose per object (#193): object api name -> developer names, in the
    order chosen. Each usable name is one block of the object's recipe (#194). Names are matched
    against the object's WRITABLE record types (the ones
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

        const resolution: IObjectRecordTypeSelection = { selectedRecordTypeApiNames: [], ignoredDeveloperNames: [] };
        const developerNames = recordTypeSelection?.getDeveloperNames(objectApiName) ?? [];

        developerNames.forEach((developerName) => {

            if ( Object.prototype.hasOwnProperty.call(writableRecordTypeApiToRecordTypeWrapperMap, developerName) ) {
                resolution.selectedRecordTypeApiNames.push(developerName);
            } else {
                resolution.ignoredDeveloperNames.push(developerName);
            }

        });

        return resolution;

    }

    static buildDefaultNickname(objectApiName: string): string {

        return `${objectApiName}_NickName`;

    }

    /*
        The blocks an object's recipe is written as. With none or one record type selected there is
        one block under the object's usual nickname, so the recipe is what it was before #194. With
        several, each block is nicknamed after its record type so the blocks -- and a child's lookup
        to one of them -- are told apart. A nickname a reserved name already holds (the self-lookup
        child iteration's, <Object>_child_NickName, for a record type named "child") takes a
        _RecordType suffix instead. The ignored names are written once, in the first block.
    */
    static buildRecordTypeBlocks(objectApiName: string,
                                    objectRecordTypeSelection: IObjectRecordTypeSelection,
                                    reservedNicknames: string[] = []
                                ): IRecordTypeBlock[] {

        const { selectedRecordTypeApiNames, ignoredDeveloperNames } = objectRecordTypeSelection;

        if ( selectedRecordTypeApiNames.length <= 1 ) {
            return [{
                ...( selectedRecordTypeApiNames.length === 1 ? { recordTypeApiName: selectedRecordTypeApiNames[0] } : {} ),
                nickname: RecordTypeSelection.buildDefaultNickname(objectApiName),
                ignoredDeveloperNames: [...ignoredDeveloperNames]
            }];
        }

        // A SUFFIXED NICKNAME MUST NOT BE ANOTHER BLOCK'S EITHER: "child" AND "child_RecordType" ARE BOTH DEVELOPER NAMES
        const takenNicknames = new Set([...reservedNicknames, ...selectedRecordTypeApiNames.map(recordTypeApiName => `${objectApiName}_${recordTypeApiName}_NickName`)]);

        return selectedRecordTypeApiNames.map((recordTypeApiName, blockIndex) => {

            let nickname = `${objectApiName}_${recordTypeApiName}_NickName`;
            let suffix = '';
            while ( reservedNicknames.includes(nickname) || ( suffix !== '' && takenNicknames.has(nickname) ) ) {
                suffix += '_RecordType';
                nickname = `${objectApiName}_${recordTypeApiName}${suffix}_NickName`;
            }
            takenNicknames.add(nickname);

            return {
                recordTypeApiName: recordTypeApiName,
                nickname: nickname,
                ignoredDeveloperNames: blockIndex === 0 ? [...ignoredDeveloperNames] : []
            };

        });

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
