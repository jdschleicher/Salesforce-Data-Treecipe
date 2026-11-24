import { RelationshipService } from '../RelationshipService';
import { ObjectInfoWrapper } from '../../ObjectInfoWrapper/ObjectInfoWrapper';
import { FieldInfo } from '../../ObjectInfoWrapper/FieldInfo';

jest.mock('vscode', () => ({}), { virtual: true });

/*
    One card's recipe build combines its tree alone (#702): generateSeparateRecipeFiles given a tree
    folder name writes that tree's recipe exactly as a full run does, under the same file name, and
    no other tree's. The objects wrapper is built by hand, as in RelationshipService.nestedFriends.test.ts.
*/

type ObjectSpecification = {
    objectApiName: string;
    // LOOKUP FIELD API NAME -> PARENT OBJECT API NAME
    lookups?: Record<string, string>;
};

const buildObjectInfoWrapper = (objectSpecifications: ObjectSpecification[]): ObjectInfoWrapper => {

    const relationshipService = new RelationshipService();
    const objectInfoWrapper = new ObjectInfoWrapper();

    objectSpecifications.forEach(({ objectApiName, lookups }) => {
        objectInfoWrapper.addKeyToObjectInfoMap(objectApiName);
        const objectInfo = objectInfoWrapper.ObjectToObjectInfoMap[objectApiName];
        objectInfo.RelationshipDetail = relationshipService.buildNewRelationshipDetail(objectApiName);
        objectInfo.FullRecipe = [
            '',
            `- object: ${objectApiName}`,
            `  nickname: ${objectApiName}_NickName`,
            '  count: 1',
            '  fields:',
            '    Name: ${{ faker.company.name() }}',
            ...Object.keys(lookups ?? {}).map(lookupFieldApiName => `    ${lookupFieldApiName}: ${RelationshipService.referenceIdRequiredTodo}`)
        ].join('\n');
    });

    objectSpecifications.forEach(({ objectApiName, lookups }) => {
        Object.entries(lookups ?? {}).forEach(([lookupFieldApiName, parentObjectApiName]) => {
            const lookupField = new FieldInfo(objectApiName, lookupFieldApiName, lookupFieldApiName, 'Lookup');
            relationshipService.buildBidirectionalChildAndParentRelationshipReferences(lookupField, objectInfoWrapper, objectApiName, parentObjectApiName);
        });
    });

    relationshipService.processAllRelationships(objectInfoWrapper);
    return objectInfoWrapper;

};

// TWO TREES: Account WITH Contact UNDER IT, AND Lead ON ITS OWN
const TWO_TREES: ObjectSpecification[] = [
    { objectApiName: 'Account' },
    { objectApiName: 'Contact', lookups: { AccountId: 'Account' } },
    { objectApiName: 'Lead' }
];

describe.each([
    ['flat (snowfakery)', false, false],
    ['nested under friends: (faker-js)', true, false],
    ['flat, a child copy per record type block', false, true],
    ['nested, a child copy per record type block', true, true]
])('RelationshipService.generateSeparateRecipeFiles with a tree folder name, %s (#702)', (_layout, nestChildObjectsAsFriends, isChildTreeCopiedPerRecordTypeBlock) => {

    const generate = (onlyTreeFolderName?: string) =>
        new RelationshipService().generateSeparateRecipeFiles(buildObjectInfoWrapper(TWO_TREES), nestChildObjectsAsFriends, isChildTreeCopiedPerRecordTypeBlock, onlyTreeFolderName);

    it('writes each named tree alone, byte for byte and under the file name a full run gives it', () => {

        const fullRun = generate();
        expect(fullRun.map(recipeFile => RelationshipService.buildRecipeTreeFolderName(recipeFile.objects))).toEqual(['Account-thru-Contact', 'Lead-ONLY']);

        fullRun.forEach(fullRunRecipeFile => {
            expect(generate(RelationshipService.buildRecipeTreeFolderName(fullRunRecipeFile.objects))).toEqual([fullRunRecipeFile]);
        });
        expect(generate('Lead-ONLY')[0].fileName).toBe('recipe_relationshiptree_2.yml');

    });

    it('writes no recipe for a name no tree has', () => {

        expect(generate('Account-thru-Gone__c')).toEqual([]);

    });

});
