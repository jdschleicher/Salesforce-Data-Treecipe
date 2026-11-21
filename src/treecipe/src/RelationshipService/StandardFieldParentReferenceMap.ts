/*
    The parent of a well-known STANDARD lookup or hierarchy field, keyed "<Object>.<Field>" (#400).

    Source format writes no <referenceTo> for these: Account.ParentId is "<type>Hierarchy</type>"
    and nothing else, Contact.ReportsToId a bare Lookup. Salesforce fixes their parent, so it is
    known without an org. DirectoryProcessor reads this map ONLY when a field file carries no
    <referenceTo> and no custom relationship mapping names the field; the name it answers still
    goes through SalesforceApiName and ObjectInfoWrapper.addKeyToObjectInfoMap like any <referenceTo>.

    Deliberately absent, so a generated tree never inserts a record nobody wants faked (#680):
      - polymorphic fields (WhoId, WhatId, OwnerId): one parent cannot be named
      - fields whose parent is User (Contract.CompanySignedId, Order.CompanyAuthorizedById)
      - Pricebook2Id fields: an org uses its existing standard price book, not a fake one
      - Order.OriginalOrderId and OrderItem.OriginalOrderItemId: set only on a reduction order, and a
        mapped self-lookup gets a faker-js child iteration that would be an invalid second order
    Imports nothing, so any service can read it.
*/
export class StandardFieldParentReferenceMap {

    // NULL PROTOTYPED AND OWN-KEY CHECKED: A FIELD NAMED LIKE AN Object.prototype MEMBER MUST NOT RESOLVE TO IT
    private static readonly parentObjectApiNameByObjectField: Readonly<Record<string, string>> = Object.freeze(Object.assign(Object.create(null), {
        'Account.ParentId': 'Account',
        'Asset.AccountId': 'Account',
        'Asset.AssetProvidedById': 'Account',
        'Asset.AssetServicedById': 'Account',
        'Asset.ContactId': 'Contact',
        'Asset.ParentId': 'Asset',
        'Asset.Product2Id': 'Product2',
        'Campaign.ParentId': 'Campaign',
        'CampaignMember.CampaignId': 'Campaign',
        'CampaignMember.ContactId': 'Contact',
        'CampaignMember.LeadId': 'Lead',
        'Case.AccountId': 'Account',
        'Case.AssetId': 'Asset',
        'Case.ContactId': 'Contact',
        'Case.ParentId': 'Case',
        'Contact.AccountId': 'Account',
        'Contact.ReportsToId': 'Contact',
        'Contract.AccountId': 'Account',
        'Contract.CustomerSignedId': 'Contact',
        'Opportunity.AccountId': 'Account',
        'Opportunity.CampaignId': 'Campaign',
        'Opportunity.ContractId': 'Contract',
        'OpportunityContactRole.ContactId': 'Contact',
        'OpportunityContactRole.OpportunityId': 'Opportunity',
        'OpportunityLineItem.OpportunityId': 'Opportunity',
        'OpportunityLineItem.PricebookEntryId': 'PricebookEntry',
        'OpportunityLineItem.Product2Id': 'Product2',
        'Order.AccountId': 'Account',
        'Order.BillToContactId': 'Contact',
        'Order.ContractId': 'Contract',
        'Order.CustomerAuthorizedById': 'Contact',
        'Order.OpportunityId': 'Opportunity',
        'Order.QuoteId': 'Quote',
        'Order.ShipToContactId': 'Contact',
        'OrderItem.OrderId': 'Order',
        'OrderItem.PricebookEntryId': 'PricebookEntry',
        'OrderItem.Product2Id': 'Product2',
        'OrderItem.QuoteLineItemId': 'QuoteLineItem',
        'PricebookEntry.Product2Id': 'Product2',
        'Quote.AccountId': 'Account',
        'Quote.ContactId': 'Contact',
        'Quote.ContractId': 'Contract',
        'Quote.OpportunityId': 'Opportunity',
        'QuoteLineItem.OpportunityLineItemId': 'OpportunityLineItem',
        'QuoteLineItem.PricebookEntryId': 'PricebookEntry',
        'QuoteLineItem.Product2Id': 'Product2',
        'QuoteLineItem.QuoteId': 'Quote'
    }));

    static resolveParentObjectApiName(objectApiName: string, fieldApiName: string): string | undefined {

        const objectFieldKey = `${objectApiName}.${fieldApiName}`;

        return Object.prototype.hasOwnProperty.call(this.parentObjectApiNameByObjectField, objectFieldKey)
            ? this.parentObjectApiNameByObjectField[objectFieldKey]
            : undefined;

    }

    static listMappedObjectFields(): string[] {

        return Object.keys(this.parentObjectApiNameByObjectField);

    }

}
