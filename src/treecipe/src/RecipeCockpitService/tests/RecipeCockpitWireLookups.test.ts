import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

jest.mock('vscode', () => ({}), { virtual: true });

import { RecipeCockpitRecipeWriter, ILookupWiringContext, IRecipeFilterLookup, RecipeLookupWiringResult } from '../RecipeCockpitRecipeWriter';
import { RelationshipService } from '../../RelationshipService/RelationshipService';

const TODO = '### TODO -- REFERENCE ID REQUIRED';

const FLAT_RECIPE = [
    '- object: Account',
    '  nickname: Account_NickName',
    '  count: 1',
    '  fields:',
    '    Name: ${{ faker.company.name() }}',
    `    ParentId: ${TODO}`,
    `    OwnerId: ${TODO}`,
    '',
    '- object: Contact',
    '  nickname: Contact_NickName',
    '  count: 2',
    '  fields:',
    '    LastName: ${{ faker.person.lastName() }}',
    `    AccountId: ${TODO}`,
    `    ReportsToId: ${TODO}`,
    `    Peer__c: ${TODO} -- Opportunity`,
    '',
    '- object: Opportunity',
    '  nickname: Opportunity_NickName',
    '  count: 1',
    '  fields:',
    `    AccountId: ${TODO}`,
    `    Contact__c: ${TODO}`,
    '    Name: Already_Filled',
    ''
].join('\n');

function buildContext(lookups: Record<string, IRecipeFilterLookup[]>, levels?: Record<string, number>): ILookupWiringContext {
    return {
        parentLookupsByObjectApiName: new Map(Object.entries(lookups)),
        ...( levels ? { levelsByObjectApiName: new Map(Object.entries(levels)) } : {} )
    };
}

const FLAT_CONTEXT = buildContext({
    Account: [{ fieldApiName: 'ParentId', parentObjectApiName: 'Account' }],
    Contact: [
        { fieldApiName: 'AccountId', parentObjectApiName: 'Account' },
        { fieldApiName: 'ReportsToId', parentObjectApiName: 'Contact' },
        { fieldApiName: 'Peer__c', parentObjectApiName: 'Opportunity' }
    ],
    Opportunity: [
        { fieldApiName: 'AccountId', parentObjectApiName: 'Account' },
        { fieldApiName: 'Contact__c', parentObjectApiName: 'Contact' }
    ]
}, { Account: 0, Contact: 1, Opportunity: 1 });

function expectApplied(result: RecipeLookupWiringResult): Extract<RecipeLookupWiringResult, { isApplied: true }> {
    if ( 'refusal' in result ) {
        throw new Error(`expected the wiring to apply: ${result.refusal.message}`);
    }
    return result;
}

function expectRefused(result: RecipeLookupWiringResult) {
    if ( !( 'refusal' in result ) ) {
        throw new Error('expected the wiring to be refused');
    }
    return result.refusal;
}

describe('RecipeCockpitRecipeWriter lookup wiring (#151)', () => {

    describe('listLookupWirings', () => {

        test('lists only TODO lookups to a parent inserted first, each with its nicknames', () => {

            expect(RecipeCockpitRecipeWriter.listLookupWirings(FLAT_RECIPE, FLAT_CONTEXT)).toEqual([
                { objectApiName: 'Contact', fieldApiName: 'AccountId', parentObjectApiNames: ['Account'], candidateNicknames: ['Account_NickName'] },
                { objectApiName: 'Opportunity', fieldApiName: 'AccountId', parentObjectApiNames: ['Account'], candidateNicknames: ['Account_NickName'] }
            ]);

        });

        test('a self-lookup, a same-level parent, an outside parent and a filled lookup stay unwired', () => {

            const wiredFieldKeys = RecipeCockpitRecipeWriter.listLookupWirings(FLAT_RECIPE, FLAT_CONTEXT)
                .map(wiring => `${wiring.objectApiName}.${wiring.fieldApiName}`);

            // ParentId and ReportsToId NAME THEIR OWN OBJECT, Peer__c AND Contact__c A PARENT AT THE SAME LEVEL, OwnerId A PARENT WITH NO LOOKUP ENTRY
            expect(wiredFieldKeys).not.toIncludeAnyMembers(['Account.ParentId', 'Contact.ReportsToId', 'Contact.Peer__c', 'Opportunity.Contact__c', 'Account.OwnerId']);

        });

        test('a TODO naming its parent, as a nested tree writes it, is listed', () => {

            const recipeText = FLAT_RECIPE.replace(`    AccountId: ${TODO}\n    ReportsToId`, `    AccountId: ${TODO} -- Account\n    ReportsToId`);

            expect(RecipeCockpitRecipeWriter.listLookupWirings(recipeText, FLAT_CONTEXT).map(wiring => wiring.objectApiName)).toEqual(['Contact', 'Opportunity']);

        });

        test('the TODO it recognizes is the one RelationshipService and both faker services write', () => {

            expect(RelationshipService.referenceIdRequiredTodo).toBe(TODO);
            expect(RecipeCockpitRecipeWriter.listLookupWirings(FLAT_RECIPE.replace(`AccountId: ${TODO}\n    ReportsToId`, `AccountId: ${TODO}X\n    ReportsToId`), FLAT_CONTEXT)
                .map(wiring => wiring.objectApiName)).toEqual(['Opportunity']);

        });

        test('without levels only an ancestor qualifies', () => {

            expect(RecipeCockpitRecipeWriter.listLookupWirings(FLAT_RECIPE, buildContext({
                Contact: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]
            }))).toEqual([]);

        });

        test('a nickname two occurrences share is not offered', () => {

            const recipeText = FLAT_RECIPE.replace('  nickname: Opportunity_NickName', '  nickname: Account_NickName');

            expect(RecipeCockpitRecipeWriter.listLookupWirings(recipeText, FLAT_CONTEXT)).toEqual([]);

        });

        test('a lookup with continuation lines is not offered', () => {

            const recipeText = FLAT_RECIPE.replace(`    AccountId: ${TODO}\n    ReportsToId`, `    AccountId: ${TODO}\n      # kept by hand\n    ReportsToId`);

            expect(RecipeCockpitRecipeWriter.listLookupWirings(recipeText, FLAT_CONTEXT).map(wiring => wiring.objectApiName)).toEqual(['Opportunity']);

        });

        test('a polymorphic lookup lists every parent it can name, ancestors first', () => {

            const recipeText = [
                '- object: Account',
                '  nickname: Account_NickName',
                '  fields:',
                '    Name: Acme',
                '  friends:',
                '    - object: Contact',
                '      nickname: Contact_NickName',
                '      fields:',
                `        WhatId__c: ${TODO}`,
                '',
                '- object: Lead',
                '  nickname: Lead_NickName',
                '  fields:',
                '    LastName: Lee',
                ''
            ].join('\n');

            expect(RecipeCockpitRecipeWriter.listLookupWirings(recipeText, buildContext({
                Contact: [
                    { fieldApiName: 'WhatId__c', parentObjectApiName: 'Lead' },
                    { fieldApiName: 'WhatId__c', parentObjectApiName: 'Account' }
                ]
            }, { Account: 0, Lead: 0, Contact: 1 }))).toEqual([{
                objectApiName: 'Contact',
                fieldApiName: 'WhatId__c',
                parentObjectApiNames: ['Lead', 'Account'],
                candidateNicknames: ['Account_NickName', 'Lead_NickName']
            }]);

        });

    });

    describe('nested friends and self-lookup iterations', () => {

        const NESTED_RECIPE = [
            '- object: Account',
            '  nickname: Account_NickName',
            '  fields:',
            `    ParentId: ${TODO} -- Account`,
            '  friends:',
            '    - object: Contact',
            '      nickname: Contact_NickName',
            '      fields:',
            `        AccountId: ${TODO}`,
            '    - object: Account',
            '      nickname: Account_child_NickName',
            '      fields:',
            `        ParentId: ${TODO}`,
            ''
        ].join('\n');

        const NESTED_CONTEXT = buildContext({
            Account: [{ fieldApiName: 'ParentId', parentObjectApiName: 'Account' }],
            Contact: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]
        }, { Account: 0, Contact: 1 });

        test('an ancestor is offered at any depth, and an object written twice is named by its nickname', () => {

            expect(RecipeCockpitRecipeWriter.listLookupWirings(NESTED_RECIPE, NESTED_CONTEXT)).toEqual([
                // THE CHILD ITERATION'S OWN NICKNAME IS NEVER ITS CANDIDATE; THE CONTACT SEES BOTH ACCOUNTS AS LOWER-LEVEL, ITS ANCESTOR FIRST
                { objectApiName: 'Contact', fieldApiName: 'AccountId', parentObjectApiNames: ['Account'], candidateNicknames: ['Account_NickName', 'Account_child_NickName'] },
                { objectApiName: 'Account', objectNickname: 'Account_child_NickName', fieldApiName: 'ParentId', parentObjectApiNames: ['Account'], candidateNicknames: ['Account_NickName'] }
            ]);

        });

        test('wiring a friend writes at its own depth', () => {

            const result = expectApplied(RecipeCockpitRecipeWriter.wireLookups(NESTED_RECIPE, [
                { objectApiName: 'Account', objectNickname: 'Account_child_NickName', fieldApiName: 'ParentId', parentNickname: 'Account_NickName' },
                { objectApiName: 'Contact', fieldApiName: 'AccountId', parentNickname: 'Account_NickName' }
            ], NESTED_CONTEXT));

            expect(result.recipeText).toBe(NESTED_RECIPE
                .replace(`        ParentId: ${TODO}`, '        ParentId: Account_NickName')
                .replace(`        AccountId: ${TODO}`, '        AccountId: Account_NickName'));
            expect(result.edits.map(edit => edit.startLineNumber)).toEqual([13, 9]);

        });

    });

    describe('wireLookups', () => {

        test('replaces each TODO line with the nickname and leaves every other line as it was', () => {

            const result = expectApplied(RecipeCockpitRecipeWriter.wireLookups(FLAT_RECIPE, [
                { objectApiName: 'Opportunity', fieldApiName: 'AccountId', parentNickname: 'Account_NickName' },
                { objectApiName: 'Contact', fieldApiName: 'AccountId', parentNickname: 'Account_NickName' }
            ], FLAT_CONTEXT));

            const before = FLAT_RECIPE.split('\n');
            const after = result.recipeText.split('\n');

            expect(after).toHaveLength(before.length);
            after.forEach((line, lineIndex) => {
                if ( lineIndex === 13 || lineIndex === 21 ) {
                    expect(line).toBe('    AccountId: Account_NickName');
                } else {
                    expect(line).toBe(before[lineIndex]);
                }
            });

            expect(result.edits).toEqual([
                {
                    operation: 'wire-lookup', objectApiName: 'Opportunity', fieldApiName: 'AccountId', parentNickname: 'Account_NickName',
                    startLineNumber: 22, removedLines: [`    AccountId: ${TODO}`], insertedLines: ['    AccountId: Account_NickName']
                },
                {
                    operation: 'wire-lookup', objectApiName: 'Contact', fieldApiName: 'AccountId', parentNickname: 'Account_NickName',
                    startLineNumber: 14, removedLines: [`    AccountId: ${TODO}`], insertedLines: ['    AccountId: Account_NickName']
                }
            ]);

        });

        test.each([
            ['CRLF with a final newline', '\r\n', true],
            ['CRLF without a final newline', '\r\n', false],
            ['LF without a final newline', '\n', false]
        ])('keeps %s', (unusedLabel, lineEnding, hasFinalNewline) => {

            const body = FLAT_RECIPE.replace(/\n$/, '').split('\n').join(lineEnding);
            const recipeText = hasFinalNewline ? `${body}${lineEnding}` : body;

            const result = expectApplied(RecipeCockpitRecipeWriter.wireLookups(recipeText, [
                { objectApiName: 'Opportunity', fieldApiName: 'AccountId', parentNickname: 'Account_NickName' }
            ], FLAT_CONTEXT));

            expect(result.recipeText).toBe(recipeText.replace(`    Contact__c: ${TODO}`, 'PLACEHOLDER')
                .replace(`    AccountId: ${TODO}${lineEnding}PLACEHOLDER`, `    AccountId: Account_NickName${lineEnding}PLACEHOLDER`)
                .replace('PLACEHOLDER', `    Contact__c: ${TODO}`));

        });

        test('refuses an empty request', () => {
            expect(expectRefused(RecipeCockpitRecipeWriter.wireLookups(FLAT_RECIPE, [], FLAT_CONTEXT)).reason).toBe('no-lookup-wirings');
        });

        test.each([
            ['an object name that is not an api name', { objectApiName: 'Contact\n- object: X', fieldApiName: 'AccountId', parentNickname: 'Account_NickName' }, 'invalid-object-api-name'],
            ['a nickname that is not a name', { objectApiName: 'Contact', objectNickname: 'a b', fieldApiName: 'AccountId', parentNickname: 'Account_NickName' }, 'invalid-object-nickname'],
            ['a field that is not an api name', { objectApiName: 'Contact', fieldApiName: 'Account Id', parentNickname: 'Account_NickName' }, 'invalid-field-api-name'],
            ['a parent nickname carrying a template', { objectApiName: 'Contact', fieldApiName: 'AccountId', parentNickname: '${{ process.exit() }}' }, 'invalid-value'],
            ['a parent nickname carrying a line break', { objectApiName: 'Contact', fieldApiName: 'AccountId', parentNickname: 'Account_NickName\n- object: Evil' }, 'invalid-value'],
            ['a lookup already filled in', { objectApiName: 'Opportunity', fieldApiName: 'Name', parentNickname: 'Account_NickName' }, 'lookup-not-wireable'],
            ['a lookup with no parent inserted first', { objectApiName: 'Contact', fieldApiName: 'ReportsToId', parentNickname: 'Contact_NickName' }, 'lookup-not-wireable'],
            ['a nickname of another object', { objectApiName: 'Contact', fieldApiName: 'AccountId', parentNickname: 'Opportunity_NickName' }, 'parent-nickname-not-a-candidate'],
            ['a nickname the file does not hold', { objectApiName: 'Contact', fieldApiName: 'AccountId', parentNickname: 'Ghost_NickName' }, 'parent-nickname-not-a-candidate']
        ])('refuses %s, and writes nothing else of the batch', (unusedLabel, badRequest, expectedReason) => {

            const result = RecipeCockpitRecipeWriter.wireLookups(FLAT_RECIPE, [
                { objectApiName: 'Opportunity', fieldApiName: 'AccountId', parentNickname: 'Account_NickName' },
                badRequest
            ], FLAT_CONTEXT);

            expect(expectRefused(result).reason).toBe(expectedReason);
            expect(result).not.toHaveProperty('recipeText');

        });

        test('refuses one lookup named twice', () => {

            const request = { objectApiName: 'Contact', fieldApiName: 'AccountId', parentNickname: 'Account_NickName' };

            expect(expectRefused(RecipeCockpitRecipeWriter.wireLookups(FLAT_RECIPE, [request, request], FLAT_CONTEXT)).reason).toBe('duplicate-lookup-wiring');

        });

        test('refuses rather than writes a result that does not read back as the same objects and fields', () => {

            const scan = RecipeCockpitRecipeWriter.scanRecipeObjects.bind(RecipeCockpitRecipeWriter);
            // THE SECOND SCAN IS THE READ-BACK; ONE THAT LOST AN OBJECT IS WHAT IT GUARDS AGAINST
            jest.spyOn(RecipeCockpitRecipeWriter, 'scanRecipeObjects')
                .mockImplementationOnce(scan)
                .mockImplementationOnce(lines => scan(lines).slice(1));

            const refusal = expectRefused(RecipeCockpitRecipeWriter.wireLookups(FLAT_RECIPE, [
                { objectApiName: 'Contact', fieldApiName: 'AccountId', parentNickname: 'Account_NickName' }
            ], FLAT_CONTEXT));

            expect(refusal).toEqual(expect.objectContaining({ reason: 'unsupported-field-layout', objectApiName: 'Contact', fieldApiName: 'AccountId' }));

        });

        test('a lookup wired once is no longer offered, so a second wiring is refused', () => {

            const request = { objectApiName: 'Contact', fieldApiName: 'AccountId', parentNickname: 'Account_NickName' };
            const wiredText = expectApplied(RecipeCockpitRecipeWriter.wireLookups(FLAT_RECIPE, [request], FLAT_CONTEXT)).recipeText;

            expect(RecipeCockpitRecipeWriter.listLookupWirings(wiredText, FLAT_CONTEXT).map(wiring => wiring.objectApiName)).toEqual(['Opportunity']);
            expect(expectRefused(RecipeCockpitRecipeWriter.wireLookups(wiredText, [request], FLAT_CONTEXT)).reason).toBe('lookup-not-wireable');

        });

    });

    describe('review fixes', () => {

        // THE READ-BACK USED TO SEARCH EVERY FIELD OF THE FILE PER EDIT: 15.7 s FOR THIS SHAPE IN REVIEW, UNDER A SECOND ONCE INDEXED
        test('wires 11,000 objects\' 33,000 TODO lookups in one batch in linear time', () => {

            const lookups: Record<string, IRecipeFilterLookup[]> = {};
            const levels: Record<string, number> = { Account: 0 };
            const recipeLines = ['- object: Account', '  nickname: Account_NickName', '  fields:', '    Name: Acme', ''];
            for ( let objectIndex = 0; objectIndex < 11000; objectIndex++ ) {
                const objectApiName = `Child${objectIndex}__c`;
                lookups[objectApiName] = [1, 2, 3].map(lookupIndex => ({ fieldApiName: `Account${lookupIndex}__c`, parentObjectApiName: 'Account' }));
                levels[objectApiName] = 1;
                recipeLines.push(`- object: ${objectApiName}`, `  nickname: ${objectApiName}_NickName`, '  fields:',
                    ...Array.from({ length: 17 }, (_unused, fieldIndex) => `    Text${fieldIndex}__c: x`),
                    ...[1, 2, 3].map(lookupIndex => `    Account${lookupIndex}__c: ${TODO}`), '');
            }
            const context = buildContext(lookups, levels);
            const recipeText = recipeLines.join('\n');

            const startedAt = Date.now();
            const wirings = RecipeCockpitRecipeWriter.listLookupWirings(recipeText, context);
            const result = expectApplied(RecipeCockpitRecipeWriter.wireLookups(recipeText, wirings.map(wiring => ({
                objectApiName: wiring.objectApiName,
                fieldApiName: wiring.fieldApiName,
                parentNickname: wiring.candidateNicknames[0]
            })), context));

            expect(Date.now() - startedAt).toBeLessThan(5000);
            expect(result.edits).toHaveLength(33000);
            expect(result.recipeText).not.toContain(TODO);

        });

        test('an object written more than once is wired only when every occurrence has a nickname of its own', () => {

            const recipeText = [
                '- object: Account', '  nickname: Account_NickName', '  fields:', '    Name: Acme', '',
                '- object: Contact', '  nickname: Contact_X', '  fields:', `    AccountId: ${TODO}`, '',
                '- object: Contact', '  nickname: Contact_Y', '  fields:', `    AccountId: ${TODO}`, '',
                '- object: Contact', '  nickname: Contact_Y', '  fields:', `    AccountId: ${TODO}`, ''
            ].join('\n');
            const context = buildContext({ Contact: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }] }, { Account: 0, Contact: 1 });

            // THE COCKPIT DRAWS THIS CONTACT AS ONE ROW WITH NO NICKNAME, SO NO OCCURRENCE OF IT IS OFFERED
            expect(RecipeCockpitRecipeWriter.listLookupWirings(recipeText, context)).toEqual([]);
            expect(expectRefused(RecipeCockpitRecipeWriter.wireLookups(recipeText, [
                { objectApiName: 'Contact', objectNickname: 'Contact_X', fieldApiName: 'AccountId', parentNickname: 'Account_NickName' }
            ], context)).reason).toBe('lookup-not-wireable');

            const distinctText = recipeText.replace(/Contact_Y\n([\s\S]*)Contact_Y/, 'Contact_Y\n$1Contact_Z');
            expect(RecipeCockpitRecipeWriter.listLookupWirings(distinctText, context).map(wiring => wiring.objectNickname)).toEqual(['Contact_X', 'Contact_Y', 'Contact_Z']);

        });

        test.each(['Yes', 'No', 'On', 'Off', 'y', 'N', 'true', 'False', 'null', 'NULL'])('never offers the nickname %s, which YAML would not load as a string', reservedNickname => {

            const recipeText = FLAT_RECIPE.replace('  nickname: Account_NickName', `  nickname: ${reservedNickname}`);

            expect(RecipeCockpitRecipeWriter.listLookupWirings(recipeText, FLAT_CONTEXT)).toEqual([]);
            expect(expectRefused(RecipeCockpitRecipeWriter.wireLookups(recipeText, [
                { objectApiName: 'Contact', fieldApiName: 'AccountId', parentNickname: reservedNickname }
            ], FLAT_CONTEXT)).reason).toBe('lookup-not-wireable');

        });

        test('a reserved-looking nickname that YAML reads as a string is still offered', () => {

            const recipeText = FLAT_RECIPE.replace('  nickname: Account_NickName', '  nickname: Yesterday');

            expect(RecipeCockpitRecipeWriter.listLookupWirings(recipeText, FLAT_CONTEXT).map(wiring => wiring.candidateNicknames)).toEqual([['Yesterday'], ['Yesterday']]);

        });

    });

    describe('against the generated snowfakery recipe', () => {

        const SNOWFAKERY_RECIPE = fs.readFileSync(path.join(__dirname, 'mocks', 'recipeWriter', 'recipe-snowfakery--RelationshipTree_1.yml'), 'utf-8');
        const SNOWFAKERY_CONTEXT = buildContext({
            Contact: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }],
            Opportunity: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }],
            Example_Everything__c: [{ fieldApiName: 'AccountLookup__c', parentObjectApiName: 'Account' }]
        }, { Account: 0, Contact: 1, Opportunity: 1, Example_Everything__c: 1 });

        test('wires every lookup to Account, and the recipe still loads with the nickname as each value', () => {

            const wirings = RecipeCockpitRecipeWriter.listLookupWirings(SNOWFAKERY_RECIPE, SNOWFAKERY_CONTEXT);
            expect(wirings.map(wiring => `${wiring.objectApiName}.${wiring.fieldApiName}`)).toEqual(['Contact.AccountId', 'Example_Everything__c.AccountLookup__c', 'Opportunity.AccountId']);

            const result = expectApplied(RecipeCockpitRecipeWriter.wireLookups(SNOWFAKERY_RECIPE, wirings.map(wiring => ({
                objectApiName: wiring.objectApiName,
                fieldApiName: wiring.fieldApiName,
                parentNickname: wiring.candidateNicknames[0]
            })), SNOWFAKERY_CONTEXT));

            const loadedObjects = yaml.load(result.recipeText) as { object: string; fields: Record<string, unknown> }[];
            const fieldsOf = (objectApiName: string) => loadedObjects.find(loadedObject => loadedObject.object === objectApiName).fields;

            expect(fieldsOf('Contact').AccountId).toBe('Account_NickName');
            expect(fieldsOf('Opportunity').AccountId).toBe('Account_NickName');
            expect(fieldsOf('Example_Everything__c').AccountLookup__c).toBe('Account_NickName');
            // A TODO THE WIRING WAS NOT ASKED ABOUT STAYS THE NULL IT WAS
            expect(fieldsOf('Contact').ReportsToId).toBeNull();

        });

    });

});
