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

// HOW MANY FIELD NAMES A READINESS REASON SPELLS OUT; THE VIEW MODEL CARRIES THEM ALL
export const RECIPE_COCKPIT_CREATE_REASON_FIELD_LIMIT = 10;

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
    treeKey is present on a readiness built for one tree's block, and the two field lists only when
    that block's fields were checked against a describe (#210) -- an object-wide readiness, or one
    refused before the check, carries neither.
*/
export interface IRecipeCockpitCreateReadinessViewModel {
    objectApiName: string;
    treeKey?: string;
    disabledReason: string;
    requiredLookups: IRecipeCockpitRequiredLookupViewModel[];
    missingFieldApiNames?: string[];
    notCreateableFieldApiNames?: string[];
}

/*
    describe is absent when the object could not be described -- the org does not have it, or the
    describe failed -- and describeFailureMessage then says why. Whether a required parent has any
    record is not asked here: the Create queries the parent Ids after the reader confirms, and
    refuses before anything is written when there are none.
*/
export interface ICreateReadinessInput {
    objectApiName: string;
    orgTypeDetail: ICreateOrgTypeDetail | undefined;
    describe?: ICreateObjectDescribe;
    describeFailureMessage?: string;
    // THE FIELD KEYS OF THE BLOCK THE INSERT WOULD SEND; ABSENT, NO FIELD IS CHECKED
    recipeFieldApiNames?: readonly string[];
    // WHY THAT BLOCK COULD NOT BE READ: A REASON IN ITS OWN RIGHT, NEVER A BLOCK WITH NO FIELDS
    recipeFieldRefusalReason?: string;
    // THE FIELDS THE STRUCTURE TAB UNTICKED (#220): NOT SENT, SO ONE THE ORG REQUIRES IS A REASON
    excludedFieldApiNames?: readonly string[];
}

export interface IRecipeFieldCheck {
    missingFieldApiNames: string[];
    notCreateableFieldApiNames: string[];
}

/*
    roundRobin (#254) gives record i the parent at i mod K, in the order the picker listed them;
    random, the default, picks one per record as Create always has.
*/
export interface IRequiredLookupParentIds {
    fieldApiName: string;
    parentRecordIds: string[];
    assignment?: 'random' | 'roundRobin';
}

/*
    A lookup of the cut recipe block the Create asks about (#254): it points at exactly one object,
    so there is one object to search. isRequired decides whether "Leave blank" is offered.
*/
export interface IPickableLookup {
    fieldApiName: string;
    parentObjectApiName: string;
    isRequired: boolean;
}

// WHAT THE READER CHOSE FOR ONE LOOKUP: NOTHING HERE IS A DEFAULT, EACH IS SOMETHING THEY PICKED
export type LookupParentChoice =
    | { kind: 'random' }
    | { kind: 'blank' }
    | { kind: 'chosen'; parentRecordIds: string[] };

// AS datasetSource.json RECORDS IT: "random", "blank", OR THE CHOSEN Ids IN ORDER
export type RecordedLookupParentChoice = 'random' | 'blank' | string[];

const SALESFORCE_RECORD_ID_PATTERN = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

export class RecipeCockpitRecordCreation {

    // AN INTEGER FROM 1 TO 200, AND NOTHING ELSE: "25", 2.5, 0, 201 AND NaN ARE ALL REFUSED
    static isValidCreateCount(candidateCount: unknown): candidateCount is number {

        return typeof candidateCount === 'number'
                && Number.isInteger(candidateCount)
                && candidateCount >= 1
                && candidateCount <= RECIPE_COCKPIT_CREATE_MAX_COUNT;

    }

    /*
        The fields a record cannot be inserted without and the user must send: not nillable,
        createable, and not one the org fills itself (defaultedOnCreate -- a checkbox, OwnerId). The
        Structure tab marks such a field "required in <org>" when it is unticked (#220).
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

    // EVERY OTHER LOOKUP IS LEFT BLANK: A TODO OR AN ANCESTOR'S NICKNAME IN IT NAMES NO RECORD IN THE ORG
    static findOptionalLookupFieldApiNames(describe: ICreateObjectDescribe): string[] {

        const requiredFieldApiNames = new Set(this.findRequiredLookups(describe).map(requiredLookup => requiredLookup.fieldApiName));

        return describe.fields
            .filter(describeField => this.isLookupField(describeField) && !requiredFieldApiNames.has(describeField.fieldApiName))
            .map(describeField => describeField.fieldApiName);

    }

    /*
        The lookups of the cut block the reader is asked about, in the block's order: each is a lookup
        the describe knows, points at exactly ONE object and can be written. A polymorphic one is
        left as it was (blank when optional; a required one already blocks Create), and so is any
        lookup the block does not carry -- a required one of those still gets a random parent.
    */
    static findPickableLookups(describe: ICreateObjectDescribe, recipeFieldApiNames: readonly string[]): IPickableLookup[] {

        const requiredFieldApiNames = new Set(this.findRequiredLookups(describe).map(requiredLookup => requiredLookup.fieldApiName));
        const describeLookupsByLowerName = new Map(describe.fields
            .filter(describeField => this.isLookupField(describeField))
            .map(describeField => [describeField.fieldApiName.toLowerCase(), describeField]));
        const pickedFieldApiNames = new Set<string>();

        return recipeFieldApiNames.flatMap(recipeFieldApiName => {

            const describeField = describeLookupsByLowerName.get(recipeFieldApiName.toLowerCase());

            if ( !describeField
                    || describeField.referenceTo.length !== 1
                    || describeField.isCreateable !== true
                    || pickedFieldApiNames.has(describeField.fieldApiName) ) {
                return [];
            }

            pickedFieldApiNames.add(describeField.fieldApiName);

            return [{
                fieldApiName: describeField.fieldApiName,
                parentObjectApiName: describeField.referenceTo[0],
                isRequired: requiredFieldApiNames.has(describeField.fieldApiName)
            }];

        });

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

    static toRecordedLookupParentChoice(lookupParentChoice: LookupParentChoice): RecordedLookupParentChoice {

        return lookupParentChoice.kind === 'chosen' ? [...lookupParentChoice.parentRecordIds] : lookupParentChoice.kind;

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

        if ( readinessInput.recipeFieldRefusalReason ) {
            return notReady(readinessInput.recipeFieldRefusalReason);
        }

        const fieldCheck = readinessInput.recipeFieldApiNames
            ? this.checkRecipeFields(describe, readinessInput.recipeFieldApiNames)
            : undefined;
        const withFieldCheck = (readiness: IRecipeCockpitCreateReadinessViewModel): IRecipeCockpitCreateReadinessViewModel => fieldCheck ? { ...readiness, ...fieldCheck } : readiness;
        const fieldReason = fieldCheck ? this.buildFieldCheckReason(objectApiName, fieldCheck) : '';

        const requiredLookups = this.findRequiredLookups(describe).map(requiredLookup => ({
            fieldApiName: requiredLookup.fieldApiName,
            parentObjectApiName: requiredLookup.referenceTo.join(', ')
        }));

        if ( fieldReason ) {
            return withFieldCheck(notReady(fieldReason, requiredLookups));
        }

        const uncheckedRequiredReason = this.buildUntickedRequiredFieldReason(objectApiName, describe, readinessInput.excludedFieldApiNames ?? []);

        if ( uncheckedRequiredReason ) {
            return withFieldCheck(notReady(uncheckedRequiredReason, requiredLookups));
        }

        const polymorphicLookup = this.findRequiredLookups(describe).find(requiredLookup => requiredLookup.referenceTo.length !== 1);

        if ( polymorphicLookup ) {
            return withFieldCheck(notReady(`${polymorphicLookup.fieldApiName} is required and can point at more than one object (${polymorphicLookup.referenceTo.join(', ') || 'none named'}), so no parent can be chosen for it.`, requiredLookups));
        }

        return withFieldCheck(notReady('', requiredLookups));

    }

    /*
        The generated records with every lookup replaced: each assigned one gets an existing Id of its
        parent -- a random one, or with roundRobin the one at the record's index mod the parents
        chosen -- and every other lookup is removed, so it is left blank rather than sent as the TODO
        or nickname the recipe held. pickIndex is the randomness, handed in so a test can name the
        Id it expects. The records are copied; the ones handed in are not changed.
    */
    static assignLookupIds(records: unknown[],
                            requiredLookupParentIds: IRequiredLookupParentIds[],
                            clearedFieldApiNames: string[],
                            pickIndex: (choiceCount: number) => number): unknown[] {

        return records.map((record, recordIndex) => {

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
                if ( requiredLookup.assignment === 'roundRobin' ) {
                    assignedRecord[requiredLookup.fieldApiName] = parentRecordIds[recordIndex % parentRecordIds.length];
                    return;
                }
                const chosenIndex = Math.min(Math.max(Math.floor(pickIndex(parentRecordIds.length)), 0), parentRecordIds.length - 1);
                assignedRecord[requiredLookup.fieldApiName] = parentRecordIds[chosenIndex];
            });

            return assignedRecord;

        });

    }

    /*
        The recipe's fields the insert would fail on: one the describe does not have, and one it has
        but will not let the user set. Names are matched case-insensitively, as Salesforce reads them
        (assignLookupIds does the same), and reported as the recipe writes them. A lookup the describe
        knows is never "not createable" here -- the Create replaces or removes every one of them --
        but a lookup it does NOT know stays in the record, so it is missing like any other field.
    */
    static checkRecipeFields(describe: ICreateObjectDescribe, recipeFieldApiNames: readonly string[]): IRecipeFieldCheck {

        // NO PROTOTYPE: A RECIPE FIELD NAMED __proto__ OR constructor MUST READ AS ABSENT, NOT INHERITED
        const describeFieldsByLowerName: Record<string, ICreateDescribeField> = Object.create(null);
        describe.fields.forEach(describeField => { describeFieldsByLowerName[describeField.fieldApiName.toLowerCase()] = describeField; });

        const fieldCheck: IRecipeFieldCheck = { missingFieldApiNames: [], notCreateableFieldApiNames: [] };

        [...new Set(recipeFieldApiNames)].forEach(recipeFieldApiName => {

            const lowerName = recipeFieldApiName.toLowerCase();
            const describeField = Object.prototype.hasOwnProperty.call(describeFieldsByLowerName, lowerName) ? describeFieldsByLowerName[lowerName] : undefined;

            if ( !describeField ) {
                fieldCheck.missingFieldApiNames.push(recipeFieldApiName);
            } else if ( describeField.isCreateable !== true && !this.isLookupField(describeField) ) {
                fieldCheck.notCreateableFieldApiNames.push(recipeFieldApiName);
            }

        });

        return fieldCheck;

    }

    // AN UNTICKED FIELD IS NOT SENT: ONE THE ORG REQUIRES WOULD FAIL EVERY RECORD, SO IT IS SAID BEFORE ANYTHING IS INSERTED
    static buildUntickedRequiredFieldReason(objectApiName: string, describe: ICreateObjectDescribe, excludedFieldApiNames: readonly string[]): string {

        const excludedLowerNames = new Set(excludedFieldApiNames.map(fieldApiName => fieldApiName.toLowerCase()));
        // A REQUIRED LOOKUP IS FILLED WITH A PARENT Id WHETHER OR NOT THE CUT CARRIES IT, SO IT IS NEVER THIS REASON
        const lookupFieldApiNames = new Set(describe.fields.filter(describeField => this.isLookupField(describeField)).map(describeField => describeField.fieldApiName));
        const untickedRequired = this.findRequiredFieldApiNames(describe)
            .filter(fieldApiName => excludedLowerNames.has(fieldApiName.toLowerCase()) && !lookupFieldApiNames.has(fieldApiName));

        if ( untickedRequired.length === 0 ) {
            return '';
        }

        const shownNames = untickedRequired.slice(0, RECIPE_COCKPIT_CREATE_REASON_FIELD_LIMIT).join(', ');
        const hiddenCount = untickedRequired.length - RECIPE_COCKPIT_CREATE_REASON_FIELD_LIMIT;

        return `${objectApiName} has ${untickedRequired.length} unticked ${untickedRequired.length === 1 ? 'field' : 'fields'} this org requires: ${hiddenCount > 0 ? `${shownNames} and ${hiddenCount} more` : shownNames}. Tick ${untickedRequired.length === 1 ? 'it' : 'them'} in Structure to create records.`;

    }

    static buildFieldCheckReason(objectApiName: string, fieldCheck: IRecipeFieldCheck): string {

        const describeCount = (fieldCount: number) => `${fieldCount} recipe ${fieldCount === 1 ? 'field' : 'fields'}`;
        const listNames = (fieldApiNames: string[]) => {
            const shownNames = fieldApiNames.slice(0, RECIPE_COCKPIT_CREATE_REASON_FIELD_LIMIT).join(', ');
            const hiddenCount = fieldApiNames.length - RECIPE_COCKPIT_CREATE_REASON_FIELD_LIMIT;
            return hiddenCount > 0 ? `${shownNames} and ${hiddenCount} more` : shownNames;
        };

        const sentences: string[] = [];

        if ( fieldCheck.missingFieldApiNames.length > 0 ) {
            sentences.push(`${objectApiName} is missing ${describeCount(fieldCheck.missingFieldApiNames.length)} in this org: ${listNames(fieldCheck.missingFieldApiNames)}.`);
        }

        if ( fieldCheck.notCreateableFieldApiNames.length > 0 ) {
            sentences.push(`${objectApiName} has ${describeCount(fieldCheck.notCreateableFieldApiNames.length)} this org will not let you set: ${listNames(fieldCheck.notCreateableFieldApiNames)}.`);
        }

        return sentences.join(' ');

    }

    private static isLookupField(describeField: ICreateDescribeField): boolean {

        return describeField.fieldType === 'reference' && describeField.fieldApiName !== RECORD_TYPE_ID_FIELD_API_NAME;

    }

}
