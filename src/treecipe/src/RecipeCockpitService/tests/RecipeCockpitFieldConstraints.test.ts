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
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel,
    RECIPE_COCKPIT_CONSTRAINT_BADGE_LABEL,
    RECIPE_COCKPIT_CONSTRAINT_FIXED_VALUE_REASON,
    RECIPE_COCKPIT_CONSTRAINT_FORMAT_REASON,
    RECIPE_COCKPIT_CONSTRAINT_GLYPH_PATH,
    RECIPE_COCKPIT_CONSTRAINT_RECIPE_FILE_ONLY_REASON,
    RECIPE_COCKPIT_CONSTRAINT_TYPE_REASON,
    RECIPE_COCKPIT_FIELD_CONTROLS_REASON_PREFIX,
    RECIPE_COCKPIT_FIELD_EDIT_NOT_SAVED_REFUSAL,
    RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX,
    RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_RECORD_TYPE_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON,
    RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_CONSTRAINTS,
    RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL,
    RECIPE_COCKPIT_RUN_FAKER_COMMAND,
    RECIPE_COCKPIT_UNGROUPED_TREE_TITLE
} from '../RecipeCockpitService';
import { RecipeCockpitRecipeWriter, RecipeFilterResult } from '../RecipeCockpitRecipeWriter';
import { IStoredRecipeFieldConstraint, RECIPE_FIELD_CONSTRAINT_MAX_BOUND_LENGTH } from '../../RecipeFakerService.ts/RecipeFieldConstraint/RecipeFieldConstraint';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

/*
    #323: a ✎ on each field's faker expression sets the range it generates in -- min/max for a
    number, a length for text, from/to for a date. The bounds are asked for in the host's own boxes,
    kept by tree folder beside the excluded objects, unticked fields, counts and fixed values, built
    into an expression by the recipe's own backend, and ride on the filtered copy: the recipe file is
    never written.
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

const storedSelections = (constraintsByFolderName: Record<string, unknown>, fixedValuesByFolderName: Record<string, unknown> = {}, excludedObjectApiNamesByFolderName: Record<string, unknown> = {}, excludedFieldApiNamesByFolderName: Record<string, unknown> = {}) => ({
    version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    excludedObjectApiNamesByFolderName: excludedObjectApiNamesByFolderName,
    excludedFieldApiNamesByFolderName: excludedFieldApiNamesByFolderName,
    objectCountsByFolderName: {},
    fixedValuesByFolderName: fixedValuesByFolderName,
    constraintsByFolderName: constraintsByFolderName,
    validationRulesOffByFolderName: {}
});

const treeOf = (recipe: IRecipeCockpitRecipeViewModel, treeKey: string) => recipe.trees.find(tree => tree.treeKey === treeKey) as IRecipeCockpitTreeViewModel;
const objectOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string) => recipe.objects.find(objectViewModel => objectViewModel.objectApiName === objectApiName) as IRecipeCockpitObjectViewModel;
const fieldOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string, fieldApiName: string) => objectOf(recipe, objectApiName).fields.find(field => field.fieldApiName === fieldApiName) as IRecipeCockpitFieldViewModel;

const toMaps = <T>(byFolder: Record<string, Record<string, Record<string, T>>>) => new Map(Object.entries(byFolder).map(([folderName, byObject]) => [folderName, new Map(Object.entries(byObject).map(([objectApiName, byField]) => [objectApiName, new Map(Object.entries(byField))]))]));

const applyConstraints = (recipe: IRecipeCockpitRecipeViewModel,
                            constraintsByFolderName: Record<string, Record<string, Record<string, IStoredRecipeFieldConstraint>>>,
                            fixedValuesByFolderName: Record<string, Record<string, Record<string, string>>> = {},
                            excludedObjectApiNamesByFolderName: Record<string, string[]> = {},
                            excludedFieldApiNamesByFolderName: Record<string, Record<string, string[]>> = {}) => RecipeCockpitService.applyObjectSelections(
    recipe,
    new Map(Object.entries(excludedObjectApiNamesByFolderName).map(([folderName, objectApiNames]) => [folderName, new Set(objectApiNames)])),
    new Map(Object.entries(excludedFieldApiNamesByFolderName).map(([folderName, byObject]) => [folderName, new Map(Object.entries(byObject).map(([objectApiName, fieldApiNames]) => [objectApiName, new Set(fieldApiNames)]))])),
    undefined,
    new Map(),
    toMaps(fixedValuesByFolderName),
    toMaps(constraintsByFolderName)
);

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

describe('RecipeCockpitService -- faker constraints (#323)', () => {

    describe('readTreeSelections and writeTreeSelections', () => {

        it('writes the current version with names named __proto__ as keys, and reads back every api name and storable bound', async () => {

            const workspaceState = buildWorkspaceState();
            await expect(RecipeCockpitService.writeTreeSelections(workspaceState, {
                excludedObjectApiNamesByFolderName: new Map(),
                excludedFieldApiNamesByFolderName: new Map(),
                objectCountsByFolderName: new Map(),
                fixedValuesByFolderName: new Map(),
                constraintsByFolderName: new Map([
                    [ACCOUNT_TREE_KEY, new Map([['Account', new Map<string, IStoredRecipeFieldConstraint>([['Legacy_Code__c', { min: '3' }], ['__proto__', { max: '5' }]])]])],
                    ['__proto__', new Map([['Lead', new Map<string, IStoredRecipeFieldConstraint>([['Company', { min: '1', max: '9' }]])]])],
                    ['Empty-Tree', new Map([['Lead', new Map<string, IStoredRecipeFieldConstraint>()]])]
                ]),
                validationRulesOffByFolderName: new Map()
            })).resolves.toBeTrue();

            const stored = workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY) as any;
            expect(stored.version).toBe(RECIPE_COCKPIT_OBJECT_SELECTION_VERSION);
            expect(Object.keys(stored.constraintsByFolderName)).toEqual([ACCOUNT_TREE_KEY, '__proto__']);
            expect(Object.keys(stored.constraintsByFolderName[ACCOUNT_TREE_KEY].Account)).toEqual(['Legacy_Code__c', '__proto__']);

            expect(RecipeCockpitService.readTreeSelections(workspaceState).constraintsByFolderName).toEqual(new Map([
                [ACCOUNT_TREE_KEY, new Map([['Account', new Map([['Legacy_Code__c', { min: '3' }]])]])],
                ['__proto__', new Map([['Lead', new Map([['Company', { min: '1', max: '9' }]])]])]
            ]));

        });

        it('drops what no field could take, keeps the rest, and reads only the two bounds', () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({
                [ACCOUNT_TREE_KEY]: {
                    Account: {
                        Legacy_Code__c: { min: '3', extra: 'dropped' },
                        Annual_Budget__c: { min: '${{ 7*7 }}' },
                        Name: { min: 3 },
                        Rating__c: {},
                        Regions__c: 'min 1',
                        'Bad Name': { min: '1' }
                    },
                    'Bad Object': { Name: { min: '1' } }
                },
                '': { Lead: { Company: { min: '1' } } }
            }) });

            expect(RecipeCockpitService.readTreeSelections(workspaceState).constraintsByFolderName).toEqual(new Map([
                [ACCOUNT_TREE_KEY, new Map([['Account', new Map([['Legacy_Code__c', { min: '3' }]])]])]
            ]));

        });

        it('reads a version 4 entry, written before constraints, as no constraints and the same fixed values, and keeps the fixed values on a write', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: {
                ...storedSelections({ [ACCOUNT_TREE_KEY]: { Account: { Legacy_Code__c: { min: '3' } } } }, { [ACCOUNT_TREE_KEY]: { Account: { Name: 'Acme' } } }),
                version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_CONSTRAINTS
            } });

            const read = RecipeCockpitService.readTreeSelections(workspaceState);
            expect(read.constraintsByFolderName).toEqual(new Map());
            expect(read.fixedValuesByFolderName.get(ACCOUNT_TREE_KEY)?.get('Account')?.get('Name')).toBe('Acme');

            await RecipeCockpitService.writeObjectSelections(workspaceState, new Map([[LEAD_TREE_KEY, new Set(['Lead'])]]));
            expect((workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY) as any).fixedValuesByFolderName).toEqual({ [ACCOUNT_TREE_KEY]: { Account: { Name: 'Acme' } } });

        });

    });

    describe('findConstraintLockReason, buildTreeConstraints and applyObjectSelections', () => {

        const lockReasonOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string, fieldApiName: string, treeKey = ACCOUNT_TREE_KEY) =>
            RecipeCockpitService.findConstraintLockReason(treeOf(recipe, treeKey), objectOf(recipe, objectApiName), fieldOf(recipe, objectApiName, fieldApiName));

        it('locks every field the pin locks, a standard-field mapping, Email/Phone/Url and a type with no constraint, and frees number, text and date fields', () => {

            const recipe = loadRecipe();
            applyConstraints(recipe, {});
            const legacyCode = fieldOf(recipe, 'Account', 'Legacy_Code__c');
            objectOf(recipe, 'Account').fields.push(
                { ...legacyCode, fieldApiName: 'RecordTypeId', fieldType: '', fieldTypeWithSize: '' },
                { ...legacyCode, fieldApiName: 'Website__c', fieldType: 'Url', fieldTypeWithSize: 'Url' },
                { ...legacyCode, fieldApiName: 'Email__c', fieldType: 'Email', fieldTypeWithSize: 'Email' },
                { ...legacyCode, fieldApiName: 'Phone__c', fieldType: 'Phone', fieldTypeWithSize: 'Phone' },
                { ...legacyCode, fieldApiName: 'Founded__c', fieldType: 'Date', fieldTypeWithSize: 'Date' },
                { ...legacyCode, fieldApiName: 'Active__c', fieldType: 'Checkbox', fieldTypeWithSize: 'Checkbox' }
            );

            expect(lockReasonOf(recipe, 'Account', 'ParentId')).toBe(RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_REASON);
            expect(lockReasonOf(recipe, 'Contact', 'AccountId')).toBe(RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_REASON);
            expect(lockReasonOf(recipe, 'Account', 'RecordTypeId')).toBe(RECIPE_COCKPIT_FIXED_VALUE_RECORD_TYPE_REASON);
            expect(lockReasonOf(recipe, 'Account', 'Sub_Rating__c')).toBe(`${RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX}Rating__c`);
            expect(lockReasonOf(recipe, 'Account', 'Rating__c')).toBe(`${RECIPE_COCKPIT_FIELD_CONTROLS_REASON_PREFIX}Sub_Rating__c`);
            expect(lockReasonOf(recipe, 'Account', 'Name')).toBe(RECIPE_COCKPIT_CONSTRAINT_RECIPE_FILE_ONLY_REASON);
            expect(lockReasonOf(recipe, 'Account', 'Website__c')).toBe(`${RECIPE_COCKPIT_CONSTRAINT_FORMAT_REASON}Url`);
            expect(lockReasonOf(recipe, 'Account', 'Email__c')).toBe(`${RECIPE_COCKPIT_CONSTRAINT_FORMAT_REASON}Email`);
            expect(lockReasonOf(recipe, 'Account', 'Phone__c')).toBe(`${RECIPE_COCKPIT_CONSTRAINT_FORMAT_REASON}Phone`);
            expect(lockReasonOf(recipe, 'Account', 'Regions__c')).toBe(RECIPE_COCKPIT_CONSTRAINT_TYPE_REASON);
            expect(lockReasonOf(recipe, 'Account', 'Active__c')).toBe(RECIPE_COCKPIT_CONSTRAINT_TYPE_REASON);
            ['Legacy_Code__c', 'Annual_Budget__c', 'Founded__c'].forEach(fieldApiName => expect(lockReasonOf(recipe, 'Account', fieldApiName)).toBeUndefined());
            expect(lockReasonOf(recipe, 'OtherChildObject__c', 'Score__c')).toBeUndefined();
            expect(lockReasonOf(recipe, 'Lead', 'Company', LEAD_TREE_KEY)).toBeUndefined();

        });

        it('locks a field with a fixed value, an unticked field and every field of an excluded object', () => {

            const recipe = loadRecipe();
            applyConstraints(recipe, {}, { [ACCOUNT_TREE_KEY]: { Account: { Annual_Budget__c: '12.5' } } }, { [ACCOUNT_TREE_KEY]: ['Contact'] }, { [ACCOUNT_TREE_KEY]: { Account: ['Legacy_Code__c'] } });

            expect(lockReasonOf(recipe, 'Account', 'Annual_Budget__c')).toBe(RECIPE_COCKPIT_CONSTRAINT_FIXED_VALUE_REASON);
            expect(lockReasonOf(recipe, 'Account', 'Legacy_Code__c')).toBe(RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON);
            expect(lockReasonOf(recipe, 'Contact', 'LastName')).toBe(RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON);

        });

        it('reads the field size its XML recorded', () => {

            const recipe = loadRecipe();

            expect(RecipeCockpitService.buildFieldConstraintTarget(fieldOf(recipe, 'Account', 'Annual_Budget__c'))).toEqual({ fieldType: 'Currency', precision: 18, scale: 2 });
            expect(RecipeCockpitService.buildFieldConstraintTarget(fieldOf(recipe, 'OtherChildObject__c', 'Ratio__c'))).toEqual({ fieldType: 'Percent', precision: 5, scale: 2 });
            expect(RecipeCockpitService.buildFieldConstraintTarget(fieldOf(recipe, 'Account', 'Legacy_Code__c'))).toEqual({ fieldType: 'Text', length: 50 });
            expect(RecipeCockpitService.buildFieldConstraintTarget({ ...fieldOf(recipe, 'Account', 'Legacy_Code__c'), fieldTypeWithSize: 'Text' })).toEqual({ fieldType: 'Text' });

        });

        it('sets tree.constraints only for a free field of its folder, with the expression the recipe\'s own backend builds', () => {

            const recipe = loadRecipe();
            applyConstraints(recipe, { [ACCOUNT_TREE_KEY]: {
                Account: { Legacy_Code__c: { min: '3' }, ParentId: { min: '1' }, Name: { min: '1' }, Not_A_Field__c: { min: '1' } },
                OtherChildObject__c: { Score__c: { min: '1', max: '10' }, Ratio__c: { max: '50.5' } },
                Lead: { Company: { min: '1' } }
            } });

            expect(treeOf(recipe, ACCOUNT_TREE_KEY).constraints).toEqual([
                { objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', min: '3', expression: '${{fake.pystr(min_chars=3, max_chars=50)}}' },
                { objectApiName: 'OtherChildObject__c', fieldApiName: 'Score__c', min: '1', max: '10', expression: SCORE_EXPRESSION },
                { objectApiName: 'OtherChildObject__c', fieldApiName: 'Ratio__c', max: '50.5', expression: '${{fake.pydecimal(min_value=0, max_value=50.5, right_digits=2)}}' }
            ]);
            expect(treeOf(recipe, LEAD_TREE_KEY)).not.toHaveProperty('constraints');

        });

        it('builds a faker-js expression for a faker-js recipe', () => {

            const recipe = loadRecipe();
            objectOf(recipe, 'Lead').recipeFilePath = path.join(path.dirname(objectOf(recipe, 'Lead').recipeFilePath), 'recipe-fakerjs--Lead-ONLY.yml');
            applyConstraints(recipe, { [LEAD_TREE_KEY]: { Lead: { Company: { min: '2', max: '4' } } } });

            expect(treeOf(recipe, LEAD_TREE_KEY).constraints?.[0].expression).toBe('${{ faker.string.alpha({ length: { min: 2, max: 4 } }) }}');

        });

        it('holds back bounds the field no longer takes, and a constraint under a fixed value, an unticked field or an excluded object, which come back once freed', () => {

            const recipe = loadRecipe();
            const stored = { [ACCOUNT_TREE_KEY]: {
                Account: { Legacy_Code__c: { max: '51' }, Annual_Budget__c: { min: '5' } },
                Contact: { LastName: { min: '2' } },
                OtherChildObject__c: { Score__c: { min: '9', max: '1' } }
            } };

            applyConstraints(recipe, stored, { [ACCOUNT_TREE_KEY]: { Account: { Annual_Budget__c: '1' } } }, { [ACCOUNT_TREE_KEY]: ['Contact'] });
            expect(treeOf(recipe, ACCOUNT_TREE_KEY)).not.toHaveProperty('constraints');

            applyConstraints(recipe, stored);
            expect(treeOf(recipe, ACCOUNT_TREE_KEY).constraints?.map(constraint => `${constraint.objectApiName}.${constraint.fieldApiName}`)).toEqual(['Account.Annual_Budget__c', 'Contact.LastName']);

            applyConstraints(recipe, {});
            recipe.trees.forEach(tree => expect(tree).not.toHaveProperty('constraints'));

        });

        it('builds the Run Faker copy with the constrained expressions, and names the bounds for the data set', () => {

            const recipe = loadRecipe();
            applyConstraints(recipe, { [ACCOUNT_TREE_KEY]: { OtherChildObject__c: { Score__c: { min: '1', max: '10' } } } });

            const filteredRecipe = RecipeCockpitService.buildRunFakerFilteredRecipe(fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8'), treeOf(recipe, ACCOUNT_TREE_KEY), undefined, recipe);

            if ( 'refusalMessage' in filteredRecipe ) {
                throw new Error(filteredRecipe.refusalMessage);
            }
            expect(filteredRecipe.constraintsByObject).toEqual({ OtherChildObject__c: { Score__c: { min: '1', max: '10' } } });
            expect(filteredRecipe).not.toHaveProperty('fixedValuesByObject');
            expect(readFieldLines(filteredRecipe.recipeText, 'OtherChildObject__c', 'Score__c')).toEqual([[`    Score__c: "${SCORE_EXPRESSION}"`]]);

        });

    });

    describe('buildInsertConfirmationDetail', () => {

        it('names each constraint with its field and bounds', () => {

            const recipe = loadRecipe();
            applyConstraints(recipe, { [ACCOUNT_TREE_KEY]: { OtherChildObject__c: { Score__c: { min: '1' } } } });

            const detail = RecipeCockpitService.buildInsertConfirmationDetail('my-sandbox', undefined, treeOf(recipe, ACCOUNT_TREE_KEY), recipe, new Map([['Account', 1]]), [], 'snowfakery', 'recipe.yml');

            expect(detail).toContain('Faker constraints: OtherChildObject__c.Score__c min 1 · max default');

        });

    });

    describe('routePanelMessage editFieldConstraints', () => {

        const buildDrawnPanelState = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
            const recipe = loadRecipe();
            recipe.trees.push({ treeKey: '', title: RECIPE_COCKPIT_UNGROUPED_TREE_TITLE, folderName: '', objects: [{ objectApiName: 'Lead', parentLookups: [] }], fieldCount: 2 });
            applyConstraints(recipe, {});
            recipeChanges(recipe);
            panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 4 };
            panelState.treeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipe);
            return panelState;
        };

        const route = (payload: Record<string, unknown>, panelState = buildDrawnPanelState()) => RecipeCockpitService.routePanelMessage({ command: 'editFieldConstraints', ...payload } as any, panelState);

        it('routes a drawn, free field to its folder with both bounds as typed, trimmed, which the host checks before writing (#337)', () => {

            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', min: ' 1 ', max: 'abc', extra: 'ignored' }))
                .toEqual({ kind: 'editFieldConstraints', treeKey: ACCOUNT_TREE_KEY, folderName: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', min: '1', max: 'abc' });
            expect(route({ treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Company', min: '', max: '' })).toMatchObject({ kind: 'editFieldConstraints', folderName: LEAD_TREE_KEY, min: '', max: '' });

        });

        it.each([
            ['a lookup', { fieldApiName: 'ParentId' }],
            ['a dependent picklist', { fieldApiName: 'Sub_Rating__c' }],
            ['a controlling field', { fieldApiName: 'Rating__c' }],
            ['a standard-field mapping', { fieldApiName: 'Name' }],
            ['a type with no constraint', { fieldApiName: 'Regions__c' }],
            ['a field of another card', { treeKey: LEAD_TREE_KEY }],
            ['a field no card draws', { fieldApiName: 'Not_A_Field__c' }],
            ['a field name that is a line of YAML', { fieldApiName: 'Name: x\n    Evil' }],
            ['an object name that is not an api name', { objectApiName: 'Account Name' }],
            ['a key that is not a string', { treeKey: 7 }],
            ['a nickname the object is not drawn with', { nickname: 'Account_NickName' }],
            ['the ungrouped card, which has no folder', { treeKey: '', objectApiName: 'Lead', fieldApiName: 'Company' }],
            ['no lower bound', { min: undefined }],
            ['an upper bound that is not a string', { max: 10 }],
            ['a bound longer than a stored bound can be', { min: '1'.repeat(RECIPE_FIELD_CONSTRAINT_MAX_BOUND_LENGTH + 1) }]
        ])('does nothing for %s', (_caseName, payload) => {

            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', min: '1', max: '2', ...payload })).toBeUndefined();

        });

        it('does nothing for a field with a fixed value, an unticked field or an excluded object\'s', () => {

            const panelState = buildDrawnPanelState(recipe => applyConstraints(recipe, {}, { [ACCOUNT_TREE_KEY]: { Account: { Annual_Budget__c: '1' } } }, { [ACCOUNT_TREE_KEY]: ['Contact'] }, { [ACCOUNT_TREE_KEY]: { Account: ['Legacy_Code__c'] } }));

            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Annual_Budget__c', min: '1', max: '' }, panelState)).toBeUndefined();
            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', min: '1', max: '' }, panelState)).toBeUndefined();
            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', fieldApiName: 'LastName', min: '1', max: '' }, panelState)).toBeUndefined();
            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'OtherChildObject__c', fieldApiName: 'Score__c', min: '1', max: '' }, panelState)).toBeUndefined();
            expect(route({ treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Company', min: '1', max: '' }, panelState)).toMatchObject({ kind: 'editFieldConstraints' });

        });

        it('does nothing before "rendered", or with no model', () => {

            const undrawnPanelState = buildDrawnPanelState();
            undrawnPanelState.treeHistoryAllowLists = RecipeCockpitService.buildEmptyTreeHistoryAllowLists();
            const modelLessPanelState = buildDrawnPanelState();
            modelLessPanelState.recipeDataMessage = undefined;

            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', min: '1', max: '' }, undrawnPanelState)).toBeUndefined();
            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', min: '1', max: '' }, modelLessPanelState)).toBeUndefined();

        });

    });

    describe('openRecipeCockpitPanel', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let disposeHandler: (() => void) | undefined;
        let postedPanelMessages: any[];

        const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);
        const executeCommand = vscode.commands.executeCommand as jest.Mock;
        const showWarningMessage = vscode.window.showWarningMessage as jest.Mock;
        const showInputBox = vscode.window.showInputBox as jest.Mock;

        const buildWebviewPanel = () => ({
            reveal: jest.fn(),
            dispose: jest.fn(),
            onDidDispose: jest.fn().mockImplementation((handler: () => void) => { disposeHandler = handler; return { dispose: jest.fn() }; }),
            webview: {
                html: '',
                postMessage: jest.fn().mockImplementation((hostMessage: any) => { postedPanelMessages.push(hostMessage); return Promise.resolve(true); }),
                onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: (panelMessage: any) => Promise<void>) => {
                    receivedMessageHandler = messageHandler;
                    return { dispose: jest.fn() };
                })
            }
        });

        const openAndDraw = async (workspaceState: ReturnType<typeof buildWorkspaceState>) => {
            await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            const recipeDataMessage = lastPosted('recipeData');
            await receivedMessageHandler({ command: 'rendered', renderSequence: recipeDataMessage.renderSequence });
            return recipeDataMessage;
        };

        const storedOf = (workspaceState: ReturnType<typeof buildWorkspaceState>) => workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY);
        const editScore = (min: unknown, max: unknown) => receivedMessageHandler({ command: 'editFieldConstraints', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'OtherChildObject__c', fieldApiName: 'Score__c', min: min, max: max });

        beforeEach(() => {
            postedPanelMessages = [];
            executeCommand.mockReset();
            showWarningMessage.mockReset();
            showInputBox.mockReset();
            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => buildWebviewPanel());
            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => ({ text: initialMessage, dispose: jest.fn() }) as any);
        });

        afterEach(() => {
            disposeHandler?.();
            disposeHandler = undefined;
        });

        it('stores the bounds the inline editor posts, posts the card back in place and then the result, clears them when both are empty, and opens no box; the recipe file never changes (#337)', async () => {

            const recipeBefore = fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8');
            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);

            await editScore(' 1 ', '10');

            expect(storedOf(workspaceState)).toEqual(storedSelections({ [ACCOUNT_TREE_KEY]: { OtherChildObject__c: { Score__c: { min: '1', max: '10' } } } }));
            const objectSelectionIndex = postedPanelMessages.findIndex(hostMessage => hostMessage.command === 'objectSelection');
            const resultIndex = postedPanelMessages.findIndex(hostMessage => hostMessage.command === 'fieldEditResult');
            expect(postedPanelMessages[objectSelectionIndex]).toMatchObject({
                renderSequence: recipeDataMessage.renderSequence,
                treeKey: ACCOUNT_TREE_KEY,
                constraints: [{ objectApiName: 'OtherChildObject__c', fieldApiName: 'Score__c', min: '1', max: '10', expression: SCORE_EXPRESSION }]
            });
            expect(resultIndex).toBeGreaterThan(objectSelectionIndex);
            expect(postedPanelMessages[resultIndex]).toEqual({
                command: 'fieldEditResult', renderSequence: recipeDataMessage.renderSequence, treeKey: ACCOUNT_TREE_KEY,
                objectApiName: 'OtherChildObject__c', fieldApiName: 'Score__c', edit: 'constraint'
            });

            await editScore('', '5');
            expect(storedOf(workspaceState)).toEqual(storedSelections({ [ACCOUNT_TREE_KEY]: { OtherChildObject__c: { Score__c: { max: '5' } } } }));

            await editScore('', '');

            expect(storedOf(workspaceState)).toEqual(storedSelections({}));
            expect(lastPosted('objectSelection')).not.toHaveProperty('constraints');
            expect(lastPosted('fieldEditResult')).not.toHaveProperty('refusal');
            expect(showInputBox).not.toHaveBeenCalled();
            expect(fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8')).toBe(recipeBefore);

        });

        it.each([
            ['a decimal for a whole-number field', 'OtherChildObject__c', 'Score__c', '1.5', '', 'This field takes whole numbers only.'],
            ['text for a number', 'OtherChildObject__c', 'Score__c', 'abc', '', 'Type a plain number, such as 42, -7 or 3.25.'],
            ['a minimum past the maximum', 'OtherChildObject__c', 'Score__c', '9', '2', 'The minimum 9 is greater than the maximum 2.'],
            ['equal bounds', 'OtherChildObject__c', 'Score__c', '1', '1', 'The minimum and maximum are both 1; give the field a fixed value instead.'],
            ['a length past the field\'s <length>', 'Account', 'Legacy_Code__c', '51', '', 'This field takes at most 50 characters.'],
            ['a bound past its precision', 'OtherChildObject__c', 'Ratio__c', '1000', '', 'This field takes at most 3 digits before the decimal point (precision 5, scale 2).'],
            ['a bound past its scale', 'OtherChildObject__c', 'Ratio__c', '', '1.005', 'This field takes at most 2 decimal places.']
        ])('answers %s with its refusal, for the editor to show, and writes nothing', async (_caseName, objectApiName, fieldApiName, min, max, refusal) => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);
            workspaceState.update.mockClear();
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            await receivedMessageHandler({ command: 'editFieldConstraints', treeKey: ACCOUNT_TREE_KEY, objectApiName: objectApiName, fieldApiName: fieldApiName, min: min, max: max });

            expect(lastPosted('fieldEditResult')).toEqual({
                command: 'fieldEditResult', renderSequence: recipeDataMessage.renderSequence, treeKey: ACCOUNT_TREE_KEY,
                objectApiName: objectApiName, fieldApiName: fieldApiName, edit: 'constraint', refusal: refusal
            });
            expect(lastPosted('objectSelection')).toBeUndefined();
            expect(workspaceState.update).not.toHaveBeenCalled();
            expect(warningSpy).not.toHaveBeenCalled();

        });

        it('answers a save the workspace storage refused as not saved', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            workspaceState.update.mockRejectedValueOnce(new Error('read-only'));
            jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            await editScore('1', '10');

            expect(lastPosted('fieldEditResult').refusal).toBe(RECIPE_COCKPIT_FIELD_EDIT_NOT_SAVED_REFUSAL);

        });

        it('writes nothing and answers nothing for a forged or locked field', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({}, { [ACCOUNT_TREE_KEY]: { OtherChildObject__c: { Score__c: '4' } } }) });
            await openAndDraw(workspaceState);
            workspaceState.update.mockClear();

            await editScore('1', '2');
            await receivedMessageHandler({ command: 'editFieldConstraints', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'ParentId', min: '1', max: '2' });
            await receivedMessageHandler({ command: 'editFieldConstraints', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Name', min: '1', max: '2' });
            await receivedMessageHandler({ command: 'editFieldConstraints', treeKey: 'Forged-Folder', objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', min: '1', max: '2' });
            await receivedMessageHandler({ command: 'editFieldConstraints', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', min: 1, max: '2' });

            expect(showInputBox).not.toHaveBeenCalled();
            expect(workspaceState.update).not.toHaveBeenCalled();
            expect(lastPosted('fieldEditResult')).toBeUndefined();

        });

        it('runs a card with a constraint on a filtered copy that carries it, and never writes the recipe', async () => {

            const recipeBefore = fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8');
            await openAndDraw(buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: { OtherChildObject__c: { Score__c: { min: '1', max: '10' } } } }) }));

            await receivedMessageHandler({ command: 'generateTree', treeKey: ACCOUNT_TREE_KEY });

            const runFakerCall = executeCommand.mock.calls.find(call => call[0] === RECIPE_COCKPIT_RUN_FAKER_COMMAND);
            expect(runFakerCall).toHaveLength(3);
            expect(runFakerCall?.[1]).toBe(ACCOUNT_RECIPE_FILE_PATH);
            expect(runFakerCall?.[2]).toMatchObject({ excludedObjectApiNames: [], constraintsByObject: { OtherChildObject__c: { Score__c: { min: '1', max: '10' } } } });
            expect(runFakerCall?.[2]).not.toHaveProperty('fixedValuesByObject');
            expect(readFieldLines(runFakerCall?.[2].recipeText, 'OtherChildObject__c', 'Score__c')).toEqual([[`    Score__c: "${SCORE_EXPRESSION}"`]]);
            expect(fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8')).toBe(recipeBefore);

        });

        it('runs a card whose only stored constraint a lock holds back on its recipe exactly as before', async () => {

            await openAndDraw(buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: { Account: { ParentId: { min: '1' } } } }) }));

            await receivedMessageHandler({ command: 'generateTree', treeKey: ACCOUNT_TREE_KEY });

            expect(executeCommand.mock.calls.find(call => call[0] === RECIPE_COCKPIT_RUN_FAKER_COMMAND)).toEqual([RECIPE_COCKPIT_RUN_FAKER_COMMAND, ACCOUNT_RECIPE_FILE_PATH]);

        });

        it('Reset asks for a folder whose only change is a constraint, and clears it', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: { OtherChildObject__c: { Score__c: { min: '1' } } }, [LEAD_TREE_KEY]: { Lead: { Company: { min: '2' } } } }) });
            await openAndDraw(workspaceState);

            showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL);
            await receivedMessageHandler({ command: 'resetTreeSelection', treeKey: ACCOUNT_TREE_KEY });

            expect(showWarningMessage).toHaveBeenCalledTimes(1);
            expect(showWarningMessage.mock.calls[0][1].detail).toContain('every fixed value and faker constraint is cleared');
            expect(storedOf(workspaceState)).toEqual(storedSelections({ [LEAD_TREE_KEY]: { Lead: { Company: { min: '2' } } } }));
            expect(lastPosted('objectSelection')).not.toHaveProperty('constraints');

        });

    });

    describe('the panel script', () => {

        const drawRecipe = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined) => {
            const panel = runPanelScript();
            const recipe = loadRecipe();
            recipe.trees.push({ treeKey: '', title: RECIPE_COCKPIT_UNGROUPED_TREE_TITLE, folderName: '', objects: [{ objectApiName: 'Lead', parentLookups: [] }], fieldCount: 2 });
            applyConstraints(recipe, {});
            recipeChanges(recipe);
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
            panel.postToPanel({ command: 'loadPhase', message: '' });
            panel.expandAllTrees();
            return panel;
        };

        type Panel = ReturnType<typeof runPanelScript>;
        const objectsNamed = (panel: Panel, objectApiName: string) => panel.objectElements().filter(objectElement => panel.objectNameOf(objectElement) === objectApiName);
        const expanded = (panel: Panel, objectApiName: string) => {
            const objectElement = objectsNamed(panel, objectApiName)[0];
            panel.expandObject(objectElement);
            return objectElement;
        };
        const rowOf = (panel: Panel, objectElement: any, fieldApiName: string) => panel.fieldRowNamed(objectElement, fieldApiName);
        const pencilOf = (panel: Panel, objectElement: any, fieldApiName: string) => panel.findAll(rowOf(panel, objectElement, fieldApiName), 'treeFieldConstraint')[0];
        const only = (panel: Panel, element: any, className: string) => panel.findAll(element, className)[0];

        it('draws a ✎ on each field\'s faker expression, built node by node with the pencil path', () => {

            const panel = drawRecipe();
            const other = expanded(panel, 'OtherChildObject__c');
            const expressionRow = only(panel, rowOf(panel, other, 'Score__c'), 'expressionRow');
            const pencil = pencilOf(panel, other, 'Score__c');

            expect(expressionRow.children[0]).toBe(pencil);
            expect(expressionRow.children[1].classList.contains('expression')).toBeTrue();
            expect(pencil.tagName).toBe('button');
            expect(pencil.children[0].namespaceURI).toBe('http://www.w3.org/2000/svg');
            expect(pencil.children[0].children[0].attributes.d).toBe(RECIPE_COCKPIT_CONSTRAINT_GLYPH_PATH);
            expect(pencil.attributes['aria-pressed']).toBe('false');
            expect(pencil.disabled).toBeFalse();
            expect(pencil.attributes.title).toBe('Set the range of values this field generates');

        });

        it('disables the ✎ of a field the rule holds back, with the reason in its title', () => {

            const panel = drawRecipe();
            const account = expanded(panel, 'Account');
            const titleOf = (fieldApiName: string) => pencilOf(panel, account, fieldApiName).attributes.title;

            expect(pencilOf(panel, account, 'ParentId').disabled).toBeTrue();
            expect(titleOf('ParentId')).toBe(`Cannot be constrained: ${RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_REASON}`);
            expect(titleOf('Rating__c')).toBe(`Cannot be constrained: ${RECIPE_COCKPIT_FIELD_CONTROLS_REASON_PREFIX}Sub_Rating__c`);
            expect(titleOf('Name')).toBe(`Cannot be constrained: ${RECIPE_COCKPIT_CONSTRAINT_RECIPE_FILE_ONLY_REASON}`);
            expect(titleOf('Regions__c')).toBe(`Cannot be constrained: ${RECIPE_COCKPIT_CONSTRAINT_TYPE_REASON}`);
            expect(pencilOf(panel, account, 'Legacy_Code__c').disabled).toBeFalse();

            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, fixedValues: [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'X', kind: 'text' }] });
            expect(pencilOf(panel, account, 'Legacy_Code__c').disabled).toBeTrue();
            expect(titleOf('Legacy_Code__c')).toBe(`Cannot be constrained: ${RECIPE_COCKPIT_CONSTRAINT_FIXED_VALUE_REASON}`);

        });

        it('disables an Email, Phone or Url field\'s ✎, naming the format it keeps', () => {

            const panel = drawRecipe(recipe => {
                objectOf(recipe, 'Lead').fields.push({ ...fieldOf(recipe, 'Lead', 'Company'), fieldApiName: 'Email', fieldType: 'Email', fieldTypeWithSize: 'Email' });
            });
            const lead = expanded(panel, 'Lead');

            expect(pencilOf(panel, lead, 'Email').disabled).toBeTrue();
            expect(pencilOf(panel, lead, 'Email').attributes.title).toBe(`Cannot be constrained: ${RECIPE_COCKPIT_CONSTRAINT_FORMAT_REASON}Email`);

        });

        it('opens an inline min/max editor under the row on a click, labelled for the field\'s kind, and closes it on Cancel or Escape (#337)', () => {

            const panel = drawRecipe();
            panel.postToPanel({ command: 'rendered' });
            const other = expanded(panel, 'OtherChildObject__c');
            const account = expanded(panel, 'Account');
            const row = rowOf(panel, other, 'Score__c');
            const pencil = pencilOf(panel, other, 'Score__c');

            pencil.dispatch('click');
            const editor = only(panel, row, 'fieldEditor');
            const inputs = panel.findAll(editor, 'fieldEditorInput');

            expect(panel.isHidden(editor)).toBeFalse();
            expect(editor.attributes['aria-label']).toBe('Faker bounds for OtherChildObject__c.Score__c');
            expect(pencil.attributes['aria-expanded']).toBe('true');
            expect(panel.findAll(editor, 'fieldEditorBoundLabel').map((labelElement: any) => labelElement.textContent)).toEqual(['Minimum', 'Maximum']);
            expect(inputs.map((inputElement: any) => [inputElement.value, inputElement.attributes.placeholder, inputElement.attributes.maxlength]))
                .toEqual([['', 'default', String(RECIPE_FIELD_CONSTRAINT_MAX_BOUND_LENGTH)], ['', 'default', String(RECIPE_FIELD_CONSTRAINT_MAX_BOUND_LENGTH)]]);
            expect(inputs[0].attributes['aria-label']).toBe('Minimum for OtherChildObject__c.Score__c');

            only(panel, editor, 'fieldEditorCancel').dispatch('click');
            expect(panel.isHidden(editor)).toBeTrue();
            expect(pencil.attributes['aria-expanded']).toBe('false');

            pencilOf(panel, account, 'Legacy_Code__c').dispatch('click');
            const lengthEditor = only(panel, rowOf(panel, account, 'Legacy_Code__c'), 'fieldEditor');
            expect(panel.findAll(lengthEditor, 'fieldEditorBoundLabel').map((labelElement: any) => labelElement.textContent)).toEqual(['Minimum length', 'Maximum length']);
            only(panel, lengthEditor, 'fieldEditorInput').dispatch('keydown', { key: 'Escape' });
            expect(panel.isHidden(lengthEditor)).toBeTrue();
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'editFieldConstraints')).toEqual([]);

        });

        it('posts both bounds trimmed on Save or Enter, and both empty on Clear, with the nickname the object is drawn with', () => {

            const panel = drawRecipe(recipe => { objectOf(recipe, 'OtherChildObject__c').nickname = 'Other_NickName'; });
            panel.postToPanel({ command: 'rendered' });
            const other = expanded(panel, 'OtherChildObject__c');
            const row = rowOf(panel, other, 'Score__c');

            pencilOf(panel, other, 'Score__c').dispatch('click');
            pencilOf(panel, other, 'Contact__c').dispatch('click');
            const [minimumInput, maximumInput] = panel.findAll(row, 'fieldEditorInput');
            minimumInput.value = ' 1 ';
            maximumInput.value = '10';
            only(panel, row, 'fieldEditorSave').dispatch('click');
            minimumInput.value = '';
            maximumInput.dispatch('keydown', { key: 'Enter' });
            only(panel, row, 'fieldEditorClear').dispatch('click');

            const base = { command: 'editFieldConstraints', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'OtherChildObject__c', fieldApiName: 'Score__c', nickname: 'Other_NickName' };
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'editFieldConstraints')).toEqual([
                { ...base, min: '1', max: '10' },
                { ...base, min: '', max: '10' },
                { ...base, min: '', max: '' }
            ]);

        });

        it('pre-fills the bounds the card generates with, shows a refusal as text, closes once saved, and has one editor per row', () => {

            const panel = drawRecipe();
            panel.postToPanel({ command: 'rendered' });
            const account = expanded(panel, 'Account');
            const row = rowOf(panel, account, 'Legacy_Code__c');
            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, constraints: [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', min: '2', expression: 'x' }] });

            pencilOf(panel, account, 'Legacy_Code__c').dispatch('click');
            const editor = only(panel, row, 'fieldEditor');
            expect(panel.findAll(editor, 'fieldEditorInput').map((inputElement: any) => inputElement.value)).toEqual(['2', '']);

            const result = { command: 'fieldEditResult', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', edit: 'constraint' };
            panel.postToPanel({ ...result, refusal: 'The minimum 9 is greater than the maximum 2.' });
            expect(only(panel, editor, 'fieldEditorRefusal').textContent).toBe('The minimum 9 is greater than the maximum 2.');
            expect(panel.isHidden(only(panel, editor, 'fieldEditorRefusal'))).toBeFalse();

            // THE PIN OPENS ITS OWN EDITOR IN THE SAME PLACE, CLOSING THE ✎'S
            panel.findAll(row, 'treeFieldFixedValue')[0].dispatch('click');
            expect(editor.attributes['aria-label']).toBe('Fixed value for Account.Legacy_Code__c');
            expect(pencilOf(panel, account, 'Legacy_Code__c').attributes['aria-expanded']).toBe('false');
            panel.postToPanel({ ...result });
            expect(panel.isHidden(editor)).toBeFalse();

            pencilOf(panel, account, 'Legacy_Code__c').dispatch('click');
            panel.postToPanel({ ...result });
            expect(panel.isHidden(editor)).toBeTrue();
            expect(panel.findAll(row, 'fieldEditor')).toHaveLength(1);

        });

        it('shows the constrained expression in place of the expression, as text, from an objectSelection for the model on screen, and Reset while one is set', () => {

            const panel = drawRecipe();
            panel.postToPanel({ command: 'rendered' });
            const other = expanded(panel, 'OtherChildObject__c');
            const row = rowOf(panel, other, 'Score__c');
            const resetElement = panel.findAll(panel.treeCards()[0], 'treeResetSelection')[0];
            const constraints = [{ objectApiName: 'OtherChildObject__c', fieldApiName: 'Score__c', min: '1', expression: '<b>${{x}}</b>' }];

            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 99, constraints: constraints });
            expect(panel.isHidden(only(panel, row, 'constrainedExpression'))).toBeTrue();

            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, constraints: constraints });

            expect(only(panel, row, 'constrainedExpression').textContent).toBe('<b>${{x}}</b>');
            expect(only(panel, row, 'constrainedExpression').children).toEqual([]);
            expect(panel.isHidden(only(panel, row, 'constrainedExpression'))).toBeFalse();
            expect(panel.isHidden(only(panel, row, 'expression'))).toBeTrue();
            expect(only(panel, row, 'constraintBadge').textContent).toBe(RECIPE_COCKPIT_CONSTRAINT_BADGE_LABEL);
            expect(panel.isHidden(only(panel, row, 'constraintBadge'))).toBeFalse();
            expect(pencilOf(panel, other, 'Score__c').attributes['aria-pressed']).toBe('true');
            expect(pencilOf(panel, other, 'Score__c').attributes.title).toBe('Constrained (min 1 · max default) — click to change or clear it');
            expect(panel.isHidden(resetElement)).toBeFalse();
            expect(panel.isHidden(only(panel, rowOf(panel, other, 'Ratio__c'), 'constrainedExpression'))).toBeTrue();

            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3 });

            expect(panel.isHidden(only(panel, row, 'constrainedExpression'))).toBeTrue();
            expect(panel.isHidden(only(panel, row, 'expression'))).toBeFalse();
            expect(panel.isHidden(only(panel, row, 'constraintBadge'))).toBeTrue();
            expect(pencilOf(panel, other, 'Score__c').attributes['aria-pressed']).toBe('false');
            expect(panel.isHidden(resetElement)).toBeTrue();

        });

        it('draws no ✎ on the ungrouped card, which has no folder to keep a constraint by', () => {

            const panel = drawRecipe();
            const ungroupedLead = objectsNamed(panel, 'Lead').find(objectElement => panel.findAll(objectElement, 'treeObjectInclude').length === 0);
            panel.expandObject(ungroupedLead);

            expect(panel.findAll(ungroupedLead, 'treeFieldConstraint')).toEqual([]);
            expect(panel.findAll(ungroupedLead, 'expression').length).toBeGreaterThan(0);

        });

    });

});
