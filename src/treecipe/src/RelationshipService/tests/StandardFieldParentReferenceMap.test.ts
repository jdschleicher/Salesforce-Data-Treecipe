import * as fs from 'fs';
import * as path from 'path';
import { StandardFieldParentReferenceMap } from '../StandardFieldParentReferenceMap';
import { SalesforceApiName } from '../../SalesforceApiName/SalesforceApiName';

describe('StandardFieldParentReferenceMap (#400, #680)', () => {

    test.each([
        ['Account', 'ParentId', 'Account'],
        ['Asset', 'AccountId', 'Account'],
        ['Asset', 'AssetProvidedById', 'Account'],
        ['Asset', 'AssetServicedById', 'Account'],
        ['Asset', 'ContactId', 'Contact'],
        ['Asset', 'ParentId', 'Asset'],
        ['Asset', 'Product2Id', 'Product2'],
        ['Campaign', 'ParentId', 'Campaign'],
        ['CampaignMember', 'CampaignId', 'Campaign'],
        ['CampaignMember', 'ContactId', 'Contact'],
        ['CampaignMember', 'LeadId', 'Lead'],
        ['Case', 'AccountId', 'Account'],
        ['Case', 'AssetId', 'Asset'],
        ['Case', 'ContactId', 'Contact'],
        ['Case', 'ParentId', 'Case'],
        ['Contact', 'AccountId', 'Account'],
        ['Contact', 'ReportsToId', 'Contact'],
        ['Contract', 'AccountId', 'Account'],
        ['Contract', 'CustomerSignedId', 'Contact'],
        ['Opportunity', 'AccountId', 'Account'],
        ['Opportunity', 'CampaignId', 'Campaign'],
        ['Opportunity', 'ContractId', 'Contract'],
        ['OpportunityContactRole', 'ContactId', 'Contact'],
        ['OpportunityContactRole', 'OpportunityId', 'Opportunity'],
        ['OpportunityLineItem', 'OpportunityId', 'Opportunity'],
        ['OpportunityLineItem', 'PricebookEntryId', 'PricebookEntry'],
        ['OpportunityLineItem', 'Product2Id', 'Product2'],
        ['Order', 'AccountId', 'Account'],
        ['Order', 'BillToContactId', 'Contact'],
        ['Order', 'ContractId', 'Contract'],
        ['Order', 'CustomerAuthorizedById', 'Contact'],
        ['Order', 'OpportunityId', 'Opportunity'],
        ['Order', 'QuoteId', 'Quote'],
        ['Order', 'ShipToContactId', 'Contact'],
        ['OrderItem', 'OrderId', 'Order'],
        ['OrderItem', 'PricebookEntryId', 'PricebookEntry'],
        ['OrderItem', 'Product2Id', 'Product2'],
        ['OrderItem', 'QuoteLineItemId', 'QuoteLineItem'],
        ['PricebookEntry', 'Product2Id', 'Product2'],
        ['Quote', 'AccountId', 'Account'],
        ['Quote', 'ContactId', 'Contact'],
        ['Quote', 'ContractId', 'Contract'],
        ['Quote', 'OpportunityId', 'Opportunity'],
        ['QuoteLineItem', 'OpportunityLineItemId', 'OpportunityLineItem'],
        ['QuoteLineItem', 'PricebookEntryId', 'PricebookEntry'],
        ['QuoteLineItem', 'Product2Id', 'Product2'],
        ['QuoteLineItem', 'QuoteId', 'Quote']
    ])('maps %s.%s to %s', (objectApiName, fieldApiName, expectedParentObjectApiName) => {

        expect(StandardFieldParentReferenceMap.resolveParentObjectApiName(objectApiName, fieldApiName)).toBe(expectedParentObjectApiName);

    });

    test('holds exactly the confirmed set, so a new entry is a decision made in a test', () => {

        expect(StandardFieldParentReferenceMap.listMappedObjectFields().sort()).toEqual([
            'Account.ParentId',
            'Asset.AccountId',
            'Asset.AssetProvidedById',
            'Asset.AssetServicedById',
            'Asset.ContactId',
            'Asset.ParentId',
            'Asset.Product2Id',
            'Campaign.ParentId',
            'CampaignMember.CampaignId',
            'CampaignMember.ContactId',
            'CampaignMember.LeadId',
            'Case.AccountId',
            'Case.AssetId',
            'Case.ContactId',
            'Case.ParentId',
            'Contact.AccountId',
            'Contact.ReportsToId',
            'Contract.AccountId',
            'Contract.CustomerSignedId',
            'Opportunity.AccountId',
            'Opportunity.CampaignId',
            'Opportunity.ContractId',
            'OpportunityContactRole.ContactId',
            'OpportunityContactRole.OpportunityId',
            'OpportunityLineItem.OpportunityId',
            'OpportunityLineItem.PricebookEntryId',
            'OpportunityLineItem.Product2Id',
            'Order.AccountId',
            'Order.BillToContactId',
            'Order.ContractId',
            'Order.CustomerAuthorizedById',
            'Order.OpportunityId',
            'Order.QuoteId',
            'Order.ShipToContactId',
            'OrderItem.OrderId',
            'OrderItem.PricebookEntryId',
            'OrderItem.Product2Id',
            'OrderItem.QuoteLineItemId',
            'PricebookEntry.Product2Id',
            'Quote.AccountId',
            'Quote.ContactId',
            'Quote.ContractId',
            'Quote.OpportunityId',
            'QuoteLineItem.OpportunityLineItemId',
            'QuoteLineItem.PricebookEntryId',
            'QuoteLineItem.Product2Id',
            'QuoteLineItem.QuoteId'
        ]);

    });

    test('every key and every parent is a Salesforce api name', () => {

        StandardFieldParentReferenceMap.listMappedObjectFields().forEach(objectField => {
            const [objectApiName, fieldApiName] = objectField.split('.');
            expect(SalesforceApiName.isApiName(objectApiName)).toBe(true);
            expect(SalesforceApiName.isApiName(fieldApiName)).toBe(true);
            expect(SalesforceApiName.isApiName(StandardFieldParentReferenceMap.resolveParentObjectApiName(objectApiName, fieldApiName))).toBe(true);
        });

    });

    test.each([
        ['User', 'ManagerId'],
        ['Lead', 'ParentId'],
        ['account', 'ParentId'],
        ['Account', 'parentid'],
        ['Task', 'WhoId'],
        ['Task', 'WhatId'],
        ['Account', 'OwnerId'],
        ['Quote', 'Pricebook2Id'],
        ['Opportunity', 'Pricebook2Id'],
        ['Order', 'Pricebook2Id'],
        ['PricebookEntry', 'Pricebook2Id'],
        ['Contract', 'CompanySignedId'],
        ['Order', 'CompanyAuthorizedById'],
        ['Order', 'OriginalOrderId'],
        ['OrderItem', 'OriginalOrderItemId']
    ])('answers nothing for %s.%s, which it does not name', (objectApiName, fieldApiName) => {

        expect(StandardFieldParentReferenceMap.resolveParentObjectApiName(objectApiName, fieldApiName)).toBeUndefined();

    });

    test.each([
        ['constructor', ''],
        ['__proto__', ''],
        ['Account', 'toString'],
        ['hasOwnProperty', 'x']
    ])('answers nothing for a prototype-named key %s.%s', (objectApiName, fieldApiName) => {

        expect(StandardFieldParentReferenceMap.resolveParentObjectApiName(objectApiName, fieldApiName)).toBeUndefined();

    });

    test('imports nothing', () => {

        const source = fs.readFileSync(path.join(__dirname, '..', 'StandardFieldParentReferenceMap.ts'), 'utf-8');

        expect(source).not.toMatch(/^\s*import\b/m);
        expect(source).not.toMatch(/\brequire\(/);

    });

});
