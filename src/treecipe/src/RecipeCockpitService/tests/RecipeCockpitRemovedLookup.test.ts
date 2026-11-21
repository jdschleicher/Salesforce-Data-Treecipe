import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as path from 'path';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn(), showInputBox: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeObjectViewModel,
    IRecipeCockpitTreeViewModel
} from '../RecipeCockpitService';
import { RecipeCockpitTreecipeSelection } from '../RecipeCockpitTreecipeSelection';
import { RecipeCockpitTreecipeInsert } from '../RecipeCockpitTreecipeInsert';
import { RecipeCockpitRecipeWriter } from '../../RecipeWriter/RecipeCockpitRecipeWriter';

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT,
    CURRENT_RUN_FOLDER_NAME
).recipeViewModel;

const treeOf = (recipe: IRecipeCockpitRecipeViewModel) => recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY) as IRecipeCockpitTreeViewModel;

const untick = (recipe: IRecipeCockpitRecipeViewModel, fieldsByObject: Record<string, string[]>) => RecipeCockpitService.applyObjectSelections(
    recipe,
    new Map(),
    new Map([[ACCOUNT_TREE_KEY, new Map(Object.entries(fieldsByObject).map(([objectApiName, fieldApiNames]) => [objectApiName, new Set(fieldApiNames)]))]])
);

describe('RecipeCockpitService, an unticked lookup field (#677)', () => {

    it('cuts off Contact and the child under it, and names the removed field in the insert confirmation\'s Left out section', () => {

        const recipe = loadRecipe();
        untick(recipe, { Contact: ['AccountId'] });
        const tree = treeOf(recipe);

        expect(tree.objectSelection?.exclusions).toEqual([
            { objectApiName: 'Contact', kind: 'autoExcluded', removedLookupFieldApiName: 'AccountId' },
            { objectApiName: 'OtherChildObject__c', kind: 'autoExcluded', excludedParentObjectApiName: 'Contact' }
        ]);
        expect(RecipeCockpitTreecipeSelection.listFieldReadOnlyObjectApiNames(tree)).toEqual(['OtherChildObject__c']);
        expect(RecipeCockpitTreecipeInsert.buildInsertLeftOutLines(RecipeCockpitService, tree).lines).toEqual(expect.arrayContaining([
            'Contact: not generated, cut off by removing Contact.AccountId',
            'OtherChildObject__c: not generated, auto-excluded with its parent Contact'
        ]));

    });

    it('reads the first occurrence\'s untick under its nickname once the object has iterations, as the field rows do', () => {

        const caseObject = {
            objectApiName: 'Case',
            nickname: 'Case_First',
            iterations: [{ nickname: 'Case_Child' }]
        } as unknown as IRecipeCockpitObjectViewModel;
        const objectsByApiName = new Map([['Case', caseObject]]);
        const drawnTreeObjects = [
            { objectApiName: 'Case', parentLookups: [{ fieldApiName: 'ContactId', parentObjectApiName: 'Contact' }] }
        ] as unknown as IRecipeCockpitTreeObjectViewModel[];
        const storedFieldsByObject = new Map([[RecipeCockpitRecipeWriter.buildOccurrenceKey('Case', 'Case_First'), new Set(['ContactId'])]]);

        expect(RecipeCockpitService.listRemovedTreeLookups(objectsByApiName, drawnTreeObjects, storedFieldsByObject))
            .toEqual([{ objectApiName: 'Case', fieldApiName: 'ContactId' }]);
        expect(RecipeCockpitService.listRemovedTreeLookups(objectsByApiName, drawnTreeObjects, new Map([[RecipeCockpitRecipeWriter.buildOccurrenceKey('Case', 'Case_Child'), new Set(['ContactId'])]])))
            .toEqual([]);

    });

});
