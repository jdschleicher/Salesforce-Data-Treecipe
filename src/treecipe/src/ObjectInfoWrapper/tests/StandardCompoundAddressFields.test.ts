import * as fs from 'fs';
import * as path from 'path';
import { IStandardCompoundAddressField, StandardCompoundAddressFields } from '../StandardCompoundAddressFields';
import { SalesforceApiName } from '../../SalesforceApiName/SalesforceApiName';

describe('StandardCompoundAddressFields (#694)', () => {

    const everyAddressField = Object.entries(StandardCompoundAddressFields.addressFieldsByObjectApiName)
        .flatMap(([objectApiName, addressFields]) => addressFields.map(addressField => ({ objectApiName, ...addressField })));

    test('names the standard objects that have a compound address', () => {

        expect(Object.keys(StandardCompoundAddressFields.addressFieldsByObjectApiName)).toEqual([
            'Account', 'Asset', 'Contact', 'Contract', 'Lead', 'Order', 'Quote', 'ServiceAppointment', 'ServiceContract', 'User', 'WorkOrder'
        ]);

    });

    test('every address field is an api name ending in Address, with a label', () => {

        everyAddressField.forEach(addressField => {
            expect(SalesforceApiName.isApiName(addressField.fieldApiName)).toBe(true);
            expect(addressField.fieldApiName).toMatch(/Address$/);
            expect(addressField.fieldLabel).not.toBe('');
        });

    });

    test('only a person account\'s addresses need their own field file', () => {

        expect(everyAddressField.filter(addressField => addressField.isWrittenOnlyWithItsFieldFile).map(addressField => `${addressField.objectApiName}.${addressField.fieldApiName}`))
            .toEqual(['Account.PersonMailingAddress', 'Account.PersonOtherAddress']);

    });

    test('Quote has its four addresses', () => {

        expect(StandardCompoundAddressFields.getAddressFields('Quote').map(addressField => addressField.fieldApiName))
            .toEqual(['BillingAddress', 'ShippingAddress', 'QuoteToAddress', 'AdditionalAddress']);

    });

    test.each(['Widget__c', 'quote', '', 'constructor', '__proto__', 'toString'])('%s has no standard address', (objectApiName) => {

        expect(StandardCompoundAddressFields.getAddressFields(objectApiName)).toEqual([]);
        expect(StandardCompoundAddressFields.findAddressField(objectApiName, 'BillingAddress')).toBeUndefined();

    });

    test('finds a field by object and name, and nothing for a name the object does not have', () => {

        expect(StandardCompoundAddressFields.findAddressField('Order', 'ShippingAddress')).toEqual({ fieldApiName: 'ShippingAddress', fieldLabel: 'Shipping Address', isWrittenOnlyWithItsFieldFile: false });
        expect(StandardCompoundAddressFields.findAddressField('Order', 'QuoteToAddress')).toBeUndefined();
        expect(StandardCompoundAddressFields.findAddressField('Order', undefined as unknown as string)).toBeUndefined();

    });

    test('no caller can change a list or an entry: every one is frozen (#697)', () => {

        const quoteAddressFields = StandardCompoundAddressFields.getAddressFields('Quote') as IStandardCompoundAddressField[];

        expect(Object.isFrozen(StandardCompoundAddressFields.addressFieldsByObjectApiName)).toBe(true);
        expect(() => quoteAddressFields.push({ fieldApiName: 'Evil', fieldLabel: 'Evil', isWrittenOnlyWithItsFieldFile: false })).toThrow(TypeError);
        expect(() => { quoteAddressFields[0].fieldApiName = 'Evil'; }).toThrow(TypeError);
        everyAddressField.forEach(addressField => expect(addressField.fieldApiName).not.toBe('Evil'));
        Object.values(StandardCompoundAddressFields.addressFieldsByObjectApiName).forEach(addressFields => {
            expect(Object.isFrozen(addressFields)).toBe(true);
            addressFields.forEach(addressField => expect(Object.isFrozen(addressField)).toBe(true));
        });

    });

    test('the map has no prototype, so a prototype member name is never an object', () => {

        expect(Object.getPrototypeOf(StandardCompoundAddressFields.addressFieldsByObjectApiName)).toBeNull();

    });

    test('imports nothing, so generation and the SOQL templates can both read it', () => {

        const sourceText = fs.readFileSync(path.join(__dirname, '..', 'StandardCompoundAddressFields.ts'), 'utf8');

        expect(sourceText).not.toMatch(/^\s*import\s/m);

    });

});
