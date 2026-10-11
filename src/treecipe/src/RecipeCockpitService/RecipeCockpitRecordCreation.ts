/*
    The rules of the Recipe Cockpit's tree insert (#255, which replaced #180's per-object Create):
    whether each object of a tree is ready to be inserted into the selected org, which lookups a
    record must carry, and how the ones the recipe could not wire are filled.

    This file imports NOTHING, like RecipeCockpitMetadataDiff and RecipeCockpitRecipeWriter. Its
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
    record is not asked here: the insert queries the parent Ids after the reader confirms, and
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
*/
export interface ITreeInsertLookupContext {
    isRunReference: (value: string) => boolean;
    runRecordIdsByObject: ReadonlyMap<string, readonly string[]>;
    orgRecordIdsByObject: ReadonlyMap<string, readonly string[]>;
    inTreeObjectApiNames: ReadonlySet<string>;
}

export class RecipeCockpitRecordCreation {

    // THE REQUESTS AN INSERT OF THESE TOTALS NEEDS AT LEAST: EACH OBJECT'S RECORDS GO 200 TO A REQUEST, AND A FILE INSERTED IN ROUNDS NEEDS MORE
    static countInsertRequests(recordTotalsByObject: ReadonlyMap<string, number>): number {

        return [...recordTotalsByObject.values()].reduce((requestCount, recordTotal) => requestCount + Math.ceil(recordTotal / COLLECTIONS_API_RECORDS_PER_REQUEST), 0);

    }

    /*
        The fields a record cannot be inserted without and the user must send: not nillable,
        createable, and not one the org fills itself (defaultedOnCreate -- a checkbox, OwnerId). The
        Treecipe tab marks such a field "required in <org>" when it is unticked (#220).
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

    static buildCreateReadiness(readinessInput: ICreateReadinessInput): IRecipeCockpitCreateReadinessViewModel {

        const { objectApiName, orgTypeDetail, describe } = readinessInput;
        const notReady = (disabledReason: string, requiredLookups: IRecipeCockpitRequiredLookupViewModel[] = []) => ({ objectApiName, disabledReason, requiredLookups });

        if ( !orgTypeDetail ) {
            return notReady('The org\'s type could not be read, so nothing is inserted into it.');
        }

        if ( orgTypeDetail.isSandbox !== true ) {
            return notReady(`Records are inserted only into a sandbox or scratch org, and this org is Production · ${orgTypeDetail.organizationType || 'type unknown'}.`);
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
        One file's records with every lookup the recipe could not wire filled or cleared (#255). A
        value that already names a record of this insert is kept -- a faker-js friend's parent, which
        the insert resolves. Any other value (a TODO, a nickname of nothing inserted, a hand-written
        Id) is replaced: by a random record THIS insert created of the parent, when the tree inserts
        that parent, so a snowfakery tree's children still hang off the parents inserted with them;
        for a required lookup with no such record, by a random existing record of the parent; and
        otherwise the field is removed and left blank. pickIndex is the randomness, handed in so a
        test can name the Id it expects. The records are copied; the ones handed in are not changed.
    */
    static prepareTreeInsertRecords(records: unknown[],
                                    lookups: readonly ITreeInsertLookup[],
                                    lookupContext: ITreeInsertLookupContext,
                                    pickIndex: (choiceCount: number) => number): unknown[] {

        const pick = (choices: readonly string[]) => choices[Math.min(Math.max(Math.floor(pickIndex(choices.length)), 0), choices.length - 1)];

        return records.map(record => {

            if ( record === null || typeof record !== 'object' || Array.isArray(record) ) {
                return record;
            }

            const preparedRecord: Record<string, unknown> = { ...(record as Record<string, unknown>) };

            lookups.forEach(lookup => {

                // SALESFORCE READS FIELD NAMES CASE-INSENSITIVELY, SO "accountid:" IN A HAND-EDITED RECIPE IS AccountId TOO
                const lowerFieldApiName = lookup.fieldApiName.toLowerCase();
                const recordKeys = Object.keys(preparedRecord).filter(recordKey => recordKey.toLowerCase() === lowerFieldApiName);
                const keptKey = recordKeys.find(recordKey => typeof preparedRecord[recordKey] === 'string' && lookupContext.isRunReference(preparedRecord[recordKey] as string));

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
                const orgRecordIds = lookup.isRequired ? lookupContext.orgRecordIdsByObject.get(parentObjectApiName) ?? [] : [];
                const choices = runRecordIds.length > 0 ? runRecordIds : orgRecordIds;

                if ( choices.length > 0 ) {
                    preparedRecord[lookup.fieldApiName] = pick(choices);
                }

            });

            return preparedRecord;

        });

    }

    /*
        The recipe's fields the insert would fail on: one the describe does not have, and one it has
        but will not let the user set. Names are matched case-insensitively, as Salesforce reads them
        (assignLookupIds does the same), and reported as the recipe writes them. A lookup the describe
        knows is never "not createable" here -- the insert fills or removes every one of them --
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

        return `${objectApiName} has ${untickedRequired.length} unticked ${untickedRequired.length === 1 ? 'field' : 'fields'} this org requires: ${hiddenCount > 0 ? `${shownNames} and ${hiddenCount} more` : shownNames}. Tick ${untickedRequired.length === 1 ? 'it' : 'them'} in the Treecipe tab to insert records.`;

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
