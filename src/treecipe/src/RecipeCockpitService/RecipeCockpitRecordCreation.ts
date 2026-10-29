/*
    The rules of the Recipe Cockpit's tree insert (#255, which replaced #180's per-object Create):
    whether each object of a tree is ready to be inserted into the selected org, which lookups a
    record must carry, and how the ones the recipe could not wire are filled.

    This file imports NOTHING, like RecipeCockpitObjectSelection and RecipeCockpitRecipeWriter. Its
    inputs are structural -- SalesforceOrgService's normalized describe and Organization row fit them
    as they are -- so every guard is asserted on plain values, without an org or a webview.

    Every guard FAILS CLOSED. An org whose type could not be read is not a sandbox, an object whose
    describe failed is not createable, and a parent that could not be counted has no records -- each
    is a reason to disable the insert, never a default that lets it through.
*/

/*
    Past this many records in one tree, the insert's confirmation says the run will take time and
    names the total and the Collections API requests it needs (#255): 2,000 records is ten requests
    of the API's 200-record limit.
*/
export const RECIPE_COCKPIT_LARGE_INSERT_RECORD_THRESHOLD = 2000;

export const COLLECTIONS_API_RECORDS_PER_REQUEST = 200;

// RecordTypeId IS A LOOKUP TO RecordType, AND ITS VALUE IS A DEVELOPER NAME THE INSERT ALREADY SWAPS FOR AN ID
const RECORD_TYPE_ID_FIELD_API_NAME = 'RecordTypeId';

// HOW MANY FIELD NAMES A READINESS REASON SPELLS OUT; THE VIEW MODEL CARRIES THEM ALL
export const RECIPE_COCKPIT_CREATE_REASON_FIELD_LIMIT = 10;

/*
    What a readiness reason is about, beside its sentence (#539), for the reasons a reader can fix
    in the cockpit: the panel links each to the place that fixes it. The sentence is unchanged, and
    a reason no code names gets no link.
*/
export const RECIPE_COCKPIT_CREATE_REASON_CODES = ['objectNotInOrg', 'objectNotCreateable', 'requiredFieldUnticked'] as const;
export type RecipeCockpitCreateReasonCode = typeof RECIPE_COCKPIT_CREATE_REASON_CODES[number];

export interface ICreateDescribeField {
    fieldApiName: string;
    fieldType: string;
    referenceTo: string[];
    isNillable: boolean;
    isCreateable: boolean;
    isDefaultedOnCreate: boolean;
}

export interface ICreateObjectDescribe {
    objectApiName: string;
    isCreateable: boolean;
    fields: ICreateDescribeField[];
}

export interface ICreateOrgTypeDetail {
    isSandbox: boolean;
    organizationType: string;
}

export interface IRequiredLookup {
    fieldApiName: string;
    referenceTo: string[];
}

/*
    One required lookup as the panel and the modal show it. A polymorphic one names every object it
    can point at in parentObjectApiName: no single parent can be chosen for it.
*/
export interface IRecipeCockpitRequiredLookupViewModel {
    fieldApiName: string;
    parentObjectApiName: string;
}

// disabledReason IS '' WHEN CREATE IS OFFERED, AND OTHERWISE THE ONE SENTENCE THE ROW SHOWS
/*
    treeKey is present on a readiness built for one tree's block. The block's fields are not checked
    against the describe (#264): a field the org lacks or will not let the user set fails that
    record at insert time, through the insert's own results, rather than refusing the whole insert.
*/
export interface IRecipeCockpitCreateReadinessViewModel {
    objectApiName: string;
    treeKey?: string;
    disabledReason: string;
    // SET ONLY BESIDE A disabledReason, SO A READY OBJECT POSTS WHAT IT ALWAYS DID (#539)
    disabledReasonCode?: RecipeCockpitCreateReasonCode;
    // requiredFieldUnticked: THE FIRST UNTICKED FIELD THE ORG REQUIRES, THE ROW THE LINK OPENS
    disabledReasonFieldApiName?: string;
    requiredLookups: IRecipeCockpitRequiredLookupViewModel[];
}

/*
    describe is absent when the object could not be described -- the org does not have it, or the
    describe failed -- and describeFailureMessage then says why. Whether a required parent has any
    record is not asked here: the insert queries the parent Ids after the reader confirms, and
    refuses before anything is written when there are none.
*/
export interface ICreateReadinessInput {
    objectApiName: string;
    orgTypeDetail: ICreateOrgTypeDetail | undefined;
    describe?: ICreateObjectDescribe;
    describeFailureMessage?: string;
    // WHY THAT BLOCK COULD NOT BE READ: A REASON IN ITS OWN RIGHT, NEVER A BLOCK WITH NO FIELDS
    recipeFieldRefusalReason?: string;
    // THE FIELDS THE STRUCTURE TAB UNTICKED (#220): NOT SENT, SO ONE THE ORG REQUIRES IS A REASON
    excludedFieldApiNames?: readonly string[];
}

/*
    One lookup of an object as the tree insert fills it: the object it points at (one only -- a
    polymorphic lookup has no single parent) and whether the org requires it.
*/
export interface ITreeInsertLookup {
    fieldApiName: string;
    parentObjectApiName?: string;
    isRequired: boolean;
}

/*
    What one file's records are filled from. isRunReference says a value already names a record of
    this insert -- an Id an earlier file created, or the nickname of a record of the same file, which
    a later round resolves. runRecordIdsByObject is every Id this insert created so far, by object;
    orgRecordIdsByObject is the existing Ids queried for a REQUIRED lookup whose parent is not
    inserted by this tree. inTreeObjectApiNames is every object the tree inserts.
    orgRecordIdsByFieldApiName is, per lookup of this object, the Ids the reader set it to with "Use
    existing <Parent> from org…" (#421): a value that is one of them is kept, never replaced.
*/
export interface ITreeInsertLookupContext {
    isRunReference: (value: string) => boolean;
    runRecordIdsByObject: ReadonlyMap<string, readonly string[]>;
    orgRecordIdsByObject: ReadonlyMap<string, readonly string[]>;
    inTreeObjectApiNames: ReadonlySet<string>;
    orgRecordIdsByFieldApiName?: ReadonlyMap<string, ReadonlySet<string>>;
}

const SALESFORCE_RECORD_ID_PATTERN = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

export class RecipeCockpitRecordCreation {

    // THE REQUESTS AN INSERT OF THESE TOTALS NEEDS AT LEAST: EACH OBJECT'S RECORDS GO 200 TO A REQUEST, AND A FILE INSERTED IN ROUNDS NEEDS MORE
    static countInsertRequests(recordTotalsByObject: ReadonlyMap<string, number>): number {

        return [...recordTotalsByObject.values()].reduce((requestCount, recordTotal) => requestCount + Math.ceil(recordTotal / COLLECTIONS_API_RECORDS_PER_REQUEST), 0);

    }

    /*
        The fields a record cannot be inserted without and the user must send: not nillable,
        createable, and not one the org fills itself (defaultedOnCreate -- a checkbox, OwnerId). The
        insert's readiness refuses such a field when it is unticked (#220).
    */
    static findRequiredFieldApiNames(describe: Pick<ICreateObjectDescribe, 'fields'>): string[] {

        return describe.fields
            .filter(describeField => !describeField.isNillable && describeField.isCreateable && !describeField.isDefaultedOnCreate)
            .map(describeField => describeField.fieldApiName);

    }

    /*
        The lookups a record cannot be inserted without: those the describe marks not nillable, which
        is every master-detail too. One the org fills itself (defaultedOnCreate -- OwnerId is the
        usual one) or the user cannot write is left to the org, and RecordTypeId keeps its own swap.
    */
    static findRequiredLookups(describe: ICreateObjectDescribe): IRequiredLookup[] {

        return describe.fields
            .filter(describeField => this.isLookupField(describeField)
                                        && !describeField.isNillable
                                        && describeField.isCreateable
                                        && !describeField.isDefaultedOnCreate)
            .map(describeField => ({ fieldApiName: describeField.fieldApiName, referenceTo: [...describeField.referenceTo] }));

    }

    // EVERY LOOKUP THE TREE INSERT FILLS OR CLEARS, WITH ITS ONE PARENT WHEN IT HAS ONE
    static findTreeInsertLookups(describe: ICreateObjectDescribe): ITreeInsertLookup[] {

        const requiredFieldApiNames = new Set(this.findRequiredLookups(describe).map(requiredLookup => requiredLookup.fieldApiName));

        return describe.fields
            .filter(describeField => this.isLookupField(describeField))
            .map(describeField => ({
                fieldApiName: describeField.fieldApiName,
                ...( describeField.referenceTo.length === 1 ? { parentObjectApiName: describeField.referenceTo[0] } : {} ),
                isRequired: requiredFieldApiNames.has(describeField.fieldApiName)
            }));

    }

    /*
        Whether the Ids a picker handed back may be written: at least one, each a Salesforce Id, and
        each one the picker's OWN query returned. The picker only lists what its search answered, so
        this is the second time the same rule is held, at the point the Id becomes a record's value.
    */
    static areChosenParentIdsReturnedBySearch(chosenParentRecordIds: readonly string[], searchReturnedRecordIds: ReadonlySet<string>): boolean {

        return chosenParentRecordIds.length > 0
                && chosenParentRecordIds.every(chosenParentRecordId => typeof chosenParentRecordId === 'string'
                                                                        && SALESFORCE_RECORD_ID_PATTERN.test(chosenParentRecordId)
                                                                        && searchReturnedRecordIds.has(chosenParentRecordId));

    }

    static buildCreateReadiness(readinessInput: ICreateReadinessInput): IRecipeCockpitCreateReadinessViewModel {

        const { objectApiName, orgTypeDetail, describe } = readinessInput;
        const notReady = (disabledReason: string, requiredLookups: IRecipeCockpitRequiredLookupViewModel[] = []): IRecipeCockpitCreateReadinessViewModel => ({ objectApiName, disabledReason, requiredLookups });
        const notReadyFor = (disabledReasonCode: RecipeCockpitCreateReasonCode, disabledReason: string, requiredLookups: IRecipeCockpitRequiredLookupViewModel[] = []): IRecipeCockpitCreateReadinessViewModel => ({ objectApiName, disabledReason, disabledReasonCode, requiredLookups });

        if ( !orgTypeDetail ) {
            return notReady('The org\'s type could not be read, so nothing is inserted into it.');
        }

        if ( orgTypeDetail.isSandbox !== true ) {
            return notReady(`Records are inserted only into a sandbox or scratch org, and this org is Production · ${orgTypeDetail.organizationType || 'type unknown'}.`);
        }

        if ( !describe ) {
            return notReadyFor('objectNotInOrg', `${objectApiName} is not in this org${readinessInput.describeFailureMessage ? ` (${readinessInput.describeFailureMessage})` : ''}.`);
        }

        if ( describe.isCreateable !== true ) {
            return notReadyFor('objectNotCreateable', `${objectApiName} is not createable in this org.`);
        }

        if ( readinessInput.recipeFieldRefusalReason ) {
            return notReady(readinessInput.recipeFieldRefusalReason);
        }

        const requiredLookups = this.findRequiredLookups(describe).map(requiredLookup => ({
            fieldApiName: requiredLookup.fieldApiName,
            parentObjectApiName: requiredLookup.referenceTo.join(', ')
        }));

        const excludedFieldApiNames = readinessInput.excludedFieldApiNames ?? [];
        const uncheckedRequiredReason = this.buildUntickedRequiredFieldReason(objectApiName, describe, excludedFieldApiNames);

        if ( uncheckedRequiredReason ) {
            const [firstUntickedFieldApiName] = this.findUntickedRequiredFieldApiNames(describe, excludedFieldApiNames);
            return { ...notReadyFor('requiredFieldUnticked', uncheckedRequiredReason, requiredLookups), disabledReasonFieldApiName: firstUntickedFieldApiName };
        }

        const polymorphicLookup = this.findRequiredLookups(describe).find(requiredLookup => requiredLookup.referenceTo.length !== 1);

        if ( polymorphicLookup ) {
            return notReady(`${polymorphicLookup.fieldApiName} is required and can point at more than one object (${polymorphicLookup.referenceTo.join(', ') || 'none named'}), so no parent can be chosen for it.`, requiredLookups);
        }

        return notReady('', requiredLookups);

    }

    /*
        One file's records with every lookup the recipe could not wire filled or cleared (#255). A
        value that already names a record of this insert is kept -- a faker-js friend's parent, which
        the insert resolves -- and so is an Id the reader set the lookup to with "Use existing
        <Parent> from org…" (#421), which the insert checked the org holds before anything was
        written. Any other value (a TODO, a nickname of nothing inserted, a hand-written Id) is
        replaced: by a random record THIS insert created of the parent, when the tree inserts that
        parent, so a snowfakery tree's children still hang off the parents inserted with them; for a
        required lookup to a parent outside the tree, by a random existing record of the parent; and
        otherwise the field is removed and left blank. pickIndex is the randomness, handed in so a
        test can name the Id it expects. The records are copied; the ones handed in are not changed.
    */
    static prepareTreeInsertRecords(records: unknown[],
                                    lookups: readonly ITreeInsertLookup[],
                                    lookupContext: ITreeInsertLookupContext,
                                    pickIndex: (choiceCount: number) => number): unknown[] {

        // THE RECIPE'S FIELD NAMES COME FROM WORKSPACE XML AND THE LOOKUPS FROM THE ORG'S DESCRIBE: SALESFORCE READS BOTH CASE-INSENSITIVELY
        const orgRecordIdsByLowerFieldApiName = new Map<string, Set<string>>();
        lookupContext.orgRecordIdsByFieldApiName?.forEach((recordIds, fieldApiName) => {
            orgRecordIdsByLowerFieldApiName.set(fieldApiName.toLowerCase(), new Set([...( orgRecordIdsByLowerFieldApiName.get(fieldApiName.toLowerCase()) ?? [] ), ...recordIds]));
        });
        const pick = (choices: readonly string[]) => choices[Math.min(Math.max(Math.floor(pickIndex(choices.length)), 0), choices.length - 1)];

        return records.map(record => {

            if ( record === null || typeof record !== 'object' || Array.isArray(record) ) {
                return record;
            }

            const preparedRecord: Record<string, unknown> = { ...(record as Record<string, unknown>) };

            // SALESFORCE READS FIELD NAMES CASE-INSENSITIVELY, SO "accountid:" IN A HAND-EDITED RECIPE IS AccountId TOO; INDEXED ONCE PER RECORD
            const recordKeysByLowerName = new Map<string, string[]>();
            Object.keys(preparedRecord).forEach(recordKey => {
                const lowerRecordKey = recordKey.toLowerCase();
                recordKeysByLowerName.set(lowerRecordKey, [...( recordKeysByLowerName.get(lowerRecordKey) ?? [] ), recordKey]);
            });

            lookups.forEach(lookup => {

                const recordKeys = recordKeysByLowerName.get(lookup.fieldApiName.toLowerCase()) ?? [];
                const orgRecordIds = orgRecordIdsByLowerFieldApiName.get(lookup.fieldApiName.toLowerCase());
                const keptKey = recordKeys.find(recordKey => typeof preparedRecord[recordKey] === 'string'
                                                                && ( lookupContext.isRunReference(preparedRecord[recordKey] as string) || !!orgRecordIds?.has(preparedRecord[recordKey] as string) ));

                if ( keptKey !== undefined ) {
                    recordKeys.filter(recordKey => recordKey !== keptKey).forEach(recordKey => { delete preparedRecord[recordKey]; });
                    return;
                }

                recordKeys.forEach(recordKey => { delete preparedRecord[recordKey]; });

                const parentObjectApiName = lookup.parentObjectApiName;
                if ( parentObjectApiName === undefined ) {
                    return;
                }

                const runRecordIds = lookupContext.inTreeObjectApiNames.has(parentObjectApiName) ? lookupContext.runRecordIdsByObject.get(parentObjectApiName) ?? [] : [];
                if ( runRecordIds.length > 0 ) {
                    preparedRecord[lookup.fieldApiName] = pick(runRecordIds);
                    return;
                }

                const randomOrgRecordIds = lookup.isRequired ? lookupContext.orgRecordIdsByObject.get(parentObjectApiName) ?? [] : [];
                if ( randomOrgRecordIds.length > 0 ) {
                    preparedRecord[lookup.fieldApiName] = pick(randomOrgRecordIds);
                }

            });

            return preparedRecord;

        });

    }

    // AN UNTICKED FIELD IS NOT SENT: ONE THE ORG REQUIRES WOULD FAIL EVERY RECORD, SO IT IS SAID BEFORE ANYTHING IS INSERTED
    static buildUntickedRequiredFieldReason(objectApiName: string, describe: ICreateObjectDescribe, excludedFieldApiNames: readonly string[]): string {

        const untickedRequired = this.findUntickedRequiredFieldApiNames(describe, excludedFieldApiNames);

        if ( untickedRequired.length === 0 ) {
            return '';
        }

        const shownNames = untickedRequired.slice(0, RECIPE_COCKPIT_CREATE_REASON_FIELD_LIMIT).join(', ');
        const hiddenCount = untickedRequired.length - RECIPE_COCKPIT_CREATE_REASON_FIELD_LIMIT;

        return `${objectApiName} has ${untickedRequired.length} unticked ${untickedRequired.length === 1 ? 'field' : 'fields'} this org requires: ${hiddenCount > 0 ? `${shownNames} and ${hiddenCount} more` : shownNames}. Tick ${untickedRequired.length === 1 ? 'it' : 'them'} in the Treecipe tab to insert records.`;

    }

    // THE ORG'S NAMES, IN ITS DESCRIBE ORDER
    static findUntickedRequiredFieldApiNames(describe: ICreateObjectDescribe, excludedFieldApiNames: readonly string[]): string[] {

        const excludedLowerNames = new Set(excludedFieldApiNames.map(fieldApiName => fieldApiName.toLowerCase()));
        // A REQUIRED LOOKUP IS FILLED WITH A PARENT Id WHETHER OR NOT THE CUT CARRIES IT, SO IT IS NEVER THIS REASON
        const lookupFieldApiNames = new Set(describe.fields.filter(describeField => this.isLookupField(describeField)).map(describeField => describeField.fieldApiName));

        return this.findRequiredFieldApiNames(describe)
            .filter(fieldApiName => excludedLowerNames.has(fieldApiName.toLowerCase()) && !lookupFieldApiNames.has(fieldApiName));

    }

    /*
        The parent each new child record of the Treecipe Adapter points to (#447): the loaded
        parents in the order they were read, each given countPerParent records in a row, so 2 per
        Account under 3 Accounts is [A, A, B, B, C, C]. Undefined for no parents or a count that is
        not a whole number of one or more, so a record is never pointed at no parent.
    */
    static spreadParentIds(parentRecordIds: readonly string[], countPerParent: number): string[] | undefined {

        if ( parentRecordIds.length === 0 || !Number.isSafeInteger(countPerParent) || countPerParent < 1 ) {
            return undefined;
        }

        return parentRecordIds.flatMap(parentRecordId => Array.from({ length: countPerParent }, () => parentRecordId));

    }

    private static isLookupField(describeField: ICreateDescribeField): boolean {

        return describeField.fieldType === 'reference' && describeField.fieldApiName !== RECORD_TYPE_ID_FIELD_API_NAME;

    }

}
