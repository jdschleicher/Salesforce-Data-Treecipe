import * as fs from 'fs';
import * as path from 'path';
import { StandardDerivedFields } from '../StandardDerivedFields';
import { StandardFieldParentReferenceMap } from '../../RelationshipService/StandardFieldParentReferenceMap';
import { SalesforceApiName } from '../../SalesforceApiName/SalesforceApiName';

describe('StandardDerivedFields (#680)', () => {

    test('holds exactly the confirmed set, so a new entry is a decision made in a test', () => {

        expect(StandardDerivedFields.listDerivedObjectFields()).toEqual(['Quote.AccountId']);

    });

    test('Quote.AccountId is the AccountId of the quote\'s Opportunity, through OpportunityId', () => {

        expect(StandardDerivedFields.resolveDerivedField('Quote', 'AccountId')).toEqual({
            throughFieldApiName: 'OpportunityId',
            sourceObjectApiName: 'Opportunity',
            sourceFieldApiName: 'AccountId'
        });
        expect(StandardDerivedFields.listDerivedFieldApiNames('Quote')).toEqual(['AccountId']);

    });

    test('every through field is a standard lookup the parent map wires to the source object, so the source is in the tree', () => {

        StandardDerivedFields.listDerivedObjectFields().forEach(objectField => {
            const [objectApiName, fieldApiName] = objectField.split('.');
            const derivedField = StandardDerivedFields.resolveDerivedField(objectApiName, fieldApiName);
            expect(StandardFieldParentReferenceMap.resolveParentObjectApiName(objectApiName, derivedField.throughFieldApiName)).toBe(derivedField.sourceObjectApiName);
            [objectApiName, fieldApiName, derivedField.throughFieldApiName, derivedField.sourceObjectApiName, derivedField.sourceFieldApiName]
                .forEach(apiName => expect(SalesforceApiName.isApiName(apiName)).toBe(true));
        });

    });

    test.each([
        ['Opportunity', 'AccountId'],
        ['Order', 'AccountId'],
        ['Quote', 'ContactId'],
        ['quote', 'AccountId'],
        ['Quote', 'accountid']
    ])('answers nothing for %s.%s, which it does not name', (objectApiName, fieldApiName) => {

        expect(StandardDerivedFields.resolveDerivedField(objectApiName, fieldApiName)).toBeUndefined();

    });

    test.each([
        ['constructor', ''],
        ['__proto__', ''],
        ['Quote', 'toString'],
        ['hasOwnProperty', 'x']
    ])('answers nothing for a prototype-named key %s.%s', (objectApiName, fieldApiName) => {

        expect(StandardDerivedFields.resolveDerivedField(objectApiName, fieldApiName)).toBeUndefined();

    });

    test.each(['constructor', '__proto__', 'hasOwnProperty', 'Opportunity'])('lists no derived field for %s', objectApiName => {

        expect(StandardDerivedFields.listDerivedFieldApiNames(objectApiName)).toEqual([]);

    });

    test('the recipe value names the source nickname and field, and reads back to the same nickname', () => {

        const derivedField = StandardDerivedFields.resolveDerivedField('Quote', 'AccountId');

        expect(StandardDerivedFields.formatRecipeValue('Opportunity_NickName', derivedField)).toBe('Opportunity_NickName.AccountId');
        expect(StandardDerivedFields.readSourceNickname('Opportunity_NickName.AccountId', derivedField)).toBe('Opportunity_NickName');
        expect(StandardDerivedFields.readSourceNickname('Opportunity_Account_Partner_NickName.AccountId', derivedField)).toBe('Opportunity_Account_Partner_NickName');

    });

    test.each([
        ['a bare nickname', 'Account_NickName'],
        ['the REFERENCE ID TODO', '### TODO -- REFERENCE ID REQUIRED'],
        ['another field of the source', 'Opportunity_NickName.ContactId'],
        ['no nickname before the field', '.AccountId'],
        ['a nickname that is not a word', 'Opportunity NickName.AccountId'],
        ['a faker expression', '${{ faker.string.uuid() }}.AccountId'],
        ['a number', 5],
        ['nothing', null]
    ])('reads no source nickname from %s', (unusedCase, recipeValue) => {

        expect(StandardDerivedFields.readSourceNickname(recipeValue, StandardDerivedFields.resolveDerivedField('Quote', 'AccountId'))).toBeUndefined();

    });

    describe('the record a through lookup names (#704)', () => {

        test.each([
            ['a bare nickname', 'Opportunity_SMB_NickName', 'Opportunity_SMB_NickName'],
            ['a snowfakery child copy\'s reference()', 'Opportunity_Reference_${{reference(Opportunity_SMB_NickName).id}}', 'Opportunity_SMB_NickName'],
            ['a nickname with spaces around it', '  Opportunity_NickName  ', 'Opportunity_NickName'],
            ['a nickname with the record type blocks comment under it', 'Opportunity_SMB_NickName\n### TODO -- RECORD TYPE BLOCKS -- note', 'Opportunity_SMB_NickName']
        ])('reads the source nickname from %s', (unusedCase, throughValue, expectedSourceNickname) => {

            expect(StandardDerivedFields.readThroughSourceNickname(throughValue)).toBe(expectedSourceNickname);

        });

        test.each([
            ['the REFERENCE ID TODO', '### TODO -- REFERENCE ID REQUIRED'],
            ['a faker expression', '${{ faker.string.uuid() }}'],
            ['an org record Id', '"0065g00000AbCdEAAV"'],
            ['a nickname written on the second line only', '\nOpportunity_NickName'],
            ['a dotted value', 'Opportunity_NickName.AccountId'],
            ['empty', ''],
            ['a number', 5],
            ['nothing', null]
        ])('reads no source nickname from %s', (unusedCase, throughValue) => {

            expect(StandardDerivedFields.readThroughSourceNickname(throughValue)).toBeUndefined();

        });

    });

    test('imports nothing, so the panel bundle can read it', () => {

        const source = fs.readFileSync(path.join(__dirname, '..', 'StandardDerivedFields.ts'), 'utf-8');

        expect(source).not.toMatch(/^\s*import\b/m);
        expect(source).not.toMatch(/\brequire\(/);

    });

});
