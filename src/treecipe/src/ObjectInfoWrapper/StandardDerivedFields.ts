/*
    A standard field Salesforce sets itself from another lookup on the same record, so it can never
    be inserted (#680): Quote.AccountId is the AccountId of the quote's Opportunity. A recipe still
    shows it, as "<source nickname>.<source field>" (AccountId: Opportunity_NickName.AccountId), the
    Recipe Cockpit draws it as a read-only row, and both faker processors drop it before a record
    reaches the Collections API.

    Keyed "<Object>.<Field>", no prototype, own-key checked, like StandardFieldParentReferenceMap. A
    new entry is a decision pinned in StandardDerivedFields.test.ts. Imports nothing, so the panel
    bundle reads it too.
*/
export interface IStandardDerivedField {
    // THE LOOKUP ON THE SAME RECORD THE VALUE COMES THROUGH, AND THE OBJECT IT POINTS AT
    throughFieldApiName: string;
    sourceObjectApiName: string;
    // THE FIELD OF THAT PARENT RECORD SALESFORCE COPIES
    sourceFieldApiName: string;
}

export class StandardDerivedFields {

    private static readonly derivedFieldByObjectField: Readonly<Record<string, IStandardDerivedField>> = Object.freeze(Object.assign(Object.create(null), {
        'Quote.AccountId': Object.freeze({ throughFieldApiName: 'OpportunityId', sourceObjectApiName: 'Opportunity', sourceFieldApiName: 'AccountId' })
    }));

    static resolveDerivedField(objectApiName: string, fieldApiName: string): IStandardDerivedField | undefined {

        const objectFieldKey = `${objectApiName}.${fieldApiName}`;

        return Object.prototype.hasOwnProperty.call(this.derivedFieldByObjectField, objectFieldKey)
            ? this.derivedFieldByObjectField[objectFieldKey]
            : undefined;

    }

    static listDerivedFieldApiNames(objectApiName: string): string[] {

        const objectPrefix = `${objectApiName}.`;

        return Object.keys(this.derivedFieldByObjectField)
            .filter(objectFieldKey => objectFieldKey.startsWith(objectPrefix))
            .map(objectFieldKey => objectFieldKey.slice(objectPrefix.length));

    }

    static listDerivedObjectFields(): string[] {

        return Object.keys(this.derivedFieldByObjectField);

    }

    // THE VALUE A RECIPE WRITES: THE SOURCE RECORD'S NICKNAME AND THE FIELD SALESFORCE COPIES FROM IT
    static formatRecipeValue(sourceNickname: string, derivedField: IStandardDerivedField): string {

        return `${sourceNickname}.${derivedField.sourceFieldApiName}`;

    }

    /*
        The record a through lookup's recipe value names (#704): a bare nickname, or the one a
        snowfakery child copy's reference(<nickname>) names. Only the first line counts, since
        #194's record type blocks note can follow it. Anything else (a TODO, an expression, an Id)
        names no record.
    */
    static readThroughSourceNickname(throughValue: unknown): string | undefined {

        if ( typeof throughValue !== 'string' ) {
            return undefined;
        }

        const firstLine = throughValue.split('\n')[0].trim();

        return /^[A-Za-z]\w*$/.test(firstLine) ? firstLine : /\breference\(([A-Za-z]\w*)\)/.exec(firstLine)?.[1];

    }

    // THE SOURCE NICKNAME OF A RECIPE VALUE formatRecipeValue WROTE, OR undefined FOR ANY OTHER VALUE
    static readSourceNickname(recipeValue: unknown, derivedField: IStandardDerivedField): string | undefined {

        if ( typeof recipeValue !== 'string' ) {
            return undefined;
        }

        const fieldSuffix = `.${derivedField.sourceFieldApiName}`;
        const sourceNickname = recipeValue.endsWith(fieldSuffix) ? recipeValue.slice(0, -fieldSuffix.length) : '';

        return /^[A-Za-z]\w*$/.test(sourceNickname) ? sourceNickname : undefined;

    }

}
