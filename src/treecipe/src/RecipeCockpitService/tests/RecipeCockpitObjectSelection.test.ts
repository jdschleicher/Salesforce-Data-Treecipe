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

    test('an object named like an Object.prototype member is just a name', () => {

        const selection = RecipeCockpitObjectSelection.computeObjectSelection([
            { objectApiName: 'constructor', parentLookups: [] },
            { objectApiName: 'toString', parentLookups: [lookup('Parent__c', 'constructor')] }
        ], ['constructor']);

        expect(selection.exclusions.map(exclusion => exclusion.objectApiName)).toEqual(['constructor', 'toString']);

    });

});
