/*
    A field Salesforce calculates or sets itself, so an insert that sends it fails (#685). It stays in
    the recipe as "READ ONLY -- <reason>", the Recipe Cockpit draws it as a locked row, and both faker
    processors drop it before a record reaches the Collections API.

    Custom fields say so in their metadata: a <formula> element (whatever the result <type>), a
    roll-up <type>Summary</type> or <type>AutoNumber</type>. Standard fields do not, so the ones we
    know are listed by "<Object>.<Field>", with no prototype and an own-key check. A field on that list
    is written read only only when the project has its field file. Each entry is checked against the
    Salesforce Object Reference and pinned in ReadOnlyFields.test.ts. Imports nothing, so the panel
    bundle reads it too.
*/
export type ReadOnlyFieldReason = 'formula' | 'roll-up summary' | 'auto number' | 'set by Salesforce';

export class ReadOnlyFields {

    static readonly recipeValuePrefix = 'READ ONLY -- ';

    private static readonly reasonByCustomFieldType: Readonly<Record<string, ReadOnlyFieldReason>> = Object.freeze(Object.assign(Object.create(null), {
        'summary': 'roll-up summary',
        'autonumber': 'auto number'
    }));

    private static readonly standardReadOnlyObjectFields: Readonly<Record<string, true>> = Object.freeze(Object.assign(Object.create(null), {
        'Asset.RootAssetId': true,
        'Campaign.AmountAllOpportunities': true,
        'Campaign.AmountWonOpportunities': true,
        'Campaign.NumberOfContacts': true,
        'Campaign.NumberOfConvertedLeads': true,
        'Campaign.NumberOfLeads': true,
        'Campaign.NumberOfOpportunities': true,
        'Campaign.NumberOfResponses': true,
        'Campaign.NumberOfWonOpportunities': true,
        'CampaignMember.LeadOrContactId': true,
        'Case.IsClosed': true,
        'Opportunity.ExpectedRevenue': true,
        'Opportunity.Fiscal': true,
        'Opportunity.FiscalQuarter': true,
        'Opportunity.FiscalYear': true,
        'Opportunity.ForecastCategory': true,
        'Opportunity.HasOpportunityLineItem': true,
        'Opportunity.IsClosed': true,
        'Opportunity.IsWon': true
    }));

    // A <formula> MAKES ANY FIELD READ ONLY, WHATEVER ITS RESULT <type>; OTHERWISE THE <type> DECIDES
    static resolveCustomFieldReason(fieldType: string, hasFormula: boolean): ReadOnlyFieldReason | undefined {

        if ( hasFormula ) {
            return 'formula';
        }

        const fieldTypeKey = typeof fieldType === 'string' ? fieldType.toLowerCase() : '';
        return Object.prototype.hasOwnProperty.call(this.reasonByCustomFieldType, fieldTypeKey)
            ? this.reasonByCustomFieldType[fieldTypeKey]
            : undefined;

    }

    static isStandardReadOnlyField(objectApiName: string, fieldApiName: string): boolean {

        return Object.prototype.hasOwnProperty.call(this.standardReadOnlyObjectFields, `${objectApiName}.${fieldApiName}`);

    }

    static listStandardReadOnlyObjectFields(): string[] {

        return Object.keys(this.standardReadOnlyObjectFields);

    }

    static formatRecipeValue(reason: ReadOnlyFieldReason): string {

        return `${this.recipeValuePrefix}${reason}`;

    }

    // THE REASON A RECIPE VALUE formatRecipeValue WROTE NAMES, OR undefined FOR ANY OTHER VALUE
    static readReason(recipeValue: unknown): ReadOnlyFieldReason | undefined {

        if ( typeof recipeValue !== 'string' || !recipeValue.startsWith(this.recipeValuePrefix) ) {
            return undefined;
        }

        const reason = recipeValue.slice(this.recipeValuePrefix.length).trim();
        const knownReasons: ReadOnlyFieldReason[] = ['formula', 'roll-up summary', 'auto number', 'set by Salesforce'];

        return knownReasons.find(knownReason => knownReason === reason);

    }

    static isReadOnlyRecipeValue(recipeValue: unknown): boolean {

        return this.readReason(recipeValue) !== undefined;

    }

}
