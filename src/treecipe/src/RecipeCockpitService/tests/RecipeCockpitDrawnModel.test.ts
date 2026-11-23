// THE DRAWN MODEL LOADS THE MODEL BUILD, WHICH READS SETTINGS THROUGH vscode
jest.mock('vscode', () => ({}), { virtual: true });

import { RecipeCockpitDrawnModel } from '../RecipeCockpitDrawnModel';
import { IRecipeCockpitRecipeViewModel } from '../RecipeCockpitViewModel';

describe('RecipeCockpitDrawnModel (#671)', () => {

    describe('collectInsertableFriendTargets', () => {

        const recipeWithIterations = (treeIterationNickname: string): IRecipeCockpitRecipeViewModel => ({
            objects: [{
                objectApiName: 'Account',
                recipeFilePath: '/workspace/treecipe/run/recipe.yaml',
                iterations: [{ nickname: 'Account_ParentId', insertableFriendObjectApiNames: ['Contact'] }]
            }],
            trees: [{ treeKey: 'tree-0', objects: [{ objectApiName: 'Account', iterationNickname: treeIterationNickname }] }]
        } as unknown as IRecipeCockpitRecipeViewModel);

        test('offers a friend of an iteration the card lists, keyed to the recipe it would be written into', () => {
            const targets = RecipeCockpitDrawnModel.collectInsertableFriendTargets(recipeWithIterations('Account_ParentId'));
            expect([...targets.values()]).toEqual(['/workspace/treecipe/run/recipe.yaml']);
            expect([...targets.keys()]).toEqual([RecipeCockpitDrawnModel.buildInsertableFriendKey('tree-0', 'Account', 'Account_ParentId', 'Contact')]);
        });

        test('offers nothing for a card naming an iteration its object does not have', () => {
            expect(RecipeCockpitDrawnModel.collectInsertableFriendTargets(recipeWithIterations('Account_Renamed')).size).toBe(0);
        });

    });

});
