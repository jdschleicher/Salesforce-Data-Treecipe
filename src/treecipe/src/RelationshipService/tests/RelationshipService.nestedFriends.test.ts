import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

import { RelationshipService } from '../RelationshipService';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';
import { FieldInfo } from '../../ObjectInfoWrapper/FieldInfo';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { ProcessedYamlWrapper } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/ProcessedYamlWrapper';
import { CollectionsApiService } from '../../CollectionsApiService/CollectionsApiService';
import { RecipeCockpitRecipeWriter } from '../../RecipeCockpitService/RecipeCockpitRecipeWriter';

jest.mock('vscode', () => ({}), { virtual: true });

/*
    Generate Treecipe with the faker-js backend nests each child object under its parent's friends:
    block (#46). These tests build the objects wrapper by hand -- each object's FullRecipe in the
    exact shape RecipeService writes it -- so the nesting is asserted independent of the XML walk.
*/

type ObjectSpecification = {
    objectApiName: string;
    // LOOKUP FIELD API NAME -> PARENT OBJECT API NAME
    lookups?: Record<string, string>;
    // A LOOKUP TARGET WITH NO RECIPE OF ITS OWN, AS RelationshipService SEES User WHEN NO User FOLDER EXISTS
    hasNoRecipe?: boolean;
    extraFieldLines?: string[];
};

type LoadedRecipeEntry = {
    object: string;
    nickname: string;
    count: number;
    fields: Record<string, unknown>;
    friends?: LoadedRecipeEntry[];
};

const buildFullRecipe = (objectSpecification: ObjectSpecification): string => [
    '',
    `- object: ${objectSpecification.objectApiName}`,
    `  nickname: ${objectSpecification.objectApiName}_NickName`,
    '  count: 1',
    '  fields:',
    '    Name: ${{ faker.company.name() }}',
    ...Object.keys(objectSpecification.lookups ?? {}).map(lookupFieldApiName => `    ${lookupFieldApiName}: ${RelationshipService.referenceIdRequiredTodo}`),
    ...(objectSpecification.extraFieldLines ?? [])
].join('\n');

const buildObjectInfoWrapper = (objectSpecifications: ObjectSpecification[]): ObjectInfoWrapper => {

    const relationshipService = new RelationshipService();
    const objectInfoWrapper = new ObjectInfoWrapper();

    objectSpecifications.forEach(objectSpecification => {
        objectInfoWrapper.addKeyToObjectInfoMap(objectSpecification.objectApiName);
        const objectInfo = objectInfoWrapper.ObjectToObjectInfoMap[objectSpecification.objectApiName];
        objectInfo.RelationshipDetail = relationshipService.buildNewRelationshipDetail(objectSpecification.objectApiName);
        if ( !objectSpecification.hasNoRecipe ) {
            objectInfo.FullRecipe = buildFullRecipe(objectSpecification);
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

const generateRecipeContents = (objectSpecifications: ObjectSpecification[], nestChildObjectsAsFriends: boolean): string[] =>
    new RelationshipService().generateSeparateRecipeFiles(buildObjectInfoWrapper(objectSpecifications), nestChildObjectsAsFriends)
        .map(recipeFile => recipeFile.content);

const findEntry = (recipeEntries: LoadedRecipeEntry[], objectApiName: string): LoadedRecipeEntry | undefined => {
    for ( const recipeEntry of recipeEntries ) {
        if ( recipeEntry.object === objectApiName ) {
            return recipeEntry;
        }
        const nestedEntry = findEntry(recipeEntry.friends ?? [], objectApiName);
        if ( nestedEntry ) {
            return nestedEntry;
        }
    }
    return undefined;
};

const ACCOUNT_OTHER_OTHER_CHILD: ObjectSpecification[] = [
    { objectApiName: 'Account' },
    { objectApiName: 'Other__c', lookups: { Account__c: 'Account' } },
    { objectApiName: 'OtherChildObject__c', lookups: { Account__c: 'Account', Other__c: 'Other__c' } }
];

describe('RelationshipService nests child objects under friends: for faker-js recipes (#46)', () => {

    test('a single parent and child: the child is written under the parent friends: block with its lookup wired', () => {

        const [recipeContent] = generateRecipeContents([
            { objectApiName: 'Account' },
            { objectApiName: 'Contact', lookups: { AccountId: 'Account' } }
        ], true);

        expect(recipeContent).toBe([
            '# Relationship Tree: RelationshipTree_1',
            '# Child objects are nested under their parent\'s friends: block -- a friend\'s count is records PER parent record',
            '',
            '# Account (Children: Contact)',
            '- object: Account',
            '  nickname: Account_NickName',
            '  count: 1',
            '  fields:',
            '    Name: ${{ faker.company.name() }}',
            '  friends:',
            '    # Contact (Parents: Account)',
            '    - object: Contact',
            '      nickname: Contact_NickName',
            '      count: 1',
            '      fields:',
            '        Name: ${{ faker.company.name() }}',
            '        AccountId: Account_NickName',
            '',
            ''
        ].join('\n'));

    });

    test('several children of one parent are its friends in insert order', () => {

        const [recipeContent] = generateRecipeContents([
            { objectApiName: 'Account' },
            { objectApiName: 'Opportunity', lookups: { AccountId: 'Account' } },
            { objectApiName: 'Contact', lookups: { AccountId: 'Account' } }
        ], true);

        const recipeEntries = yaml.load(recipeContent) as LoadedRecipeEntry[];

        expect(recipeEntries.map(recipeEntry => recipeEntry.object)).toEqual(['Account']);
        expect(recipeEntries[0].friends.map(friend => friend.object)).toEqual(['Contact', 'Opportunity']);
        expect(recipeEntries[0].friends.map(friend => friend.fields.AccountId)).toEqual(['Account_NickName', 'Account_NickName']);

    });

    test('a child with two parents nests under the CLOSER one, and its lookups to both the parent and the top parent are wired', () => {

        const [recipeContent] = generateRecipeContents(ACCOUNT_OTHER_OTHER_CHILD, true);
        const recipeEntries = yaml.load(recipeContent) as LoadedRecipeEntry[];

        expect(recipeEntries.map(recipeEntry => recipeEntry.object)).toEqual(['Account']);
        const otherEntry = recipeEntries[0].friends[0];
        expect(otherEntry.object).toBe('Other__c');
        expect(otherEntry.fields.Account__c).toBe('Account_NickName');

        const otherChildEntry = otherEntry.friends[0];
        expect(otherChildEntry.object).toBe('OtherChildObject__c');
        expect(otherChildEntry.fields).toEqual({
            Name: '${{ faker.company.name() }}',
            Account__c: 'Account_NickName',
            Other__c: 'Other__c_NickName'
        });

    });

    test('the closer parent is chosen whichever lookup the child lists first', () => {

        const deeperParentListedFirst: ObjectSpecification[] = [
            { objectApiName: 'Account' },
            { objectApiName: 'Other__c', lookups: { Account__c: 'Account' } },
            { objectApiName: 'OtherChildObject__c', lookups: { Other__c: 'Other__c', Account__c: 'Account' } }
        ];

        const recipeEntries = yaml.load(generateRecipeContents(deeperParentListedFirst, true)[0]) as LoadedRecipeEntry[];

        expect(recipeEntries[0].friends[0].friends.map(friend => [friend.object, friend.fields.Other__c, friend.fields.Account__c])).toEqual([
            ['OtherChildObject__c', 'Other__c_NickName', 'Account_NickName']
        ]);

    });

    test('a blank line inside an object recipe stays blank when the object is nested', () => {

        const [recipeContent] = generateRecipeContents([
            { objectApiName: 'Account' },
            { objectApiName: 'Contact', lookups: { AccountId: 'Account' }, extraFieldLines: ['', '    Title: ${{ faker.person.jobTitle() }}'] }
        ], true);

        expect(recipeContent).toContain('        AccountId: Account_NickName\n\n        Title: ${{ faker.person.jobTitle() }}');
        expect(findEntry(yaml.load(recipeContent) as LoadedRecipeEntry[], 'Contact').fields.Title).toBe('${{ faker.person.jobTitle() }}');

    });

    test('a second parent that is not an ancestor keeps its TODO, and the child nests under the first parent by name', () => {

        const [recipeContent] = generateRecipeContents([
            { objectApiName: 'Beta__c' },
            { objectApiName: 'Alpha__c' },
            { objectApiName: 'Child__c', lookups: { Beta__c: 'Beta__c', Alpha__c: 'Alpha__c' } }
        ], true);

        const recipeEntries = yaml.load(recipeContent) as LoadedRecipeEntry[];

        expect(recipeEntries.map(recipeEntry => recipeEntry.object)).toEqual(['Alpha__c', 'Beta__c']);
        expect(recipeEntries[0].friends.map(friend => friend.object)).toEqual(['Child__c']);
        expect(recipeEntries[1].friends).toBeUndefined();
        expect(recipeEntries[0].friends[0].fields).toEqual({ Name: '${{ faker.company.name() }}', Beta__c: null, Alpha__c: 'Alpha__c_NickName' });
        expect(recipeContent).toContain(`        Beta__c: ${RelationshipService.referenceIdRequiredTodo}`);

    });

    test('a lookup target with no recipe of its own is not nested under, and the child stays top level', () => {

        const [recipeContent] = generateRecipeContents([
            { objectApiName: 'User', hasNoRecipe: true },
            { objectApiName: 'Case__c', lookups: { OwnerId: 'User' } }
        ], true);

        expect(recipeContent).not.toContain('friends:');
        expect(recipeContent).toBe(generateRecipeContents([
            { objectApiName: 'User', hasNoRecipe: true },
            { objectApiName: 'Case__c', lookups: { OwnerId: 'User' } }
        ], false)[0]);

    });

    test('a lookup line that is not exactly the generated TODO is left as it is', () => {

        const [recipeContent] = generateRecipeContents([
            { objectApiName: 'Account' },
            { objectApiName: 'Contact', lookups: { AccountId: 'Account' }, extraFieldLines: ['    ReportsToId: ### TODO -- REFERENCE ID REQUIRED -- see Account'] }
        ], true);

        expect(recipeContent).toContain('        AccountId: Account_NickName');
        expect(recipeContent).toContain('        ReportsToId: ### TODO -- REFERENCE ID REQUIRED -- see Account');

    });

    test('a block scalar keeps its indentation relative to its field when nested', () => {

        const [recipeContent] = generateRecipeContents([
            { objectApiName: 'Account' },
            { objectApiName: 'Contact', lookups: { AccountId: 'Account' }, extraFieldLines: ['    Phone: |', "                    ${{faker.phone.number({style:'national'})}}"] }
        ], true);

        const contactEntry = findEntry(yaml.load(recipeContent) as LoadedRecipeEntry[], 'Contact');

        expect(contactEntry.fields.Phone).toBe("${{faker.phone.number({style:'national'})}}\n");

    });

    test('a tree with no relationships is written exactly as the flat recipe', () => {

        const objectSpecifications: ObjectSpecification[] = [ { objectApiName: 'Lead' } ];

        expect(generateRecipeContents(objectSpecifications, true)).toEqual(generateRecipeContents(objectSpecifications, false));

    });

    test('without nesting (snowfakery) a related tree is written flat, as before', () => {

        const [recipeContent] = generateRecipeContents(ACCOUNT_OTHER_OTHER_CHILD, false);

        expect(recipeContent).not.toContain('friends:');
        expect(recipeContent).toContain('# Level 0 - Account');
        expect(recipeContent.match(/^- object: /gm)).toHaveLength(3);
        expect(recipeContent).toContain(`    Account__c: ${RelationshipService.referenceIdRequiredTodo}`);

    });

    test('the nesting does not depend on the order objects were added to the wrapper', () => {

        const reversedSpecifications = [...ACCOUNT_OTHER_OTHER_CHILD].reverse();

        // THE STRUCTURE, NOT THE TEXT: THE "(Children: ...)" COMMENT LISTS LOOKUPS IN THE ORDER THEY WERE RECORDED, IN A FLAT RECIPE AS IN A NESTED ONE
        expect(generateRecipeContents(reversedSpecifications, true).map(recipeContent => yaml.load(recipeContent)))
            .toEqual(generateRecipeContents(ACCOUNT_OTHER_OTHER_CHILD, true).map(recipeContent => yaml.load(recipeContent)));

    });

    test('an ancestor recipe with no nickname line wires nothing, and trailing blank lines of a recipe are not carried into its friend', () => {

        const objectInfoWrapper = buildObjectInfoWrapper([
            { objectApiName: 'Account' },
            { objectApiName: 'Contact', lookups: { AccountId: 'Account' } }
        ]);
        objectInfoWrapper.ObjectToObjectInfoMap['Account'].FullRecipe = '\n- object: Account\n  count: 1\n  fields:\n    Name: x\n\n';
        objectInfoWrapper.ObjectToObjectInfoMap['Contact'].FullRecipe += '\n\n';

        const [recipeFile] = new RelationshipService().generateSeparateRecipeFiles(objectInfoWrapper, true);

        expect(recipeFile.content).toContain('    Name: x\n  friends:\n');
        expect(recipeFile.content).toContain(`        AccountId: ${RelationshipService.referenceIdRequiredTodo}\n\n`);
        expect(findEntry(yaml.load(recipeFile.content) as LoadedRecipeEntry[], 'Contact').fields.AccountId).toBeNull();

    });

    test('selectFriendsParentByObjectName skips an object the wrapper holds no relationship detail for', () => {

        const objectInfoWrapper = buildObjectInfoWrapper(ACCOUNT_OTHER_OTHER_CHILD);
        objectInfoWrapper.addKeyToObjectInfoMap('Loose__c');

        const friendsParentByObjectName = RelationshipService.selectFriendsParentByObjectName(['Account', 'Other__c', 'OtherChildObject__c', 'Loose__c', 'Missing__c'], objectInfoWrapper);

        expect(Object.fromEntries(friendsParentByObjectName)).toEqual({ Other__c: 'Account', OtherChildObject__c: 'Other__c' });

    });

    test('the Recipe Cockpit scanner finds every nested object at its friends depth', () => {

        const [recipeContent] = generateRecipeContents(ACCOUNT_OTHER_OTHER_CHILD, true);
        const { lines } = RecipeCockpitRecipeWriter.splitRecipeLines(recipeContent);
        const scannedObjects = RecipeCockpitRecipeWriter.scanRecipeObjects(lines);

        expect(scannedObjects.map(scannedObject => [scannedObject.objectApiName, scannedObject.objectIndent])).toEqual([
            ['Account', 0],
            ['Other__c', 4],
            ['OtherChildObject__c', 8]
        ]);
        expect(scannedObjects.map(scannedObject => scannedObject.fields.map(scannedField => scannedField.fieldApiName))).toEqual([
            ['Name'],
            ['Name', 'Account__c'],
            ['Name', 'Account__c', 'Other__c']
        ]);

    });

});

describe('a self-lookup adds one nested child iteration of the same object (#188)', () => {

    test('the iteration is the object\'s last friend, with its own nickname and its self-lookup wired to the iteration above', () => {

        const [recipeContent] = generateRecipeContents([
            { objectApiName: 'Account', lookups: { ParentId: 'Account' } }
        ], true);

        expect(recipeContent).toBe([
            '# Relationship Tree: RelationshipTree_1',
            '# Child objects are nested under their parent\'s friends: block -- a friend\'s count is records PER parent record',
            '',
            '# Account (Parents: Account | Children: Account)',
            '- object: Account',
            '  nickname: Account_NickName',
            '  count: 1',
            '  fields:',
            '    Name: ${{ faker.company.name() }}',
            `    ParentId: ${RelationshipService.referenceIdRequiredTodo}`,
            '  friends:',
            '    # Account (Child iteration of the Account above, through ParentId)',
            '    - object: Account',
            '      nickname: Account_child_NickName',
            '      count: 1',
            '      fields:',
            '        Name: ${{ faker.company.name() }}',
            '        ParentId: Account_NickName',
            '',
            ''
        ].join('\n'));

    });

    test('the iteration comes after the object\'s other friends and carries none of them, so nothing recurses', () => {

        const [recipeContent] = generateRecipeContents([
            { objectApiName: 'Account', lookups: { ParentId: 'Account' } },
            { objectApiName: 'Contact', lookups: { AccountId: 'Account' } }
        ], true);

        const recipeEntries = yaml.load(recipeContent) as LoadedRecipeEntry[];

        expect(recipeEntries.map(recipeEntry => recipeEntry.object)).toEqual(['Account']);
        expect(recipeEntries[0].fields.ParentId).toBeNull();
        expect(recipeEntries[0].friends.map(friend => [friend.object, friend.nickname])).toEqual([
            ['Contact', 'Contact_NickName'],
            ['Account', 'Account_child_NickName']
        ]);
        expect(recipeEntries[0].friends[0].fields.AccountId).toBe('Account_NickName');
        expect(recipeEntries[0].friends[1].fields.ParentId).toBe('Account_NickName');
        expect(recipeEntries[0].friends[1].friends).toBeUndefined();
        expect(recipeContent.match(/- object: Account$/gm)).toHaveLength(2);

    });

    test('every self-lookup field of the iteration holds the parent iteration\'s nickname', () => {

        const [recipeContent] = generateRecipeContents([
            { objectApiName: 'Case', lookups: { ParentId: 'Case', MasterRecordId: 'Case' } }
        ], true);

        const iterationEntry = (yaml.load(recipeContent) as LoadedRecipeEntry[])[0].friends[0];

        expect(recipeContent).toContain('    # Case (Child iteration of the Case above, through ParentId, MasterRecordId)');
        expect(iterationEntry.nickname).toBe('Case_child_NickName');
        expect(iterationEntry.fields).toEqual({ Name: '${{ faker.company.name() }}', ParentId: 'Case_NickName', MasterRecordId: 'Case_NickName' });

    });

    test('a nested object with a self-lookup gets its iteration at its own depth, wired to it and to its ancestors', () => {

        const [recipeContent] = generateRecipeContents([
            { objectApiName: 'Account' },
            { objectApiName: 'Contact', lookups: { AccountId: 'Account', ReportsToId: 'Contact' } }
        ], true);

        const contactEntry = (yaml.load(recipeContent) as LoadedRecipeEntry[])[0].friends[0];

        expect(contactEntry.fields.ReportsToId).toBeNull();
        expect(contactEntry.friends.map(friend => [friend.object, friend.nickname, friend.fields.AccountId, friend.fields.ReportsToId])).toEqual([
            ['Contact', 'Contact_child_NickName', 'Account_NickName', 'Contact_NickName']
        ]);
        expect(recipeContent).toContain('        # Contact (Child iteration of the Contact above, through ReportsToId)\n        - object: Contact\n          nickname: Contact_child_NickName');

    });

    test('a self-lookup filled in by hand is left as it is in both iterations', () => {

        const objectInfoWrapper = buildObjectInfoWrapper([{ objectApiName: 'Account', lookups: { ParentId: 'Account' } }]);
        objectInfoWrapper.ObjectToObjectInfoMap['Account'].FullRecipe = objectInfoWrapper.ObjectToObjectInfoMap['Account'].FullRecipe
            .replace(`ParentId: ${RelationshipService.referenceIdRequiredTodo}`, 'ParentId: ParentAccount_FilledByHand');

        const [recipeFile] = new RelationshipService().generateSeparateRecipeFiles(objectInfoWrapper, true);
        const recipeEntries = yaml.load(recipeFile.content) as LoadedRecipeEntry[];

        expect([recipeEntries[0].fields.ParentId, recipeEntries[0].friends[0].fields.ParentId]).toEqual(['ParentAccount_FilledByHand', 'ParentAccount_FilledByHand']);

    });

    test('snowfakery recipes are unchanged: flat, one entry per object, the self-lookup a TODO', () => {

        const [recipeContent] = generateRecipeContents([
            { objectApiName: 'Account', lookups: { ParentId: 'Account' } },
            { objectApiName: 'Contact', lookups: { AccountId: 'Account' } }
        ], false);

        expect(recipeContent).not.toContain('friends:');
        expect(recipeContent).not.toContain('_child_NickName');
        expect(recipeContent.match(/^- object: Account$/gm)).toHaveLength(1);
        expect(recipeContent).toContain(`    ParentId: ${RelationshipService.referenceIdRequiredTodo}`);

    });

    test('end to end with count > 1: each child iteration resolves to its own parent Account once inserted', async () => {

        const [generatedRecipeContent] = generateRecipeContents([
            { objectApiName: 'Account', lookups: { ParentId: 'Account' } },
            { objectApiName: 'Contact', lookups: { AccountId: 'Account' } }
        ], true);
        // THREE TOP ACCOUNTS, TWO CHILD ACCOUNTS PER ACCOUNT
        const recipeContent = generatedRecipeContent
            .replace(/^(  count:) 1$/m, '$1 3')
            .replace(/^(      nickname: Account_child_NickName\n      count:) 1$/m, '$1 2');

        const fakerJSRecipeProcessor = new FakerJSRecipeProcessor();
        let processedYamlWrapper: ProcessedYamlWrapper = { ObjectPropertyToExistingProcessedYaml: {}, VariablePropertyToExistingProcessedYaml: {} };
        for ( const recipeEntry of yaml.load(recipeContent) as LoadedRecipeEntry[] ) {
            processedYamlWrapper = await fakerJSRecipeProcessor.processObjectDeclarationForYamlDocumentItem(recipeEntry.object, recipeEntry, processedYamlWrapper);
        }

        const fakerJson = JSON.stringify(Object.values(processedYamlWrapper.ObjectPropertyToExistingProcessedYaml).flat());
        const collectionsByObject = fakerJSRecipeProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakerJson);

        let referenceIdToOrgId: Record<string, string> = {};
        const insertedRecordsByObject: Record<string, Record<string, unknown>[]> = {};
        let insertedRecordCount = 0;

        ['Account', 'Contact'].forEach(objectApiName => {
            insertedRecordsByObject[objectApiName] = [];
            const resolvedFileRecords = JSON.parse(CollectionsApiService.updateLookupReferencesInCollectionApiJson(JSON.stringify(collectionsByObject.get(objectApiName)), referenceIdToOrgId)).records;
            CollectionsApiService.partitionRecordsIntoInsertRounds(resolvedFileRecords).forEach(insertRound => {
                const resolvedRecords = JSON.parse(CollectionsApiService.updateLookupReferencesInCollectionApiJson(JSON.stringify({ records: insertRound }), referenceIdToOrgId)).records;
                const fakeInsertResults = resolvedRecords.map(() => ({ id: `ID${insertedRecordCount++}`, success: true }));
                referenceIdToOrgId = CollectionsApiService.updateReferenceIdMapWithCreatedRecords(referenceIdToOrgId, fakeInsertResults, resolvedRecords);
                resolvedRecords.forEach((resolvedRecord, recordIndex) => insertedRecordsByObject[objectApiName].push({ ...resolvedRecord, Id: fakeInsertResults[recordIndex].id }));
            });
        });

        const accounts = insertedRecordsByObject['Account'];
        const topAccounts = accounts.filter(account => account.ParentId === null);
        const childAccounts = accounts.filter(account => account.ParentId !== null);
        const topAccountIds = topAccounts.map(account => account.Id);

        expect(accounts).toHaveLength(9);
        expect(topAccountIds).toEqual(['ID0', 'ID1', 'ID2']);
        expect(childAccounts.map(account => account.ParentId)).toEqual(['ID0', 'ID0', 'ID1', 'ID1', 'ID2', 'ID2']);
        expect(insertedRecordsByObject['Contact'].map(contact => contact.AccountId)).toEqual(['ID0', 'ID1', 'ID2']);

    });

    test('the Recipe Cockpit writer fixture for a self-lookup is this generator\'s output', () => {

        const [recipeContent] = generateRecipeContents([
            { objectApiName: 'Account', lookups: { ParentId: 'Account' } },
            { objectApiName: 'Contact', lookups: { AccountId: 'Account' } }
        ], true);

        expect(recipeContent).toBe(fs.readFileSync(path.join(__dirname, '../../RecipeCockpitService/tests/mocks/recipeWriter/recipe-fakerjs-selfLookup--RelationshipTree_1.yml'), 'utf-8'));

    });

    test('a self-lookup name that is not an api name never reaches the recipe, and alone adds no iteration (#120)', () => {

        const hostileFieldName = 'ParentId\n    - object: Pwned__c\n      fields:\n        Injected__c: ${{ globalThis.pwned = true }}\n    #';
        const withHostileSelfLookup = (objectSpecifications: ObjectSpecification[]) => {
            const objectInfoWrapper = buildObjectInfoWrapper(objectSpecifications);
            const parentObjectToFieldReferences = objectInfoWrapper.ObjectToObjectInfoMap['Account'].RelationshipDetail.parentObjectToFieldReferences;
            parentObjectToFieldReferences['Account'] = [...(parentObjectToFieldReferences['Account'] ?? []), hostileFieldName];
            return new RelationshipService().generateSeparateRecipeFiles(objectInfoWrapper, true)[0].content;
        };

        const onlyHostileRecipe = withHostileSelfLookup([{ objectApiName: 'Account' }]);
        expect(onlyHostileRecipe).not.toContain('Pwned__c');
        expect(onlyHostileRecipe).not.toContain('_child_NickName');
        expect(RelationshipService.getWritableSelfLookupFieldNames('Missing__c', buildObjectInfoWrapper([{ objectApiName: 'Account' }]))).toEqual([]);

        const mixedRecipe = withHostileSelfLookup([{ objectApiName: 'Account', lookups: { ParentId: 'Account' } }]);
        expect(mixedRecipe).not.toContain('Pwned__c');
        expect(mixedRecipe).toContain('    # Account (Child iteration of the Account above, through ParentId)\n');
        expect((yaml.load(mixedRecipe) as LoadedRecipeEntry[])[0].friends.map(friend => friend.object)).toEqual(['Account']);

    });

    test('hasSelfLookup is true only for an object with a lookup field to its own type', () => {

        const objectInfoWrapper = buildObjectInfoWrapper([
            { objectApiName: 'Account', lookups: { ParentId: 'Account' } },
            { objectApiName: 'Contact', lookups: { AccountId: 'Account' } }
        ]);

        expect(RelationshipService.hasSelfLookup('Account', objectInfoWrapper)).toBe(true);
        expect(RelationshipService.hasSelfLookup('Contact', objectInfoWrapper)).toBe(false);
        expect(RelationshipService.hasSelfLookup('Missing__c', objectInfoWrapper)).toBe(false);
        expect(RelationshipService.buildSelfLookupIterationNickname('Account')).toBe('Account_child_NickName');

    });

});

describe('a generated nested recipe resolves every lookup to the records it was generated under (#46)', () => {

    test('each grandchild points at its own parent and at that parent\'s top parent once inserted', async () => {

        const [generatedRecipeContent] = generateRecipeContents(ACCOUNT_OTHER_OTHER_CHILD, true);
        // THE COUNTS A PERSON SETS: TWO TOP ACCOUNTS, TWO OTHER__C PER ACCOUNT, TWO CHILDREN PER OTHER__C
        const recipeContent = generatedRecipeContent
            .replace(/^(  count:) 1$/m, '$1 2')
            .replace(/^(      count:) 1$/m, '$1 2')
            .replace(/^(          count:) 1$/m, '$1 2');

        const fakerJSRecipeProcessor = new FakerJSRecipeProcessor();
        let processedYamlWrapper: ProcessedYamlWrapper = { ObjectPropertyToExistingProcessedYaml: {}, VariablePropertyToExistingProcessedYaml: {} };
        for ( const recipeEntry of yaml.load(recipeContent) as LoadedRecipeEntry[] ) {
            processedYamlWrapper = await fakerJSRecipeProcessor.processObjectDeclarationForYamlDocumentItem(recipeEntry.object, recipeEntry, processedYamlWrapper);
        }

        const fakerJson = JSON.stringify(Object.values(processedYamlWrapper.ObjectPropertyToExistingProcessedYaml).flat());
        const collectionsByObject = fakerJSRecipeProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(fakerJson);

        let referenceIdToOrgId: Record<string, string> = {};
        const insertedRecordsByObject: Record<string, Record<string, unknown>[]> = {};

        ['Account', 'Other__c', 'OtherChildObject__c'].forEach((objectApiName, objectIndex) => {
            const resolvedJson = CollectionsApiService.updateLookupReferencesInCollectionApiJson(JSON.stringify(collectionsByObject.get(objectApiName)), referenceIdToOrgId);
            const resolvedRecords = JSON.parse(resolvedJson).records;
            const fakeInsertResults = resolvedRecords.map((_record, recordIndex) => ({ id: `${objectIndex}ID${recordIndex}`, success: true }));
            referenceIdToOrgId = CollectionsApiService.updateReferenceIdMapWithCreatedRecords(referenceIdToOrgId, fakeInsertResults, resolvedRecords);
            insertedRecordsByObject[objectApiName] = resolvedRecords.map((resolvedRecord, recordIndex) => ({ ...resolvedRecord, Id: fakeInsertResults[recordIndex].id }));
        });

        const accountIds = insertedRecordsByObject['Account'].map(account => account.Id);
        const otherById = new Map(insertedRecordsByObject['Other__c'].map(other => [other.Id, other]));

        expect(accountIds).toEqual(['0ID0', '0ID1']);
        expect(insertedRecordsByObject['Other__c'].map(other => other.Account__c)).toEqual(['0ID0', '0ID0', '0ID1', '0ID1']);
        expect(insertedRecordsByObject['OtherChildObject__c']).toHaveLength(8);
        insertedRecordsByObject['OtherChildObject__c'].forEach(otherChild => {
            expect(otherById.has(otherChild.Other__c as string)).toBe(true);
            expect(otherChild.Account__c).toBe(otherById.get(otherChild.Other__c as string).Account__c);
        });
        expect(new Set(insertedRecordsByObject['OtherChildObject__c'].map(otherChild => otherChild.Other__c)).size).toBe(4);

    });

});
