import * as yaml from 'js-yaml';

import { RelationshipService } from '../RelationshipService';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';
import { FieldInfo } from '../../ObjectInfoWrapper/FieldInfo';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { ProcessedYamlWrapper } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/ProcessedYamlWrapper';
import { CollectionsApiService } from '../../CollectionsApiService/CollectionsApiService';
import { RecipeCockpitRecipeWriter } from '../../RecipeWriter/RecipeCockpitRecipeWriter';
import { SalesforceApiName } from '../../SalesforceApiName/SalesforceApiName';

jest.mock('vscode', () => ({}), { virtual: true });

/*
    #622: with isChildTreeCopiedPerRecordTypeBlock on, every record type block of an object carries
    its own copy of the object's children -- nested under friends: for faker-js, written once per
    parent block for snowfakery -- each copy under its own nicknames and wired to its own blocks.
    The wrapper is built by hand, each block in the shape DirectoryProcessor writes it.
*/

type ObjectSpecification = {
    objectApiName: string;
    // LOOKUP FIELD API NAME -> PARENT OBJECT API NAME
    lookups?: Record<string, string>;
    recordTypeNames?: string[];
};

type LoadedRecipeEntry = {
    object: string;
    nickname: string;
    count: number;
    fields: Record<string, unknown>;
    friends?: LoadedRecipeEntry[];
};

const buildBlockRecipe = (objectSpecification: ObjectSpecification, recordTypeName?: string): string => [
    '',
    `- object: ${objectSpecification.objectApiName}`,
    `  nickname: ${objectSpecification.objectApiName}${recordTypeName ? `_${recordTypeName}` : ''}_NickName`,
    '  count: 1',
    '  fields:',
    ...( recordTypeName ? [`    RecordTypeId: ${objectSpecification.objectApiName}.${recordTypeName}`] : [] ),
    '    Name: ${{ faker.company.name() }}',
    ...Object.keys(objectSpecification.lookups ?? {}).map(lookupFieldApiName => `    ${lookupFieldApiName}: ${RelationshipService.referenceIdRequiredTodo}`)
].join('\n');

const buildObjectInfoWrapper = (objectSpecifications: ObjectSpecification[]): ObjectInfoWrapper => {

    const relationshipService = new RelationshipService();
    const objectInfoWrapper = new ObjectInfoWrapper();

    objectSpecifications.forEach(objectSpecification => {
        objectInfoWrapper.addKeyToObjectInfoMap(objectSpecification.objectApiName);
        const objectInfo = objectInfoWrapper.ObjectToObjectInfoMap[objectSpecification.objectApiName];
        objectInfo.RelationshipDetail = relationshipService.buildNewRelationshipDetail(objectSpecification.objectApiName);
        const [firstBlock, ...additionalBlocks] = ( objectSpecification.recordTypeNames ?? [undefined] )
            .map(recordTypeName => buildBlockRecipe(objectSpecification, recordTypeName));
        objectInfo.FullRecipe = firstBlock;
        if ( additionalBlocks.length > 0 ) {
            objectInfo.AdditionalRecordTypeRecipes = additionalBlocks;
        }
    });

    objectSpecifications.forEach(objectSpecification => {
        Object.entries(objectSpecification.lookups ?? {}).forEach(([lookupFieldApiName, parentObjectApiName]) => {
            const lookupField = new FieldInfo(objectSpecification.objectApiName, lookupFieldApiName, lookupFieldApiName, 'Lookup');
            relationshipService.buildBidirectionalChildAndParentRelationshipReferences(lookupField, objectInfoWrapper, objectSpecification.objectApiName, parentObjectApiName);
        });
    });

    relationshipService.processAllRelationships(objectInfoWrapper);
    return objectInfoWrapper;

};

const generateRecipe = (objectSpecifications: ObjectSpecification[], nestChildObjectsAsFriends: boolean, isChildTreeCopiedPerRecordTypeBlock: boolean = true): string =>
    new RelationshipService().generateSeparateRecipeFiles(buildObjectInfoWrapper(objectSpecifications), nestChildObjectsAsFriends, isChildTreeCopiedPerRecordTypeBlock)[0].content;

const flattenEntries = (recipeEntries: LoadedRecipeEntry[]): LoadedRecipeEntry[] =>
    recipeEntries.flatMap(recipeEntry => [recipeEntry, ...flattenEntries(recipeEntry.friends ?? [])]);

// [nickname, lookups...] for each friend of an entry, so a copy's wiring reads in one line
const describeFriends = (recipeEntry: LoadedRecipeEntry, lookupFieldApiNames: string[]): unknown[][] =>
    (recipeEntry.friends ?? []).map(friend => [friend.nickname, ...lookupFieldApiNames.filter(fieldApiName => fieldApiName in friend.fields).map(fieldApiName => friend.fields[fieldApiName])]);

const ACCOUNT_TWO_BLOCKS_AND_CONTACT: ObjectSpecification[] = [
    { objectApiName: 'Account', recordTypeNames: ['Business', 'Partner'] },
    { objectApiName: 'Contact', lookups: { AccountId: 'Account' } }
];

describe('RelationshipService copies an object\'s children into each record type block (#622), faker-js', () => {

    test('each Account block holds its own Contact, nicknamed for its copy and wired to its own block', () => {

        const recipeEntries = yaml.load(generateRecipe(ACCOUNT_TWO_BLOCKS_AND_CONTACT, true)) as LoadedRecipeEntry[];

        expect(recipeEntries.map(recipeEntry => recipeEntry.nickname)).toEqual(['Account_Business_NickName', 'Account_Partner_NickName']);
        expect(describeFriends(recipeEntries[0], ['AccountId'])).toEqual([['Contact_NickName', 'Account_Business_NickName']]);
        expect(describeFriends(recipeEntries[1], ['AccountId'])).toEqual([['Contact_Account_Partner_NickName', 'Account_Partner_NickName']]);

    });

    test('a grandchild is copied with its parent, and every lookup in the copy names that copy\'s blocks', () => {

        const recipeEntries = yaml.load(generateRecipe([
            ...ACCOUNT_TWO_BLOCKS_AND_CONTACT,
            { objectApiName: 'Case', lookups: { AccountId: 'Account', ContactId: 'Contact' } }
        ], true)) as LoadedRecipeEntry[];

        expect(describeFriends(recipeEntries[0].friends[0], ['AccountId', 'ContactId'])).toEqual([['Case_NickName', 'Account_Business_NickName', 'Contact_NickName']]);
        expect(describeFriends(recipeEntries[1].friends[0], ['AccountId', 'ContactId'])).toEqual([['Case_Account_Partner_NickName', 'Account_Partner_NickName', 'Contact_Account_Partner_NickName']]);

    });

    test('a lower-level parent that is not an ancestor (#189) is the copy\'s own when it is in the copy', () => {

        const recipeEntries = yaml.load(generateRecipe([
            ...ACCOUNT_TWO_BLOCKS_AND_CONTACT,
            { objectApiName: 'Opportunity', lookups: { AccountId: 'Account' } },
            { objectApiName: 'OpportunityContactRole', lookups: { ContactId: 'Contact', OpportunityId: 'Opportunity' } }
        ], true)) as LoadedRecipeEntry[];
        const partnerContact = recipeEntries[1].friends.find(friend => friend.object === 'Contact');

        expect(describeFriends(partnerContact, ['ContactId', 'OpportunityId'])).toEqual([[
            'OpportunityContactRole_Account_Partner_NickName', 'Contact_Account_Partner_NickName', 'Opportunity_Account_Partner_NickName'
        ]]);

    });

    test('a child with record type blocks of its own is copied with all of them, each carrying its own copy of the grandchildren, every name unique and an api name', () => {

        const recipeContent = generateRecipe([
            { objectApiName: 'Account', recordTypeNames: ['Business', 'Partner'] },
            { objectApiName: 'Contact', lookups: { AccountId: 'Account' }, recordTypeNames: ['Buyer', 'Seller'] },
            { objectApiName: 'Case', lookups: { ContactId: 'Contact' } }
        ], true);
        const recipeEntries = yaml.load(recipeContent) as LoadedRecipeEntry[];
        const nicknames = flattenEntries(recipeEntries).map(recipeEntry => recipeEntry.nickname);

        expect(describeFriends(recipeEntries[1], ['AccountId', 'RecordTypeId'])).toEqual([
            ['Contact_Buyer_Account_Partner_NickName', 'Account_Partner_NickName', 'Contact.Buyer'],
            ['Contact_Seller_Account_Partner_NickName', 'Account_Partner_NickName', 'Contact.Seller']
        ]);
        expect(recipeEntries.flatMap(account => account.friends.map(contact => describeFriends(contact, ['ContactId'])))).toEqual([
            [['Case_NickName', 'Contact_Buyer_NickName']],
            [['Case_Contact_Seller_NickName', 'Contact_Seller_NickName']],
            [['Case_Account_Partner_NickName', 'Contact_Buyer_Account_Partner_NickName']],
            [['Case_Contact_Seller_Account_Partner_NickName', 'Contact_Seller_Account_Partner_NickName']]
        ]);
        expect(new Set(nicknames).size).toBe(nicknames.length);
        expect(nicknames.every(nickname => SalesforceApiName.isApiName(nickname))).toBeTrue();
        expect(recipeContent).toContain('\n    # Contact (record type block Contact_Seller_Account_Partner_NickName)\n');

    });

    test('a copy name the tree already holds takes _Copy, and the lookups follow it', () => {

        const recipeEntries = yaml.load(generateRecipe([
            ...ACCOUNT_TWO_BLOCKS_AND_CONTACT,
            { objectApiName: 'Contact_Account_Partner', lookups: { AccountId: 'Account' } },
            { objectApiName: 'Case', lookups: { ContactId: 'Contact' } }
        ], true)) as LoadedRecipeEntry[];
        const nicknames = flattenEntries(recipeEntries).map(recipeEntry => recipeEntry.nickname);
        const partnerContact = recipeEntries[1].friends.find(friend => friend.object === 'Contact');

        expect(partnerContact.nickname).toBe('Contact_Account_Partner_Copy_NickName');
        expect(describeFriends(partnerContact, ['ContactId'])).toEqual([['Case_Account_Partner_NickName', 'Contact_Account_Partner_Copy_NickName']]);
        expect(nicknames).toContain('Contact_Account_Partner_NickName');
        expect(new Set(nicknames).size).toBe(nicknames.length);

    });

    test('a self-lookup iteration stays under the object\'s first block; a copied child keeps its own, wired to the copy', () => {

        const recipeEntries = yaml.load(generateRecipe([
            { objectApiName: 'Account', recordTypeNames: ['Business', 'Partner'], lookups: { ParentId: 'Account' } },
            { objectApiName: 'Contact', lookups: { AccountId: 'Account', ReportsToId: 'Contact' } }
        ], true)) as LoadedRecipeEntry[];

        expect(recipeEntries[0].friends.map(friend => friend.nickname)).toEqual(['Contact_NickName', 'Account_child_NickName']);
        expect(recipeEntries[1].friends.map(friend => friend.nickname)).toEqual(['Contact_Account_Partner_NickName']);
        expect(describeFriends(recipeEntries[1].friends[0], ['AccountId', 'ReportsToId'])).toEqual([
            ['Contact_child_Account_Partner_NickName', 'Account_Partner_NickName', 'Contact_Account_Partner_NickName']
        ]);

    });

    test('record totals double for every child under a two-block parent', () => {

        const recipeContent = generateRecipe([
            ...ACCOUNT_TWO_BLOCKS_AND_CONTACT,
            { objectApiName: 'Case', lookups: { ContactId: 'Contact' } }
        ], true).replace(/^( {2}count:) 1$/gm, '$1 2');
        const singleBlockRecipeContent = generateRecipe([
            ...ACCOUNT_TWO_BLOCKS_AND_CONTACT,
            { objectApiName: 'Case', lookups: { ContactId: 'Contact' } }
        ], true, false).replace(/^( {2}count:) 1$/gm, '$1 2');

        expect(RecipeCockpitRecipeWriter.countRecipeRecordsByObject(singleBlockRecipeContent)).toEqual(new Map([['Account', 4], ['Contact', 2], ['Case', 2]]));
        expect(RecipeCockpitRecipeWriter.countRecipeRecordsByObject(recipeContent)).toEqual(new Map([['Account', 4], ['Contact', 4], ['Case', 4]]));

    });

    test('the Recipe Cockpit writer reads each copy as an occurrence told apart by nickname', () => {

        const recipeContent = generateRecipe(ACCOUNT_TWO_BLOCKS_AND_CONTACT, true);
        const scannedContacts = RecipeCockpitRecipeWriter.scanRecipeObjects(recipeContent.split('\n')).filter(scannedObject => scannedObject.objectApiName === 'Contact');

        expect(scannedContacts.map(scannedContact => scannedContact.nicknames)).toEqual([['Contact_NickName'], ['Contact_Account_Partner_NickName']]);

    });

    test('end to end: each Account record of either block has its own Contact, and each Case resolves to its own Contact\'s Account', async () => {

        const recipeContent = generateRecipe([
            ...ACCOUNT_TWO_BLOCKS_AND_CONTACT,
            { objectApiName: 'Case', lookups: { AccountId: 'Account', ContactId: 'Contact' } }
        ], true).replace(/^( {2}count:) 1$/gm, '$1 2');

        const fakerJSRecipeProcessor = new FakerJSRecipeProcessor();
        let processedYamlWrapper: ProcessedYamlWrapper = { ObjectPropertyToExistingProcessedYaml: {}, VariablePropertyToExistingProcessedYaml: {} };
        for ( const recipeEntry of yaml.load(recipeContent) as LoadedRecipeEntry[] ) {
            processedYamlWrapper = await fakerJSRecipeProcessor.processObjectDeclarationForYamlDocumentItem(recipeEntry.object, recipeEntry, processedYamlWrapper);
        }
        fakerJSRecipeProcessor.resolveNonAncestorNicknameReferences(processedYamlWrapper);
        const fakerJson = JSON.stringify(Object.values(processedYamlWrapper.ObjectPropertyToExistingProcessedYaml).flat());
        const collectionsByObject = fakerJSRecipeProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakerJson);
        const orgRecordTypes = { records: [
            { SobjectType: 'Account', DeveloperName: 'Business', Id: '012BUSINESS' },
            { SobjectType: 'Account', DeveloperName: 'Partner', Id: '012PARTNER' }
        ] };

        let referenceIdToOrgId: Record<string, string> = {};
        const insertedRecordsByObject: Record<string, Record<string, unknown>[]> = {};
        let insertedRecordCount = 0;
        ['Account', 'Contact', 'Case'].forEach(objectApiName => {
            const withRecordTypeIds = CollectionsApiService.updateCollectionApiJsonContentWithOrgRecordTypeIds(JSON.stringify(collectionsByObject.get(objectApiName)), orgRecordTypes);
            const resolvedRecords = JSON.parse(CollectionsApiService.updateLookupReferencesInCollectionApiJson(withRecordTypeIds, referenceIdToOrgId)).records;
            const fakeInsertResults = resolvedRecords.map(() => ({ id: `ID${insertedRecordCount++}`, success: true }));
            referenceIdToOrgId = CollectionsApiService.updateReferenceIdMapWithCreatedRecords(referenceIdToOrgId, fakeInsertResults, resolvedRecords);
            insertedRecordsByObject[objectApiName] = resolvedRecords.map((resolvedRecord, recordIndex) => ({ ...resolvedRecord, Id: fakeInsertResults[recordIndex].id }));
        });

        const recordTypeIdByAccountId = new Map(insertedRecordsByObject['Account'].map(account => [account.Id, account.RecordTypeId]));
        const contactById = new Map(insertedRecordsByObject['Contact'].map(contact => [contact.Id, contact]));
        const contactRecordTypeIds = insertedRecordsByObject['Contact'].map(contact => recordTypeIdByAccountId.get(contact.AccountId));

        expect(contactRecordTypeIds).toEqual(['012BUSINESS', '012BUSINESS', '012PARTNER', '012PARTNER']);
        // EVERY ACCOUNT RECORD, OF EITHER BLOCK, HAS A CONTACT OF ITS OWN
        expect(new Set(insertedRecordsByObject['Contact'].map(contact => contact.AccountId)).size).toBe(4);
        expect(insertedRecordsByObject['Case']).toHaveLength(4);
        insertedRecordsByObject['Case'].forEach(caseRecord => {
            expect(contactById.get(caseRecord.ContactId as string).AccountId).toBe(caseRecord.AccountId);
        });

    });

    test('a tree with no object of several blocks is written exactly as with the option off', () => {

        const objectSpecifications: ObjectSpecification[] = [
            { objectApiName: 'Account', lookups: { ParentId: 'Account' } },
            { objectApiName: 'Contact', lookups: { AccountId: 'Account' } }
        ];

        expect(generateRecipe(objectSpecifications, true)).toBe(generateRecipe(objectSpecifications, true, false));

    });

});

describe('RelationshipService copies an object\'s children into each record type block (#622), snowfakery', () => {

    test('each child is written flat once per parent block, after every block of the parent, each copy referencing its own block', () => {

        const recipeContent = generateRecipe([
            ...ACCOUNT_TWO_BLOCKS_AND_CONTACT,
            { objectApiName: 'Case', lookups: { AccountId: 'Account', ContactId: 'Contact' } }
        ], false);
        const recipeEntries = yaml.load(recipeContent) as LoadedRecipeEntry[];

        expect(recipeContent).not.toContain('friends:');
        expect(recipeEntries.map(recipeEntry => [recipeEntry.nickname, recipeEntry.fields.AccountId, recipeEntry.fields.ContactId])).toEqual([
            ['Account_Business_NickName', undefined, undefined],
            ['Account_Partner_NickName', undefined, undefined],
            ['Contact_NickName', '${{reference(Account_Business_NickName)}}', undefined],
            ['Contact_Account_Partner_NickName', '${{reference(Account_Partner_NickName)}}', undefined],
            ['Case_NickName', '${{reference(Account_Business_NickName)}}', '${{reference(Contact_NickName)}}'],
            ['Case_Account_Partner_NickName', '${{reference(Account_Partner_NickName)}}', '${{reference(Contact_Account_Partner_NickName)}}']
        ]);
        expect(recipeContent).not.toContain(RelationshipService.recordTypeBlocksTodo);

    });

    test('a lookup that is not to an ancestor block stays the TODO snowfakery writes, with its record type block note', () => {

        const recipeContent = generateRecipe([
            ...ACCOUNT_TWO_BLOCKS_AND_CONTACT,
            { objectApiName: 'Opportunity', lookups: { AccountId: 'Account' } },
            { objectApiName: 'OpportunityContactRole', lookups: { ContactId: 'Contact', OpportunityId: 'Opportunity' } }
        ], false);
        const recipeEntries = yaml.load(recipeContent) as LoadedRecipeEntry[];
        const contactRoles = recipeEntries.filter(recipeEntry => recipeEntry.object === 'OpportunityContactRole');

        expect(contactRoles.map(contactRole => [contactRole.nickname, contactRole.fields.ContactId, contactRole.fields.OpportunityId])).toEqual([
            ['OpportunityContactRole_NickName', '${{reference(Contact_NickName)}}', null],
            ['OpportunityContactRole_Account_Partner_NickName', '${{reference(Contact_Account_Partner_NickName)}}', null]
        ]);

    });

    test('a tree whose later blocks have no children is written exactly as with the option off', () => {

        const objectSpecifications: ObjectSpecification[] = [
            { objectApiName: 'Account' },
            { objectApiName: 'Contact', lookups: { AccountId: 'Account' }, recordTypeNames: ['Buyer', 'Seller'] }
        ];

        expect(generateRecipe(objectSpecifications, false)).toBe(generateRecipe(objectSpecifications, false, false));
        expect(generateRecipe(ACCOUNT_TWO_BLOCKS_AND_CONTACT, false, false)).not.toContain('reference(');

    });

});

describe('RelationshipService.readNicknameStem (#622)', () => {

    test.each([
        ['Account_Partner_NickName', 'Account_Partner'],
        ['Account_NickName', 'Account'],
        ['Account_Partner', 'Account_Partner'],
        ['_NickName', '_NickName']
    ])('reads %p as %p', (nickname, nicknameStem) => {

        expect(RelationshipService.readNicknameStem(nickname)).toBe(nicknameStem);

    });

    test('a copy of a block whose nickname has no _NickName ending still ends in _NickName', () => {

        const objectInfoWrapper = buildObjectInfoWrapper(ACCOUNT_TWO_BLOCKS_AND_CONTACT);
        const accountInfo = objectInfoWrapper.ObjectToObjectInfoMap['Account'];
        accountInfo.AdditionalRecordTypeRecipes = [accountInfo.AdditionalRecordTypeRecipes[0].replace('nickname: Account_Partner_NickName', 'nickname: PartnerAccounts')];

        const recipeEntries = yaml.load(new RelationshipService().generateSeparateRecipeFiles(objectInfoWrapper, true, true)[0].content) as LoadedRecipeEntry[];

        expect(describeFriends(recipeEntries[1], ['AccountId'])).toEqual([['Contact_PartnerAccounts_NickName', 'PartnerAccounts']]);

    });

});
