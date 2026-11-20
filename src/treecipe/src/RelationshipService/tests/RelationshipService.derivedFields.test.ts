import { RelationshipService } from '../RelationshipService';

/*
    #680: a field Salesforce sets from another lookup on the same record (StandardDerivedFields) is
    written as the record it comes from and the field copied, whatever generation put on its line.
*/
describe('RelationshipService.writeDerivedFieldValues (#680)', () => {

    const buildQuoteLines = (opportunityIdValue: string, accountIdValue: string) => [
        '- object: Quote',
        '  nickname: Quote_NickName',
        '  count: 1',
        '  fields:',
        `    AccountId: ${accountIdValue}`,
        `    OpportunityId: ${opportunityIdValue}`,
        '    Name: ${{ faker.company.name() }}'
    ];

    const noNicknames = new Map<string, string>();

    test.each([
        ['a faker-js nickname', 'Opportunity_Gold_NickName', 'Opportunity_Gold_NickName.AccountId'],
        ['a snowfakery child copy\'s reference()', 'Opportunity_Reference_${{reference(Opportunity_Copy_NickName).id}}', 'Opportunity_Copy_NickName.AccountId']
    ])('names the record the through lookup holds: %s', (unusedCase, opportunityIdValue, expectedAccountIdValue) => {

        const writtenLines = RelationshipService.writeDerivedFieldValues('Quote', buildQuoteLines(opportunityIdValue, 'Account_NickName'), noNicknames);

        expect(writtenLines[4]).toBe(`    AccountId: ${expectedAccountIdValue}`);

    });

    test('with the through lookup still a TODO, names the Opportunity\'s first block in the tree', () => {

        const writtenLines = RelationshipService.writeDerivedFieldValues('Quote',
            buildQuoteLines(RelationshipService.referenceIdRequiredTodo, `${RelationshipService.referenceIdRequiredTodo} -- Account`),
            new Map([['Opportunity', 'Opportunity_Enterprise_NickName']]));

        expect(writtenLines[4]).toBe('    AccountId: Opportunity_Enterprise_NickName.AccountId');

    });

    test('with no Opportunity in the tree, names the default Opportunity nickname', () => {

        const writtenLines = RelationshipService.writeDerivedFieldValues('Quote', buildQuoteLines(RelationshipService.referenceIdRequiredTodo, RelationshipService.referenceIdRequiredTodo), noNicknames);

        expect(writtenLines[4]).toBe('    AccountId: Opportunity_NickName.AccountId');

    });

    test('changes only the derived field\'s line', () => {

        const quoteLines = buildQuoteLines('Opportunity_NickName', 'Account_NickName');
        const writtenLines = RelationshipService.writeDerivedFieldValues('Quote', quoteLines, noNicknames);

        expect(writtenLines.filter((writtenLine, lineIndex) => writtenLine !== quoteLines[lineIndex])).toEqual(['    AccountId: Opportunity_NickName.AccountId']);

    });

    test('leaves an object with no derived field exactly as it was', () => {

        const opportunityLines = ['- object: Opportunity', '  nickname: Opportunity_NickName', '  fields:', '    AccountId: Account_NickName'];

        expect(RelationshipService.writeDerivedFieldValues('Opportunity', opportunityLines, noNicknames)).toBe(opportunityLines);

    });

    test('a Quote without an AccountId line is left as it was', () => {

        const quoteLines = buildQuoteLines('Opportunity_NickName', 'unused').filter(quoteLine => !quoteLine.startsWith('    AccountId:'));

        expect(RelationshipService.writeDerivedFieldValues('Quote', quoteLines, noNicknames)).toEqual(quoteLines);

    });

});
