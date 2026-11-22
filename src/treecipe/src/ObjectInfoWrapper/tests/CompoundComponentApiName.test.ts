import * as fs from 'fs';
import * as path from 'path';
import { CompoundComponentApiName } from '../CompoundComponentApiName';

describe('CompoundComponentApiName (#697)', () => {

    test.each([
        ['BillingAddress', 'Street', 'BillingStreet'],
        ['PersonMailingAddress', 'Street', 'PersonMailingStreet'],
        ['Address', 'City', 'City'],
        ['Site__c', 'PostalCode', 'Site__PostalCode__s'],
        ['Site_Location__c', 'Latitude', 'Site_Location__Latitude__s'],
        ['BillingAddress', 'Latitude', 'BillingLatitude'],
        ['Location', 'Latitude', 'LocationLatitude']
    ])('%s with %s is %s', (compoundFieldApiName, componentKey, expectedComponentApiName) => {

        expect(CompoundComponentApiName.build(compoundFieldApiName, componentKey)).toBe(expectedComponentApiName);

    });

    test('imports nothing, so SOQLTemplateService reads the rule without loading RecipeService', () => {

        const sourceText = fs.readFileSync(path.join(__dirname, '..', 'CompoundComponentApiName.ts'), 'utf8');

        expect(sourceText).not.toMatch(/^\s*import\s/m);

    });

});
