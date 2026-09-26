/*
    The Recipe Cockpit's metadata diff: the recipe's field set against the org's describe.

    This file imports NOTHING, and that is the guarantee rather than a style choice. It takes no
    vscode, no @salesforce/core and no other service, so the classifier is tested with plain objects
    and cannot reach an org, a panel or the configuration. The input types are STRUCTURAL: the
    cockpit's IRecipeCockpitObjectViewModel and SalesforceOrgService's INormalizedOrgObjectDescribe
    both satisfy them as they are, so neither side is converted into a third model on the way in.
*/

export type MetadataDiffFieldStatus = 'new-in-org' | 'removed-from-org' | 'type-changed' | 'picklist-changed' | 'unchanged';

export type MetadataDiffObjectPresence = 'in-both' | 'recipe-only' | 'org-only';

export const METADATA_DIFF_FIELD_STATUSES: readonly MetadataDiffFieldStatus[] = ['new-in-org', 'removed-from-org', 'type-changed', 'picklist-changed', 'unchanged'];

export interface IMetadataDiffRecipeField {
    fieldApiName: string;
    fieldType: string;
}

export interface IMetadataDiffRecipeObject {
    objectApiName: string;
    fields: IMetadataDiffRecipeField[];
}

export interface IMetadataDiffOrgPicklistValue {
    value: string;
    isActive: boolean;
}

export interface IMetadataDiffOrgField {
    fieldApiName: string;
    fieldType: string;
    picklistValues: IMetadataDiffOrgPicklistValue[];
    isCreateable: boolean;
}

export interface IMetadataDiffOrgObject {
    objectApiName: string;
    fields: IMetadataDiffOrgField[];
}

// OBJECT API NAME -> FIELD API NAME -> THE RECIPE'S ACTIVE PICKLIST VALUES, AS normalizeObjectsWrapper READS THEM
export type RecipePicklistValuesByObjectApiName = ReadonlyMap<string, ReadonlyMap<string, string[]>>;

/*
    One field's answer. Both types are carried whatever the status, so the UI can say what changed
    without looking anything up. isTypeComparable is false when the recipe's type is empty (a field
    only the recipe file carries, such as a standard-field mapping) or one this module has no
    describe equivalent for: an "unchanged" status then asserts the field is present on both sides,
    and nothing about its type.
*/
export interface IMetadataDiffFieldResult {
    fieldApiName: string;
    status: MetadataDiffFieldStatus;
    recipeFieldType: string;
    orgFieldType: string;
    isTypeComparable: boolean;
    addedPicklistValues: string[];
    removedPicklistValues: string[];
}

export interface IMetadataDiffObjectResult {
    objectApiName: string;
    presence: MetadataDiffObjectPresence;
    fields: IMetadataDiffFieldResult[];
    statusCounts: Record<MetadataDiffFieldStatus, number>;
    uncreateableOrgOnlyFieldCount: number;
}

export interface IMetadataDiffResult {
    objects: IMetadataDiffObjectResult[];
    statusCounts: Record<MetadataDiffFieldStatus, number>;
}

/*
    The metadata <type> a recipe field carries, lowercased, against the describe types it can come
    back as. The two vocabularies differ for most types (Text is "string", Lookup is "reference",
    Checkbox is "boolean"), so comparing the strings would call nearly every field a type change.
    Number is three describe types because the org picks one by precision and scale.
*/
const DESCRIBE_TYPES_BY_METADATA_TYPE: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
    ['text', ['string']],
    ['textarea', ['textarea']],
    ['longtextarea', ['textarea']],
    ['html', ['textarea']],
    ['encryptedtext', ['encryptedstring']],
    ['email', ['email']],
    ['phone', ['phone']],
    ['url', ['url']],
    ['number', ['double', 'int', 'long']],
    ['percent', ['percent']],
    ['currency', ['currency']],
    ['checkbox', ['boolean']],
    ['date', ['date']],
    ['datetime', ['datetime']],
    ['time', ['time']],
    ['picklist', ['picklist']],
    ['multiselectpicklist', ['multipicklist']],
    ['lookup', ['reference']],
    ['masterdetail', ['reference']],
    ['hierarchy', ['reference']],
    ['externallookup', ['reference']],
    ['indirectlookup', ['reference']],
    ['autonumber', ['string']],
    ['location', ['location']]
]);

const PICKLIST_DESCRIBE_TYPES = new Set(['picklist', 'multipicklist']);

/*
    A compound field's components (Loc__Latitude__s, Addr__Street__s) end in __s, and
    DirectoryProcessor.buildCompoundComponentFieldInfos writes every one of them into the wrapper
    typed 'Text' whatever it describes as -- latitude is a double, street a textarea. The recipe
    side's type for these is synthetic, so it is not compared.
*/
const COMPOUND_COMPONENT_API_NAME_PATTERN = /__s$/i;

export class RecipeCockpitMetadataDiff {

    /*
        Classifies every field of every object on either side.

        The org side is taken to be WHAT THE ORG HAS: an object absent from orgObjects is reported
        as recipe-only and every one of its fields as removed-from-org. A caller holding a describe
        that FAILED must therefore leave that object out of recipeObjects too, or say so itself --
        a connection that timed out is not an org without the object.

        Api names match case-insensitively, as Salesforce matches them; the result is named with
        the recipe's spelling where the recipe has one. An org field absent from the recipe is
        new-in-org only if the org would let a recipe write it: Id, CreatedDate and every other
        system or formula field is on every describe and in no recipe, and listing them would bury
        the one new field a reader has to act on. They are COUNTED instead, never silently dropped.
    */
    static computeMetadataDiff(recipeObjects: IMetadataDiffRecipeObject[],
                                orgObjects: IMetadataDiffOrgObject[],
                                recipePicklistValuesByObjectApiName: RecipePicklistValuesByObjectApiName = new Map()): IMetadataDiffResult {

        const recipeObjectsByKey = this.indexByApiName(recipeObjects, recipeObject => recipeObject.objectApiName);
        const orgObjectsByKey = this.indexByApiName(orgObjects, orgObject => orgObject.objectApiName);
        const recipePicklistValuesByKey = this.indexPicklistValues(recipePicklistValuesByObjectApiName);

        const objectApiNamesByKey = new Map<string, string>();
        [...recipeObjectsByKey, ...orgObjectsByKey].forEach(([objectKey, diffObject]) => {
            if ( !objectApiNamesByKey.has(objectKey) ) {
                objectApiNamesByKey.set(objectKey, diffObject.objectApiName);
            }
        });

        const objectResults = [...objectApiNamesByKey].map(([objectKey, objectApiName]) => this.diffObject(
            objectApiName,
            recipeObjectsByKey.get(objectKey),
            orgObjectsByKey.get(objectKey),
            recipePicklistValuesByKey.get(objectKey) ?? new Map()
        ));

        objectResults.sort((firstObject, secondObject) => this.compareApiNames(firstObject.objectApiName, secondObject.objectApiName));

        const statusCounts = this.buildEmptyStatusCounts();
        objectResults.forEach(objectResult => METADATA_DIFF_FIELD_STATUSES.forEach(status => {
            statusCounts[status] += objectResult.statusCounts[status];
        }));

        return { objects: objectResults, statusCounts: statusCounts };

    }

    private static diffObject(objectApiName: string,
                                recipeObject: IMetadataDiffRecipeObject | undefined,
                                orgObject: IMetadataDiffOrgObject | undefined,
                                recipePicklistValuesByFieldKey: ReadonlyMap<string, string[]>): IMetadataDiffObjectResult {

        const recipeFieldsByKey = this.indexByApiName(recipeObject?.fields ?? [], recipeField => recipeField.fieldApiName);
        const orgFieldsByKey = this.indexByApiName(orgObject?.fields ?? [], orgField => orgField.fieldApiName);

        const fieldResults: IMetadataDiffFieldResult[] = [];
        let uncreateableOrgOnlyFieldCount = 0;

        recipeFieldsByKey.forEach((recipeField, fieldKey) => {

            const orgField = orgFieldsByKey.get(fieldKey);

            fieldResults.push(orgField
                ? this.diffField(recipeField, orgField, recipePicklistValuesByFieldKey.get(fieldKey))
                : this.buildFieldResult(recipeField.fieldApiName, 'removed-from-org', recipeField.fieldType, '', this.isTypeComparable(recipeField)));

        });

        orgFieldsByKey.forEach((orgField, fieldKey) => {

            if ( recipeFieldsByKey.has(fieldKey) ) {
                return;
            }

            if ( !orgField.isCreateable ) {
                uncreateableOrgOnlyFieldCount++;
                return;
            }

            fieldResults.push(this.buildFieldResult(orgField.fieldApiName, 'new-in-org', '', orgField.fieldType, false));

        });

        fieldResults.sort((firstField, secondField) => this.compareApiNames(firstField.fieldApiName, secondField.fieldApiName));

        const statusCounts = this.buildEmptyStatusCounts();
        fieldResults.forEach(fieldResult => statusCounts[fieldResult.status]++);

        return {
            objectApiName: objectApiName,
            presence: recipeObject && orgObject ? 'in-both' : recipeObject ? 'recipe-only' : 'org-only',
            fields: fieldResults,
            statusCounts: statusCounts,
            uncreateableOrgOnlyFieldCount: uncreateableOrgOnlyFieldCount
        };

    }

    /*
        A field on both sides. A type change outranks a picklist change: once a picklist has become
        a text field its values are not "changed", they are gone, and the type is what the reader
        acts on. Picklist values are compared only when BOTH sides are a picklist and the recipe
        recorded its values -- a field the recipe holds no values for makes no claim about them.
        Only ACTIVE org values count, because an inactive value is not one a record can be given.
    */
    private static diffField(recipeField: IMetadataDiffRecipeField,
                                orgField: IMetadataDiffOrgField,
                                recipePicklistValues: string[] | undefined): IMetadataDiffFieldResult {

        const isTypeComparable = this.isTypeComparable(recipeField);

        if ( isTypeComparable && !this.isSameFieldType(recipeField.fieldType, orgField.fieldType) ) {
            return this.buildFieldResult(recipeField.fieldApiName, 'type-changed', recipeField.fieldType, orgField.fieldType, true);
        }

        if ( !recipePicklistValues || !PICKLIST_DESCRIBE_TYPES.has(orgField.fieldType.toLowerCase()) ) {
            return this.buildFieldResult(recipeField.fieldApiName, 'unchanged', recipeField.fieldType, orgField.fieldType, isTypeComparable);
        }

        const recipeValueSet = new Set(recipePicklistValues);
        const orgValues = orgField.picklistValues.filter(picklistValue => picklistValue.isActive).map(picklistValue => picklistValue.value);
        const orgValueSet = new Set(orgValues);

        const addedPicklistValues = [...orgValueSet].filter(orgValue => !recipeValueSet.has(orgValue)).sort(this.compareOrdinal);
        const removedPicklistValues = [...recipeValueSet].filter(recipeValue => !orgValueSet.has(recipeValue)).sort(this.compareOrdinal);

        const fieldResult = this.buildFieldResult(
            recipeField.fieldApiName,
            addedPicklistValues.length > 0 || removedPicklistValues.length > 0 ? 'picklist-changed' : 'unchanged',
            recipeField.fieldType,
            orgField.fieldType,
            isTypeComparable
        );

        fieldResult.addedPicklistValues = addedPicklistValues;
        fieldResult.removedPicklistValues = removedPicklistValues;

        return fieldResult;

    }

    static isTypeComparable(recipeField: IMetadataDiffRecipeField): boolean {

        return this.isTypeMapped(recipeField.fieldType) && !COMPOUND_COMPONENT_API_NAME_PATTERN.test(recipeField.fieldApiName);

    }

    static isTypeMapped(recipeFieldType: string): boolean {

        return DESCRIBE_TYPES_BY_METADATA_TYPE.has(recipeFieldType.toLowerCase());

    }

    static isSameFieldType(recipeFieldType: string, orgFieldType: string): boolean {

        const describeTypes = DESCRIBE_TYPES_BY_METADATA_TYPE.get(recipeFieldType.toLowerCase()) ?? [];

        return describeTypes.includes(orgFieldType.toLowerCase());

    }

    private static buildFieldResult(fieldApiName: string,
                                    status: MetadataDiffFieldStatus,
                                    recipeFieldType: string,
                                    orgFieldType: string,
                                    isTypeComparable: boolean): IMetadataDiffFieldResult {

        return {
            fieldApiName: fieldApiName,
            status: status,
            recipeFieldType: recipeFieldType,
            orgFieldType: orgFieldType,
            isTypeComparable: isTypeComparable,
            addedPicklistValues: [],
            removedPicklistValues: []
        };

    }

    static buildEmptyStatusCounts(): Record<MetadataDiffFieldStatus, number> {

        return { 'new-in-org': 0, 'removed-from-org': 0, 'type-changed': 0, 'picklist-changed': 0, 'unchanged': 0 };

    }

    // THE FIRST ENTRY WINS WHEN TWO NAMES DIFFER ONLY IN CASE, WHICH SALESFORCE WOULD NOT ALLOW ON ONE SIDE
    private static indexByApiName<T>(entries: T[], apiNameOf: (entry: T) => string): Map<string, T> {

        const entriesByKey = new Map<string, T>();

        entries.forEach(entry => {
            const entryKey = apiNameOf(entry).toLowerCase();
            if ( !entriesByKey.has(entryKey) ) {
                entriesByKey.set(entryKey, entry);
            }
        });

        return entriesByKey;

    }

    private static indexPicklistValues(recipePicklistValuesByObjectApiName: RecipePicklistValuesByObjectApiName): Map<string, Map<string, string[]>> {

        const picklistValuesByKey = new Map<string, Map<string, string[]>>();

        recipePicklistValuesByObjectApiName.forEach((picklistValuesByFieldApiName, objectApiName) => {

            const objectKey = objectApiName.toLowerCase();

            if ( picklistValuesByKey.has(objectKey) ) {
                return;
            }

            const picklistValuesByFieldKey = new Map<string, string[]>();

            picklistValuesByFieldApiName.forEach((picklistValues, fieldApiName) => {
                const fieldKey = fieldApiName.toLowerCase();
                if ( !picklistValuesByFieldKey.has(fieldKey) ) {
                    picklistValuesByFieldKey.set(fieldKey, picklistValues);
                }
            });

            picklistValuesByKey.set(objectKey, picklistValuesByFieldKey);

        });

        return picklistValuesByKey;

    }

    // CASE-INSENSITIVE, AND A TOTAL ORDER BECAUSE indexByApiName HAS ALREADY MADE EVERY LOWERCASED NAME UNIQUE
    private static compareApiNames(firstApiName: string, secondApiName: string): number {

        return RecipeCockpitMetadataDiff.compareOrdinal(firstApiName.toLowerCase(), secondApiName.toLowerCase());

    }

    // ORDINAL RATHER THAN localeCompare, WHOSE ORDER DEPENDS ON THE LOCALE THE EXTENSION HOST RUNS IN
    private static compareOrdinal(firstValue: string, secondValue: string): number {

        return firstValue < secondValue ? -1 : firstValue > secondValue ? 1 : 0;

    }

}
