import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as path from 'path';

import { RecipeCockpitObjectSelection, IObjectSelectionTreeObject } from '../RecipeCockpitObjectSelection';

const lookup = (fieldApiName: string, parentObjectApiName: string) => ({ fieldApiName: fieldApiName, parentObjectApiName: parentObjectApiName });

// Account > Contact, Opportunity > ChildOpps__c; Case under Account AND Contact; Account self-lookup
const TREE: IObjectSelectionTreeObject[] = [
    { objectApiName: 'Account', parentLookups: [lookup('ParentId', 'Account')] },
    { objectApiName: 'Contact', parentLookups: [lookup('AccountId', 'Account')] },
    { objectApiName: 'Opportunity', parentLookups: [lookup('AccountId', 'Account')] },
    { objectApiName: 'ChildOpps__c', parentLookups: [lookup('Opportunity__c', 'Opportunity')] },
    { objectApiName: 'Case', parentLookups: [lookup('AccountId', 'Account'), lookup('ContactId', 'Contact')] },
    { objectApiName: 'Lead', parentLookups: [] }
];

describe('RecipeCockpitObjectSelection.computeObjectSelection (#219)', () => {

    test('imports nothing', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitObjectSelection.ts'), 'utf8');
        expect(source).not.toMatch(/^\s*import\s/m);
        expect(source).not.toMatch(/\brequire\(/);
    });

    test('with nothing excluded, every object is included', () => {

        expect(RecipeCockpitObjectSelection.computeObjectSelection(TREE, [])).toEqual({
            exclusions: [],
            disabledLookups: [],
            includedObjectCount: 6,
            objectCount: 6
        });

    });

    test('excluding an object auto-excludes every descendant with no other included parent, naming that parent', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection(TREE, ['Opportunity']);

        expect(selection.exclusions).toEqual([
            { objectApiName: 'Opportunity', kind: 'excluded' },
            { objectApiName: 'ChildOpps__c', kind: 'autoExcluded', excludedParentObjectApiName: 'Opportunity' }
        ]);
        expect(selection.includedObjectCount).toBe(4);
        expect(selection.objectCount).toBe(6);

    });

    // #611: AN OBJECT WITH NO FIELD TICKED IS CUT OFF LIKE AN EXCLUDED ONE, UNDER ITS OWN KIND
    test('an object with no fields selected cuts off its children like an excluded one, and a chain-link exclusion outranks it', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection(TREE, ['Contact'], ['Opportunity', 'Contact', 'NotInTree__c']);

        expect(selection.exclusions).toEqual([
            { objectApiName: 'Contact', kind: 'excluded' },
            { objectApiName: 'Opportunity', kind: 'noFieldsSelected' },
            { objectApiName: 'ChildOpps__c', kind: 'autoExcluded', excludedParentObjectApiName: 'Opportunity' }
        ]);
        expect(selection.disabledLookups).toEqual([{ objectApiName: 'Case', fieldApiName: 'ContactId', parentObjectApiName: 'Contact' }]);
        expect(selection.includedObjectCount).toBe(3);

    });

    test('a descendant with another included parent stays included, with its lookup to the excluded parent disabled', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection(TREE, ['Contact']);

        expect(selection.exclusions).toEqual([{ objectApiName: 'Contact', kind: 'excluded' }]);
        expect(selection.disabledLookups).toEqual([{ objectApiName: 'Case', fieldApiName: 'ContactId', parentObjectApiName: 'Contact' }]);

    });

    test('a self-lookup is not another parent: excluding the root excludes the whole tree under it', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection(TREE, ['Account']);

        expect(selection.exclusions.map(exclusion => [exclusion.objectApiName, exclusion.kind, exclusion.excludedParentObjectApiName])).toEqual([
            ['Account', 'excluded', undefined],
            ['Contact', 'autoExcluded', 'Account'],
            ['Opportunity', 'autoExcluded', 'Account'],
            ['ChildOpps__c', 'autoExcluded', 'Opportunity'],
            ['Case', 'autoExcluded', 'Account']
        ]);
        expect(selection.includedObjectCount).toBe(1);

    });

    test('including the parent again brings back exactly what it auto-excluded, and a direct exclusion stays', () => {

        const both = RecipeCockpitObjectSelection.computeObjectSelection(TREE, ['Account', 'ChildOpps__c']);
        expect(both.exclusions.find(exclusion => exclusion.objectApiName === 'ChildOpps__c')).toEqual({ objectApiName: 'ChildOpps__c', kind: 'excluded' });

        const afterReinclude = RecipeCockpitObjectSelection.computeObjectSelection(TREE, ['ChildOpps__c']);
        expect(afterReinclude.exclusions).toEqual([{ objectApiName: 'ChildOpps__c', kind: 'excluded' }]);
        expect(afterReinclude.includedObjectCount).toBe(5);

    });

    test('an auto-excluded parent names the parent the reader excluded first', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection(TREE, ['Account', 'Contact']);

        expect(selection.exclusions.find(exclusion => exclusion.objectApiName === 'Case')).toEqual({ objectApiName: 'Case', kind: 'autoExcluded', excludedParentObjectApiName: 'Account' });

    });

    test('two objects cut off together do not keep each other included', () => {

        const cyclicTree: IObjectSelectionTreeObject[] = [
            { objectApiName: 'Root', parentLookups: [] },
            { objectApiName: 'Left', parentLookups: [lookup('Root__c', 'Root'), lookup('Right__c', 'Right')] },
            { objectApiName: 'Right', parentLookups: [lookup('Root__c', 'Root'), lookup('Left__c', 'Left')] }
        ];

        expect(RecipeCockpitObjectSelection.computeObjectSelection(cyclicTree, []).includedObjectCount).toBe(3);
        expect(RecipeCockpitObjectSelection.computeObjectSelection(cyclicTree, ['Root']).exclusions.map(exclusion => exclusion.kind)).toEqual(['excluded', 'autoExcluded', 'autoExcluded']);

    });

    test('ignores an excluded name that is not in the tree, and an object listed twice counts once', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection([...TREE, { objectApiName: 'Account', parentLookups: [] }], ['Gone__c']);

        expect(selection.exclusions).toEqual([]);
        expect(selection.objectCount).toBe(6);

    });

    test('a parent outside the tree is no parent: the object is a root, and its lookup to it is never disabled', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection([
            { objectApiName: 'Account', parentLookups: [lookup('OwnerId', 'User')] },
            { objectApiName: 'Contact', parentLookups: [lookup('AccountId', 'Account'), lookup('OwnerId', 'User')] }
        ], ['Contact']);

        expect(selection.exclusions).toEqual([{ objectApiName: 'Contact', kind: 'excluded' }]);
        expect(selection.disabledLookups).toEqual([]);
        expect(RecipeCockpitObjectSelection.computeObjectSelection([{ objectApiName: 'Account', parentLookups: [lookup('OwnerId', 'User')] }], ['User']).exclusions).toEqual([]);

    });

    test('merges the lookups of an object listed twice, once each', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection([
            { objectApiName: 'Account', parentLookups: [] },
            { objectApiName: 'Partner__c', parentLookups: [] },
            { objectApiName: 'Contact', parentLookups: [lookup('AccountId', 'Account')] },
            { objectApiName: 'Contact', parentLookups: [lookup('AccountId', 'Account'), lookup('Partner__c', 'Partner__c')] }
        ], ['Account']);

        expect(selection.exclusions).toEqual([{ objectApiName: 'Account', kind: 'excluded' }]);
        expect(selection.disabledLookups).toEqual([{ objectApiName: 'Contact', fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]);

    });

    test('names the first parent by "<" when no parent was excluded directly', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection([
            { objectApiName: 'Root', parentLookups: [] },
            { objectApiName: 'Zeta', parentLookups: [lookup('Root__c', 'Root')] },
            { objectApiName: 'Alpha', parentLookups: [lookup('Root__c', 'Root')] },
            { objectApiName: 'Leaf', parentLookups: [lookup('Zeta__c', 'Zeta'), lookup('Alpha__c', 'Alpha')] },
            { objectApiName: 'Twin', parentLookups: [lookup('Alpha__c', 'Alpha'), lookup('Alpha2__c', 'Alpha')] }
        ], ['Root']);

        expect(selection.exclusions.find(exclusion => exclusion.objectApiName === 'Leaf')?.excludedParentObjectApiName).toBe('Alpha');
        expect(selection.exclusions.find(exclusion => exclusion.objectApiName === 'Twin')?.excludedParentObjectApiName).toBe('Alpha');

    });

    test('cascades a wide root with tens of thousands of children in linear time', () => {

        const childCount = 30000;
        const wideTree: IObjectSelectionTreeObject[] = [
            { objectApiName: 'Root', parentLookups: [] },
            ...Array.from({ length: childCount }, (_, index) => ({ objectApiName: `Child${index}__c`, parentLookups: [lookup('Root__c', 'Root'), lookup('Root__c', 'Root')] }))
        ];
        const startedAt = Date.now();

        const selection = RecipeCockpitObjectSelection.computeObjectSelection(wideTree, ['Root']);

        // ARRAY-SPREAD APPENDS AND A PAIRWISE DEDUP TOOK SECONDS ON THIS SHAPE
        expect(Date.now() - startedAt).toBeLessThan(1500);
        expect(selection.exclusions).toHaveLength(childCount + 1);
        expect(selection.includedObjectCount).toBe(0);

    });

    test('an object named like an Object.prototype member is just a name', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection([
            { objectApiName: 'constructor', parentLookups: [] },
            { objectApiName: 'toString', parentLookups: [lookup('Parent__c', 'constructor')] }
        ], ['constructor']);

        expect(selection.exclusions.map(exclusion => exclusion.objectApiName)).toEqual(['constructor', 'toString']);

    });

});

describe('RecipeCockpitObjectSelection.computeObjectSelection, removed lookup fields (#677)', () => {

    const removed = (objectApiName: string, fieldApiName: string) => ({ objectApiName: objectApiName, fieldApiName: fieldApiName });

    test('removing an object\'s only lookup into the tree cuts it off with its subtree, naming the removed field', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection(TREE, [], [], [removed('Opportunity', 'AccountId')]);

        expect(selection.exclusions).toEqual([
            { objectApiName: 'Opportunity', kind: 'autoExcluded', removedLookupFieldApiName: 'AccountId' },
            { objectApiName: 'ChildOpps__c', kind: 'autoExcluded', excludedParentObjectApiName: 'Opportunity' }
        ]);
        expect(selection.disabledLookups).toEqual([]);
        expect(selection.includedObjectCount).toBe(4);

    });

    test('an object that keeps another lookup to an included parent stays, and the removed lookup is not listed as disabled', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection(TREE, [], [], [removed('Case', 'ContactId')]);

        expect(selection.exclusions).toEqual([]);
        expect(selection.disabledLookups).toEqual([]);
        expect(selection.includedObjectCount).toBe(6);

    });

    test('removing every lookup of an object with two parents cuts it off, naming the first removed field by "<"', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection(TREE, [], [], [removed('Case', 'ContactId'), removed('Case', 'AccountId')]);

        expect(selection.exclusions).toEqual([{ objectApiName: 'Case', kind: 'autoExcluded', removedLookupFieldApiName: 'AccountId' }]);

    });

    test('a kept lookup to an excluded parent names that parent, not the removed field', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection(TREE, ['Contact'], [], [removed('Case', 'AccountId')]);

        expect(selection.exclusions).toEqual([
            { objectApiName: 'Contact', kind: 'excluded' },
            { objectApiName: 'Case', kind: 'autoExcluded', excludedParentObjectApiName: 'Contact' }
        ]);
        expect(selection.disabledLookups).toEqual([]);

    });

    test('a removed self-lookup, or a lookup to a parent outside the tree, cuts nothing off', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection([
            ...TREE,
            { objectApiName: 'Note__c', parentLookups: [lookup('Owner__c', 'User')] }
        ], [], [], [removed('Account', 'ParentId'), removed('Note__c', 'Owner__c'), removed('Lead', 'NotALookup__c')]);

        expect(selection.exclusions).toEqual([]);
        expect(selection.includedObjectCount).toBe(7);

    });

    test('restoring the field brings back exactly what its removal cut off, and a direct exclusion stays', () => {

        const withRemoval = RecipeCockpitObjectSelection.computeObjectSelection(TREE, ['ChildOpps__c'], [], [removed('Opportunity', 'AccountId')]);
        expect(withRemoval.exclusions.map(exclusion => exclusion.objectApiName)).toEqual(['Opportunity', 'ChildOpps__c']);
        expect(withRemoval.exclusions[1]).toEqual({ objectApiName: 'ChildOpps__c', kind: 'excluded' });

        const restored = RecipeCockpitObjectSelection.computeObjectSelection(TREE, ['ChildOpps__c'], [], []);
        expect(restored.exclusions).toEqual([{ objectApiName: 'ChildOpps__c', kind: 'excluded' }]);

    });

    // RelationshipService LEAVES THE CYCLE-CLOSING LOOKUP (TO THE SAME OR A LATER OBJECT IN INSERT ORDER) A TODO (#104)
    const CYCLE_TREE: IObjectSelectionTreeObject[] = [
        { objectApiName: 'Account', parentLookups: [lookup('Primary_Contact__c', 'Contact')] },
        { objectApiName: 'Contact', parentLookups: [lookup('AccountId', 'Account')] },
        { objectApiName: 'Case', parentLookups: [lookup('ContactId', 'Contact')] }
    ];

    test('removing the cycle-closing lookup of an Account ⇄ Contact cycle cuts nothing off', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection(CYCLE_TREE, [], [], [removed('Account', 'Primary_Contact__c')]);

        expect(selection.exclusions).toEqual([]);
        expect(selection.includedObjectCount).toBe(3);

    });

    test('removing the other lookup of the cycle cuts off Contact and Case, and keeps the root, its lookup to Contact disabled', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection(CYCLE_TREE, [], [], [removed('Contact', 'AccountId')]);

        expect(selection.exclusions).toEqual([
            { objectApiName: 'Contact', kind: 'autoExcluded', removedLookupFieldApiName: 'AccountId' },
            { objectApiName: 'Case', kind: 'autoExcluded', excludedParentObjectApiName: 'Contact' }
        ]);
        expect(selection.disabledLookups).toEqual([{ objectApiName: 'Account', fieldApiName: 'Primary_Contact__c', parentObjectApiName: 'Contact' }]);
        expect(selection.includedObjectCount).toBe(1);

    });

    test('two objects whose removed lookups leave them pointing only at each other do not keep each other included', () => {

        const cyclicTree: IObjectSelectionTreeObject[] = [
            { objectApiName: 'Root', parentLookups: [] },
            { objectApiName: 'Left', parentLookups: [lookup('Root__c', 'Root'), lookup('Right__c', 'Right')] },
            { objectApiName: 'Right', parentLookups: [lookup('Root__c', 'Root'), lookup('Left__c', 'Left')] }
        ];

        const selection = RecipeCockpitObjectSelection.computeObjectSelection(cyclicTree, [], [], [removed('Left', 'Root__c'), removed('Right', 'Root__c')]);

        expect(selection.exclusions.map(exclusion => [exclusion.objectApiName, exclusion.kind])).toEqual([['Left', 'autoExcluded'], ['Right', 'autoExcluded']]);
        expect(selection.includedObjectCount).toBe(1);

    });

});
