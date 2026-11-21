import { RecordTypeWrapper } from '../ObjectInfoWrapper/RecordTypesWrapper';

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

// ONE RECORD TYPE OF ONE OBJECT IN A SET (#624)
export interface IRecordTypeCombinationEntry {
    objectApiName: string;
    developerName: string;
}

/*
    The sets "A data set for each record type" makes (#624): one record type per object, every
    combination. setCount is counted, never listed, so a cap can refuse a large product without
    building it; combinations is empty above the cap.
*/
export interface IRecordTypeCombinationPlan {
    setCount: number;
    recordTypeCountsByObject: Array<{ objectApiName: string; recordTypeCount: number }>;
    combinations: IRecordTypeCombinationEntry[][];
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

    /*
        Off: only an object's first record type block carries its children (#194). On: every block
        carries its own copy of them (#622), so each record type's records have children of their own.
    */
    readonly isChildTreeCopiedPerRecordTypeBlock: boolean;

    constructor(developerNamesByObjectApiName?: Iterable<[string, readonly string[]]>,
                isChildTreeCopiedPerRecordTypeBlock: boolean = false) {

        this.isChildTreeCopiedPerRecordTypeBlock = isChildTreeCopiedPerRecordTypeBlock;
        this.developerNamesByObjectApiName = new Map();
        for (const [objectApiName, developerNames] of developerNamesByObjectApiName ?? []) {
            this.developerNamesByObjectApiName.set(objectApiName, [...new Set(developerNames)]);
        }

    }

    /*
        A selection can arrive through a command argument, so its shape is checked rather than
        trusted: a plain object of string arrays. Anything else is ignored -- for that entry, or
        wholly when the value is not an object -- and generation falls back to the defaults. The copy
        option is on only for exactly true.
    */
    static fromUnknown(value: unknown, isChildTreeCopiedPerRecordTypeBlock: unknown = false): RecordTypeSelection | undefined {

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

        return new RecordTypeSelection(entries, isChildTreeCopiedPerRecordTypeBlock === true);

    }

    getDeveloperNames(objectApiName: string): readonly string[] | undefined {

        return this.developerNamesByObjectApiName.get(objectApiName);

    }

    static resolveForObject(recordTypeSelection: RecordTypeSelection | undefined,
                            objectApiName: string,
                            writableRecordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>
                        ): IObjectRecordTypeSelection {

        return recordTypeSelection
            ? recordTypeSelection.resolve(objectApiName, writableRecordTypeApiToRecordTypeWrapperMap)
            : { selectedRecordTypeApiNames: [], ignoredDeveloperNames: [] };

    }

    // AN INSTANCE METHOD SO A SAVED SELECTION (#196) CAN DROP A STALE ENTRY, AND RECORD WHAT IT SAW, DURING THE ONE WALK THAT LOADS RECORD TYPES
    resolve(objectApiName: string, writableRecordTypeApiToRecordTypeWrapperMap: Record<string, RecordTypeWrapper>): IObjectRecordTypeSelection {

        const resolution: IObjectRecordTypeSelection = { selectedRecordTypeApiNames: [], ignoredDeveloperNames: [] };
        const developerNames = this.getDeveloperNames(objectApiName) ?? [];

        developerNames.forEach((developerName) => {

            if ( Object.prototype.hasOwnProperty.call(writableRecordTypeApiToRecordTypeWrapperMap, developerName) ) {
                resolution.selectedRecordTypeApiNames.push(developerName);
            } else {
                resolution.ignoredDeveloperNames.push(developerName);
            }

        });

        return resolution;

    }

    /*
        Every combination of one record type per object, the objects in objectApiNames' order (the
        tree's insert order) and the first object's record type changing slowest, each object's names
        in the order ticked. An object with no names, or none in the selection, is in no set.
    */
    static listRecordTypeCombinations(developerNamesByObjectApiName: Readonly<Record<string, readonly string[]>>,
                                        objectApiNames: readonly string[],
                                        maxCombinationCount: number): IRecordTypeCombinationPlan {

        const objectsWithNames = [...new Set(objectApiNames)]
            .filter(objectApiName => Object.prototype.hasOwnProperty.call(developerNamesByObjectApiName, objectApiName))
            .map(objectApiName => ({ objectApiName: objectApiName, developerNames: [...new Set(developerNamesByObjectApiName[objectApiName])] }))
            .filter(objectWithNames => objectWithNames.developerNames.length > 0);

        const setCount = objectsWithNames.length === 0
            ? 0
            : objectsWithNames.reduce((product, objectWithNames) => product * objectWithNames.developerNames.length, 1);

        const combinations = setCount > maxCombinationCount
            ? []
            : objectsWithNames.reduce<IRecordTypeCombinationEntry[][]>((partialCombinations, { objectApiName, developerNames }) =>
                partialCombinations.flatMap(partialCombination => developerNames.map(developerName =>
                    [...partialCombination, { objectApiName: objectApiName, developerName: developerName }])), [[]])
                .filter(combination => combination.length > 0);

        return {
            setCount: setCount,
            recordTypeCountsByObject: objectsWithNames.map(({ objectApiName, developerNames }) => ({ objectApiName: objectApiName, recordTypeCount: developerNames.length })),
            combinations: combinations
        };

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
