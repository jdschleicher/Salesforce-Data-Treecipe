/*
    The parent of a well-known STANDARD lookup or hierarchy field, keyed "<Object>.<Field>" (#400).

    Source format writes no <referenceTo> for these: Account.ParentId is "<type>Hierarchy</type>"
    and nothing else, Contact.ReportsToId a bare Lookup. Salesforce fixes their parent, so it is
    known without an org. DirectoryProcessor reads this map ONLY when a field file carries no
    <referenceTo> and no custom relationship mapping names the field; the name it answers still
    goes through SalesforceApiName and ObjectInfoWrapper.addKeyToObjectInfoMap like any <referenceTo>.

    Polymorphic fields (WhoId, WhatId, OwnerId) are deliberately absent: one parent cannot be named.
    Imports nothing, so any service can read it.
*/
export class StandardFieldParentReferenceMap {

    // NULL PROTOTYPED AND OWN-KEY CHECKED: A FIELD NAMED LIKE AN Object.prototype MEMBER MUST NOT RESOLVE TO IT
    private static readonly parentObjectApiNameByObjectField: Readonly<Record<string, string>> = Object.freeze(Object.assign(Object.create(null), {
        'Account.ParentId': 'Account',
        'Campaign.ParentId': 'Campaign',
        'Case.AccountId': 'Account',
        'Case.ContactId': 'Contact',
        'Case.ParentId': 'Case',
        'Contact.AccountId': 'Account',
        'Contact.ReportsToId': 'Contact',
        'Opportunity.AccountId': 'Account'
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
