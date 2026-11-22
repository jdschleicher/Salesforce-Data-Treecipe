/*
    The standard compound Address fields each standard object has (#694). A retrieve writes their
    field files with no <type>, so the object and field name are the only signal; and a project often
    has no file for them at all, so generation writes their parts whenever the object is in the
    project. A person account's addresses are written only when the Account folder has that field's
    file: on a business account, or in an org without person accounts, the insert refuses them.
    Imports nothing.
*/
export interface IStandardCompoundAddressField {
    fieldApiName: string;
    fieldLabel: string;
    isWrittenOnlyWithItsFieldFile: boolean;
}

export class StandardCompoundAddressFields {

    private static writtenWithoutItsFieldFile(fieldApiName: string, fieldLabel: string): IStandardCompoundAddressField {
        return Object.freeze({ fieldApiName, fieldLabel, isWrittenOnlyWithItsFieldFile: false });
    }

    private static writtenOnlyWithItsFieldFile(fieldApiName: string, fieldLabel: string): IStandardCompoundAddressField {
        return Object.freeze({ fieldApiName, fieldLabel, isWrittenOnlyWithItsFieldFile: true });
    }

    // A PROTOTYPE-LESS MAP WITH EVERY LIST AND ENTRY FROZEN, SO NO CALLER CAN CHANGE WHAT GENERATION READS
    private static freezeEveryList(addressFieldsByObjectApiName: Record<string, IStandardCompoundAddressField[]>): Readonly<Record<string, readonly IStandardCompoundAddressField[]>> {

        const frozenAddressFieldsByObjectApiName: Record<string, readonly IStandardCompoundAddressField[]> = Object.create(null);
        Object.entries(addressFieldsByObjectApiName).forEach(([objectApiName, addressFields]) => {
            frozenAddressFieldsByObjectApiName[objectApiName] = Object.freeze([...addressFields]);
        });
        return Object.freeze(frozenAddressFieldsByObjectApiName);

    }

    static readonly addressFieldsByObjectApiName: Readonly<Record<string, readonly IStandardCompoundAddressField[]>> = StandardCompoundAddressFields.freezeEveryList({
        Account: [
            StandardCompoundAddressFields.writtenWithoutItsFieldFile('BillingAddress', 'Billing Address'),
            StandardCompoundAddressFields.writtenWithoutItsFieldFile('ShippingAddress', 'Shipping Address'),
            StandardCompoundAddressFields.writtenOnlyWithItsFieldFile('PersonMailingAddress', 'Mailing Address'),
            StandardCompoundAddressFields.writtenOnlyWithItsFieldFile('PersonOtherAddress', 'Other Address')
        ],
        Asset: [ StandardCompoundAddressFields.writtenWithoutItsFieldFile('Address', 'Address') ],
        Contact: [
            StandardCompoundAddressFields.writtenWithoutItsFieldFile('MailingAddress', 'Mailing Address'),
            StandardCompoundAddressFields.writtenWithoutItsFieldFile('OtherAddress', 'Other Address')
        ],
        Contract: [
            StandardCompoundAddressFields.writtenWithoutItsFieldFile('BillingAddress', 'Billing Address'),
            StandardCompoundAddressFields.writtenWithoutItsFieldFile('ShippingAddress', 'Shipping Address')
        ],
        Lead: [ StandardCompoundAddressFields.writtenWithoutItsFieldFile('Address', 'Address') ],
        Order: [
            StandardCompoundAddressFields.writtenWithoutItsFieldFile('BillingAddress', 'Billing Address'),
            StandardCompoundAddressFields.writtenWithoutItsFieldFile('ShippingAddress', 'Shipping Address')
        ],
        Quote: [
            StandardCompoundAddressFields.writtenWithoutItsFieldFile('BillingAddress', 'Bill To'),
            StandardCompoundAddressFields.writtenWithoutItsFieldFile('ShippingAddress', 'Ship To'),
            StandardCompoundAddressFields.writtenWithoutItsFieldFile('QuoteToAddress', 'Quote To'),
            StandardCompoundAddressFields.writtenWithoutItsFieldFile('AdditionalAddress', 'Additional To')
        ],
        ServiceAppointment: [ StandardCompoundAddressFields.writtenWithoutItsFieldFile('Address', 'Address') ],
        ServiceContract: [
            StandardCompoundAddressFields.writtenWithoutItsFieldFile('BillingAddress', 'Billing Address'),
            StandardCompoundAddressFields.writtenWithoutItsFieldFile('ShippingAddress', 'Shipping Address')
        ],
        User: [ StandardCompoundAddressFields.writtenWithoutItsFieldFile('Address', 'Address') ],
        WorkOrder: [ StandardCompoundAddressFields.writtenWithoutItsFieldFile('Address', 'Address') ]
    });

    static getAddressFields(objectApiName: string): readonly IStandardCompoundAddressField[] {

        return Object.prototype.hasOwnProperty.call(StandardCompoundAddressFields.addressFieldsByObjectApiName, objectApiName)
            ? StandardCompoundAddressFields.addressFieldsByObjectApiName[objectApiName]
            : [];

    }

    static findAddressField(objectApiName: string, fieldApiName: string): IStandardCompoundAddressField | undefined {

        return StandardCompoundAddressFields.getAddressFields(objectApiName).find(addressField => addressField.fieldApiName === fieldApiName);

    }

}
