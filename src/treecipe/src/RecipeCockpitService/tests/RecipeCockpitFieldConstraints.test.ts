import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn(), showInputBox: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitFieldViewModel,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel,
    RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITH_CONSTRAINTS
} from '../RecipeCockpitService';
import { RecipeCockpitRecipeWriter, RecipeFilterResult } from '../RecipeCockpitRecipeWriter';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    #323: the writer's constrained-expression path -- an expression a backend built from min/max, a
    length or a date window, written double-quoted on the filtered copy. #324's validation rules
    still use it; the cockpit's ✎ that stored bounds for it is gone since #356 (tested last).
*/

const recipeWriterMocksPath = path.join(__dirname, 'mocks', 'recipeWriter');
const SNOWFAKERY_FIXTURE = 'recipe-snowfakery--RelationshipTree_1.yml';
const SELF_LOOKUP_FRIENDS_FIXTURE = 'recipe-fakerjs-selfLookupFriends--RelationshipTree_1.yml';

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LEAD_TREE_KEY = 'Lead-ONLY';
const ACCOUNT_RECIPE_FILE_PATH = path.join(HISTORY_GENERATED_RECIPES_PATH, CURRENT_RUN_FOLDER_NAME, ACCOUNT_TREE_KEY, `recipe--${ACCOUNT_TREE_KEY}-2026-09-20T10-00-00.yml`);

const snowfakery = new SnowfakeryRecipeFakerService();
const SCORE_EXPRESSION = snowfakery.buildConstrainedExpression('Number', { kind: 'number', min: '1', max: '10', scale: 0 });
const CODE_EXPRESSION = snowfakery.buildConstrainedExpression('Text', { kind: 'length', min: 3, max: 50 });

function readFixture(fileName: string): string {
    return fs.readFileSync(path.join(recipeWriterMocksPath, fileName), 'utf8');
}

function expectFiltered(result: RecipeFilterResult): Extract<RecipeFilterResult, { isFiltered: true }> {
    if ( 'refusal' in result ) {
        throw new Error(`expected a filtered copy, got a refusal: ${result.refusal.message}`);
    }
    return result;
}

const expressionsOf = (entries: Record<string, Record<string, string>>) => new Map(Object.entries(entries).map(([objectApiName, byField]) => [objectApiName, new Map(Object.entries(byField))]));

// EACH OCCURRENCE'S FIELD LINES, AS THE SCANNER READS THEM BACK
function readFieldLines(recipeText: string, objectApiName: string, fieldApiName: string): string[][] {
    const { lines } = RecipeCockpitRecipeWriter.splitRecipeLines(recipeText);
    return RecipeCockpitRecipeWriter.scanRecipeObjects(lines)
        .filter(scannedObject => scannedObject.objectApiName === objectApiName)
        .map(scannedObject => scannedObject.fields.find(scannedField => scannedField.fieldApiName === fieldApiName))
        .filter((scannedField): scannedField is NonNullable<typeof scannedField> => !!scannedField)
        .map(scannedField => lines.slice(scannedField.startIndex, scannedField.endIndex));
}

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT,
    CURRENT_RUN_FOLDER_NAME
).recipeViewModel;

const buildWorkspaceState = (initialValues: Record<string, unknown> = {}) => {
    const storedValues = new Map<string, unknown>(Object.entries(initialValues));
    return {
        storedValues,
        get: jest.fn((key: string) => storedValues.get(key)) as jest.Mock,
        update: jest.fn((key: string, value: unknown) => {
            if ( value === undefined ) { storedValues.delete(key); } else { storedValues.set(key, JSON.parse(JSON.stringify(value))); }
            return Promise.resolve();
        }) as jest.Mock
    };
};

const treeOf = (recipe: IRecipeCockpitRecipeViewModel, treeKey: string) => recipe.trees.find(tree => tree.treeKey === treeKey) as IRecipeCockpitTreeViewModel;
const objectOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string) => recipe.objects.find(objectViewModel => objectViewModel.objectApiName === objectApiName) as IRecipeCockpitObjectViewModel;
const fieldOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string, fieldApiName: string) => objectOf(recipe, objectApiName).fields.find(field => field.fieldApiName === fieldApiName) as IRecipeCockpitFieldViewModel;

describe('RecipeCockpitRecipeWriter -- faker constraints (#323)', () => {

    describe('checkConstrainedExpression', () => {

        it.each([
            ['a backend expression', SCORE_EXPRESSION],
            ['a faker-js expression with spaced braces', new FakerJSRecipeFakerService().buildConstrainedExpression('Text', { kind: 'length', min: 1, max: 2 })]
        ])('accepts %s', (_caseName, expression) => {
            expect(RecipeCockpitRecipeWriter.checkConstrainedExpression(expression)).toBeUndefined();
        });

        it.each([
            ['no template', 'faker.number.int()', 'is not one "${{ ... }}" expression.'],
            ['text after the template', '${{ x }} tail', 'is not one "${{ ... }}" expression.'],
            ['a line break', '${{ x\n- object: Evil }}', 'contains a line break or control character.'],
            ['U+2028', '${{ x y }}', 'contains a line break or control character.'],
            ['a closing pair inside', '${{ f({a: {b: 1}}) }}', 'contains "}}" inside it.'],
            ['a second template', '${{ a }}${{ b }}', 'contains "${" inside it.'],
            ['a legacy snowfakery template', '${{ << 7*7 >> }}', 'contains "<<" inside it.'],
            ['a block opener', '${{ {% x %} }}', 'contains "{%" inside it.'],
            ['too long', `\${{ ${'x'.repeat(1000)} }}`, 'is longer than 1000 characters.']
        ])('refuses %s', (_caseName, expression, refusal) => {
            expect(RecipeCockpitRecipeWriter.checkConstrainedExpression(expression)).toBe(refusal);
        });

    });

    describe('buildFilteredRecipe with constrainedExpressionsByObject', () => {

        it('replaces the field on every occurrence of its object at that occurrence\'s depth, double-quoted, changes no other line, and reads it back', () => {

            const recipeText = readFixture(SELF_LOOKUP_FRIENDS_FIXTURE);
            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
                excludedObjectApiNames: [],
                parentLookupsByObjectApiName: new Map(),
                constrainedExpressionsByObject: expressionsOf({ Account: { Name: CODE_EXPRESSION } })
            }));
            const [headerComment, ...filteredLines] = filtered.recipeText.split('\n');

            expect(headerComment).toBe('# Recipe Cockpit -- a filtered copy of this tree\'s recipe, with constrained fields: Account.Name');
            expect(readFieldLines(filtered.recipeText, 'Account', 'Name')).toEqual([[`    Name: "${CODE_EXPRESSION}"`], [`        Name: "${CODE_EXPRESSION}"`]]);
            expect(filteredLines.filter(filteredLine => !recipeText.split('\n').includes(filteredLine))).toEqual([`    Name: "${CODE_EXPRESSION}"`, `        Name: "${CODE_EXPRESSION}"`]);
            expect(filteredLines).toHaveLength(recipeText.split('\n').length);
            expect(filtered.appliedConstrainedExpressions).toEqual([{ objectApiName: 'Account', fieldApiName: 'Name', expression: CODE_EXPRESSION }]);
            expect(filtered.appliedFixedValues).toEqual([]);

            const loaded = yaml.load(filtered.recipeText) as Array<{ fields: Record<string, unknown> }>;
            expect(loaded[0].fields.Name).toBe(CODE_EXPRESSION);

        });

        it('drops a multi-line field\'s continuation lines with its expression', () => {

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), {
                excludedObjectApiNames: [],
                parentLookupsByObjectApiName: new Map(),
                constrainedExpressionsByObject: expressionsOf({ Opportunity: { Description: CODE_EXPRESSION } })
            }));

            expect(readFieldLines(filtered.recipeText, 'Opportunity', 'Description')).toEqual([[`        Description: "${CODE_EXPRESSION}"`]]);
            expect(filtered.recipeText).not.toContain('faker.lorem.paragraph');

        });

        it('writes a flat snowfakery field at the top-level field column', () => {

            const recipeText = readFixture(SNOWFAKERY_FIXTURE);
            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
                excludedObjectApiNames: [],
                parentLookupsByObjectApiName: new Map(),
                constrainedExpressionsByObject: expressionsOf({ Account: { Name: CODE_EXPRESSION } })
            }));

            expect(readFieldLines(filtered.recipeText, 'Account', 'Name')).toEqual([[`    Name: "${CODE_EXPRESSION}"`]]);

        });

        it('lets a fixed value win, and leaves out an unticked field whatever it carries', () => {

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), {
                excludedObjectApiNames: [],
                parentLookupsByObjectApiName: new Map(),
                excludedFieldApiNamesByObject: new Map([['Lead', ['LastName']]]),
                fixedValuesByObject: new Map([['Account', new Map([['Name', { value: 'Acme', kind: 'text' as const }]])]]),
                constrainedExpressionsByObject: expressionsOf({ Account: { Name: CODE_EXPRESSION }, Lead: { LastName: CODE_EXPRESSION } })
            }));

            expect(readFieldLines(filtered.recipeText, 'Account', 'Name')[0]).toEqual(['    Name: "Acme"']);
            expect(readFieldLines(filtered.recipeText, 'Lead', 'LastName')).toEqual([]);
            expect(filtered.appliedConstrainedExpressions).toEqual([]);

        });

        it('returns the recipe byte for byte with none, and with one only for a field the recipe does not carry', () => {

            const recipeText = readFixture(SELF_LOOKUP_FRIENDS_FIXTURE);
            const filter = (constrainedExpressionsByObject: Map<string, Map<string, string>>) => expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
                excludedObjectApiNames: [],
                parentLookupsByObjectApiName: new Map(),
                constrainedExpressionsByObject: constrainedExpressionsByObject
            }));

            expect(filter(new Map()).recipeText).toBe(recipeText);
            expect(filter(expressionsOf({ Account: { Not_In_Recipe__c: CODE_EXPRESSION }, Task: { Subject: CODE_EXPRESSION } })).recipeText).toBe(recipeText);

        });

        it.each([
            ['an expression that is not one template', { Account: { Name: 'plain' } }, 'invalid-value'],
            ['an expression with a line break', { Account: { Name: '${{ x\n- object: Evil }}' } }, 'invalid-value'],
            ['a field name that is not an api name', { Account: { 'Name: x': CODE_EXPRESSION } }, 'invalid-field-api-name'],
            ['an object name that is not an api name', { 'Bad Name': { Name: CODE_EXPRESSION } }, 'invalid-object-api-name']
        ])('refuses %s before writing anything', (_caseName, constrainedExpressions, reason) => {

            const result = RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), {
                excludedObjectApiNames: [],
                parentLookupsByObjectApiName: new Map(),
                constrainedExpressionsByObject: expressionsOf(constrainedExpressions)
            });

            expect(result).toMatchObject({ isFiltered: false, refusal: { reason: reason } });

        });

    });

});

/*
    #356: the ✎ and its bounds are gone from the cockpit -- a field's one edit button edits its
    faker expression itself. What is left of #323 is the writer's constrained-expression path above,
    which #324's validation rules and ConstrainedExpressionGeneration still drive.
*/
describe('RecipeCockpitService -- faker bounds removed (#356)', () => {

    const storedVersion6 = {
        version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITH_CONSTRAINTS,
        excludedObjectApiNamesByFolderName: { [LEAD_TREE_KEY]: ['Lead'] },
        excludedFieldApiNamesByFolderName: { [ACCOUNT_TREE_KEY]: { Account: ['Legacy_Code__c'] } },
        objectCountsByFolderName: { [ACCOUNT_TREE_KEY]: { Account: 4 } },
        constraintsByFolderName: { [ACCOUNT_TREE_KEY]: { Account: { Annual_Budget__c: { min: '1', max: '9' } } } },
        validationRulesOffByFolderName: { [ACCOUNT_TREE_KEY]: { Account: ['Rating__c'] } }
    };

    it('reads a version 6 entry with everything but its bounds, and writes version 7 without them', async () => {

        const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedVersion6 });
        const read = RecipeCockpitService.readTreeSelections(workspaceState);

        expect(read).not.toHaveProperty('constraintsByFolderName');
        expect(read.excludedObjectApiNamesByFolderName).toEqual(new Map([[LEAD_TREE_KEY, new Set(['Lead'])]]));
        expect(read.excludedFieldApiNamesByFolderName).toEqual(new Map([[ACCOUNT_TREE_KEY, new Map([['Account', new Set(['Legacy_Code__c'])]])]]));
        expect(read.objectCountsByFolderName).toEqual(new Map([[ACCOUNT_TREE_KEY, new Map([['Account', 4]])]]));
        expect(read.validationRulesOffByFolderName).toEqual(new Map([[ACCOUNT_TREE_KEY, new Map([['Account', new Set(['Rating__c'])]])]]));

        await RecipeCockpitService.writeObjectSelections(workspaceState, read.excludedObjectApiNamesByFolderName);
        const written = workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY) as Record<string, unknown>;

        expect(RECIPE_COCKPIT_OBJECT_SELECTION_VERSION).toBe(RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITH_CONSTRAINTS + 1);
        expect(written.version).toBe(RECIPE_COCKPIT_OBJECT_SELECTION_VERSION);
        expect(written).not.toHaveProperty('constraintsByFolderName');
        expect(written.validationRulesOffByFolderName).toEqual({ [ACCOUNT_TREE_KEY]: { Account: ['Rating__c'] } });

    });

    it('routes nothing for a posted editFieldConstraints, even for a field it once took', () => {

        const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
        const recipe = loadRecipe();
        panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 4 };
        panelState.treeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipe);

        expect(RecipeCockpitService.routePanelMessage({ command: 'editFieldConstraints', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', min: '1', max: '2' } as any, panelState)).toBeUndefined();
        expect(RecipeCockpitService.routePanelMessage({ command: 'setFieldFixedValue', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: '${{ faker.string.alpha(3) }}' } as any, panelState)).toMatchObject({ kind: 'setFieldFixedValue' });

    });

    it('builds a card\'s Run Faker copy and data set record with no bounds', () => {

        const recipe = loadRecipe();
        RecipeCockpitService.applyObjectSelections(recipe, new Map([[ACCOUNT_TREE_KEY, new Set(['Contact'])]]));
        const filtered = RecipeCockpitService.buildRunFakerFilteredRecipe(fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8'), treeOf(recipe, ACCOUNT_TREE_KEY), undefined, recipe);

        expect(filtered).not.toHaveProperty('refusalMessage');
        expect(filtered).not.toHaveProperty('constraintsByObject');
        expect(treeOf(recipe, ACCOUNT_TREE_KEY)).not.toHaveProperty('constraints');

    });

    it('draws no ✎, no bounds editor and no "constrained" badge on any row', () => {

        const panel = runPanelScript();
        const recipe = loadRecipe();
        panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
        panel.postToPanel({ command: 'loadPhase', message: '' });
        panel.expandAllTrees();
        panel.objectElements().forEach(objectElement => panel.expandObject(objectElement));

        const body = panel.cockpitBodyElement;
        expect(panel.findAll(body, 'treeFieldConstraint')).toEqual([]);
        expect(panel.findAll(body, 'constraintBadge')).toEqual([]);
        expect(panel.findAll(body, 'constrainedExpression')).toEqual([]);
        expect(panel.findAll(body, 'treeFieldFixedValue').length).toBeGreaterThan(0);

    });

});
