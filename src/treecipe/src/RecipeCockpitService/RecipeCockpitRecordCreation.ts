/*
    The rules of the Recipe Cockpit's Create (#180): whether an object's "+ Create" is offered, which
    lookups a created record must carry, and how they are filled.

    This file imports NOTHING, like RecipeCockpitMetadataDiff and RecipeCockpitRecipeWriter. Its
    inputs are structural -- SalesforceOrgService's normalized describe and Organization row fit them
    as they are -- so every guard is asserted on plain values, without an org or a webview.

    Every guard FAILS CLOSED. An org whose type could not be read is not a sandbox, an object whose
    describe failed is not createable, and a parent that could not be counted has no records -- each
    is a reason to disable Create, never a default that lets it through.
*/

export const RECIPE_COCKPIT_CREATE_MAX_COUNT = 200;

// RecordTypeId IS A LOOKUP TO RecordType, AND ITS VALUE IS A DEVELOPER NAME THE INSERT ALREADY SWAPS FOR AN ID
const RECORD_TYPE_ID_FIELD_API_NAME = 'RecordTypeId';

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
    can point at in parentObjectApiName, and has no count: no single parent can be chosen for it.
*/
export interface IRecipeCockpitRequiredLookupViewModel {
    fieldApiName: string;
    parentObjectApiName: string;
    parentRecordCount: number;
}

// disabledReason IS '' WHEN CREATE IS OFFERED, AND OTHERWISE THE ONE SENTENCE THE ROW SHOWS
export interface IRecipeCockpitCreateReadinessViewModel {
    objectApiName: string;
    disabledReason: string;
    requiredLookups: IRecipeCockpitRequiredLookupViewModel[];
}

/*
    describe is absent when the object could not be described -- the org does not have it, or the
    describe failed -- and describeFailureMessage then says why. A parent count that is undefined
    was not counted, which is read as none.
*/
export interface ICreateReadinessInput {
    objectApiName: string;
    orgTypeDetail: ICreateOrgTypeDetail | undefined;
    describe?: ICreateObjectDescribe;
    describeFailureMessage?: string;
    parentRecordCountsByObject: ReadonlyMap<string, number | undefined>;
}

export interface IRequiredLookupParentIds {
    fieldApiName: string;
    parentRecordIds: string[];
}

export class RecipeCockpitRecordCreation {

    // AN INTEGER FROM 1 TO 200, AND NOTHING ELSE: "25", 2.5, 0, 201 AND NaN ARE ALL REFUSED
    static isValidCreateCount(candidateCount: unknown): candidateCount is number {

        return typeof candidateCount === 'number'
                && Number.isInteger(candidateCount)
                && candidateCount >= 1
                && candidateCount <= RECIPE_COCKPIT_CREATE_MAX_COUNT;

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

    // EVERY OTHER LOOKUP IS LEFT BLANK: A TODO OR AN ANCESTOR'S NICKNAME IN IT NAMES NO RECORD IN THE ORG
    static findOptionalLookupFieldApiNames(describe: ICreateObjectDescribe): string[] {

        const requiredFieldApiNames = new Set(this.findRequiredLookups(describe).map(requiredLookup => requiredLookup.fieldApiName));

        return describe.fields
            .filter(describeField => this.isLookupField(describeField) && !requiredFieldApiNames.has(describeField.fieldApiName))
            .map(describeField => describeField.fieldApiName);

    }

    static buildCreateReadiness(readinessInput: ICreateReadinessInput): IRecipeCockpitCreateReadinessViewModel {

        const { objectApiName, orgTypeDetail, describe } = readinessInput;
        const notReady = (disabledReason: string, requiredLookups: IRecipeCockpitRequiredLookupViewModel[] = []) => ({ objectApiName, disabledReason, requiredLookups });

        if ( !orgTypeDetail ) {
            return notReady('The org\'s type could not be read, so nothing is created in it.');
        }

        if ( orgTypeDetail.isSandbox !== true ) {
            return notReady(`Records are created only in a sandbox, and this org is Production · ${orgTypeDetail.organizationType || 'type unknown'}.`);
        }

        if ( !describe ) {
            return notReady(`${objectApiName} is not in this org${readinessInput.describeFailureMessage ? ` (${readinessInput.describeFailureMessage})` : ''}.`);
        }

        if ( describe.isCreateable !== true ) {
            return notReady(`${objectApiName} is not createable in this org.`);
        }

        const requiredLookups = this.findRequiredLookups(describe).map(requiredLookup => ({
            fieldApiName: requiredLookup.fieldApiName,
            parentObjectApiName: requiredLookup.referenceTo.join(', '),
            parentRecordCount: requiredLookup.referenceTo.length === 1
                ? readinessInput.parentRecordCountsByObject.get(requiredLookup.referenceTo[0]) ?? 0
                : 0
        }));

        const polymorphicLookup = this.findRequiredLookups(describe).find(requiredLookup => requiredLookup.referenceTo.length !== 1);

        if ( polymorphicLookup ) {
            return notReady(`${polymorphicLookup.fieldApiName} is required and can point at more than one object (${polymorphicLookup.referenceTo.join(', ') || 'none named'}), so no parent can be chosen for it.`, requiredLookups);
        }

        const parentlessLookup = requiredLookups.find(requiredLookup => requiredLookup.parentRecordCount < 1);

        if ( parentlessLookup ) {
            const isCounted = readinessInput.parentRecordCountsByObject.get(parentlessLookup.parentObjectApiName) !== undefined;
            return notReady(isCounted
                ? `${parentlessLookup.fieldApiName} needs a ${parentlessLookup.parentObjectApiName} record, and the org has none.`
                : `${parentlessLookup.fieldApiName} needs a ${parentlessLookup.parentObjectApiName} record, and ${parentlessLookup.parentObjectApiName} could not be counted.`, requiredLookups);
        }

        return notReady('', requiredLookups);

    }

    /*
        The generated records with every lookup replaced: each required one gets a random existing Id
        of its parent, and every other lookup is removed, so it is left blank rather than sent as
        the TODO or nickname the recipe held. pickIndex is the randomness, handed in so a test can
        name the Id it expects. The records are copied; the ones handed in are not changed.
    */
    static assignLookupIds(records: unknown[],
                            requiredLookupParentIds: IRequiredLookupParentIds[],
                            clearedFieldApiNames: string[],
                            pickIndex: (choiceCount: number) => number): unknown[] {

        return records.map(record => {

            if ( record === null || typeof record !== 'object' || Array.isArray(record) ) {
                return record;
            }

            const assignedRecord: Record<string, unknown> = { ...(record as Record<string, unknown>) };

            // SALESFORCE READS FIELD NAMES CASE-INSENSITIVELY, SO "accountid:" IN A HAND-EDITED RECIPE IS AccountId TOO
            const replacedFieldApiNames = new Set([...clearedFieldApiNames, ...requiredLookupParentIds.map(requiredLookup => requiredLookup.fieldApiName)]
                .map(fieldApiName => fieldApiName.toLowerCase()));
            Object.keys(assignedRecord)
                .filter(recordKey => replacedFieldApiNames.has(recordKey.toLowerCase()))
                .forEach(recordKey => { delete assignedRecord[recordKey]; });

            requiredLookupParentIds.forEach(requiredLookup => {
                const parentRecordIds = requiredLookup.parentRecordIds;
                const chosenIndex = Math.min(Math.max(Math.floor(pickIndex(parentRecordIds.length)), 0), parentRecordIds.length - 1);
                assignedRecord[requiredLookup.fieldApiName] = parentRecordIds[chosenIndex];
            });

            return assignedRecord;

        });

    }

    private static isLookupField(describeField: ICreateDescribeField): boolean {

        return describeField.fieldType === 'reference' && describeField.fieldApiName !== RECORD_TYPE_ID_FIELD_API_NAME;

    }

}
