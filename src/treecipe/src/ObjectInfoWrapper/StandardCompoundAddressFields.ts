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

const writtenWithoutItsFieldFile = (fieldApiName: string, fieldLabel: string): IStandardCompoundAddressField =>
    ({ fieldApiName, fieldLabel, isWrittenOnlyWithItsFieldFile: false });

const writtenOnlyWithItsFieldFile = (fieldApiName: string, fieldLabel: string): IStandardCompoundAddressField =>
    ({ fieldApiName, fieldLabel, isWrittenOnlyWithItsFieldFile: true });

export class StandardCompoundAddressFields {

    static readonly addressFieldsByObjectApiName: Readonly<Record<string, readonly IStandardCompoundAddressField[]>> = Object.freeze(Object.assign(Object.create(null), {
        Account: [
            writtenWithoutItsFieldFile('BillingAddress', 'Billing Address'),
            writtenWithoutItsFieldFile('ShippingAddress', 'Shipping Address'),
            writtenOnlyWithItsFieldFile('PersonMailingAddress', 'Mailing Address'),
            writtenOnlyWithItsFieldFile('PersonOtherAddress', 'Other Address')
        ],
        Asset: [ writtenWithoutItsFieldFile('Address', 'Address') ],
        Contact: [
            writtenWithoutItsFieldFile('MailingAddress', 'Mailing Address'),
            writtenWithoutItsFieldFile('OtherAddress', 'Other Address')
        ],
        Contract: [
            writtenWithoutItsFieldFile('BillingAddress', 'Billing Address'),
            writtenWithoutItsFieldFile('ShippingAddress', 'Shipping Address')
        ],
        Lead: [ writtenWithoutItsFieldFile('Address', 'Address') ],
        Order: [
            writtenWithoutItsFieldFile('BillingAddress', 'Billing Address'),
            writtenWithoutItsFieldFile('ShippingAddress', 'Shipping Address')
        ],
        Quote: [
            writtenWithoutItsFieldFile('BillingAddress', 'Bill To'),
            writtenWithoutItsFieldFile('ShippingAddress', 'Ship To'),
            writtenWithoutItsFieldFile('QuoteToAddress', 'Quote To'),
            writtenWithoutItsFieldFile('AdditionalAddress', 'Additional To')
        ],
        ServiceAppointment: [ writtenWithoutItsFieldFile('Address', 'Address') ],
        ServiceContract: [
            writtenWithoutItsFieldFile('BillingAddress', 'Billing Address'),
            writtenWithoutItsFieldFile('ShippingAddress', 'Shipping Address')
        ],
        User: [ writtenWithoutItsFieldFile('Address', 'Address') ],
        WorkOrder: [ writtenWithoutItsFieldFile('Address', 'Address') ]
    }));

    static getAddressFields(objectApiName: string): readonly IStandardCompoundAddressField[] {

        return Object.prototype.hasOwnProperty.call(StandardCompoundAddressFields.addressFieldsByObjectApiName, objectApiName)
            ? StandardCompoundAddressFields.addressFieldsByObjectApiName[objectApiName]
            : [];

    }

    static findAddressField(objectApiName: string, fieldApiName: string): IStandardCompoundAddressField | undefined {

        return StandardCompoundAddressFields.getAddressFields(objectApiName).find(addressField => addressField.fieldApiName === fieldApiName);

    }

}
