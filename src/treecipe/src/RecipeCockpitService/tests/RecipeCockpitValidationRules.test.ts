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
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitFieldViewModel,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel,
    RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON,
    RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_VALIDATION_RULES,
    RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL,
    RECIPE_COCKPIT_RUN_FAKER_COMMAND,
    RECIPE_COCKPIT_UNGROUPED_TREE_TITLE,
    RECIPE_COCKPIT_VALIDATION_RULE_FIXED_VALUE_REASON,
    RECIPE_COCKPIT_VALIDATION_RULE_NOT_APPLIED_LABEL
} from '../RecipeCockpitService';
import { RecipeCockpitRecipeWriter, RecipeFilterResult, IRecipeUnconstrainedValue } from '../RecipeCockpitRecipeWriter';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';
import * as os from 'os';

/*
    #325: a checkbox at the end of a rule-constrained field's row says the field's validation rules
    are applied, and unticking it generates the field with the value it had before #324 applied them.
*/

const VALIDATION_RULE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'validationRuleWorkspace');
const VALIDATION_RULE_GENERATED_RECIPES_PATH = path.join(VALIDATION_RULE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const GADGET_TREE_KEY = 'Gadget__c-thru-Widget__c';

const BACKEND_RUNS = [
    { backend: 'faker-js', runFolderName: 'recipe-fakerjs-2026-10-01T09-00-00', recipePrefix: 'recipe-fakerjs' },
    { backend: 'snowfakery', runFolderName: 'recipe-2026-10-01T08-00-00', recipePrefix: 'recipe' }
] as const;

type BackendRun = typeof BACKEND_RUNS[number];

const recipeFilePathOf = (backendRun: BackendRun) => path.join(
    VALIDATION_RULE_GENERATED_RECIPES_PATH,
    backendRun.runFolderName,
    GADGET_TREE_KEY,
    `${backendRun.recipePrefix}--${GADGET_TREE_KEY}-${backendRun.runFolderName.slice(-19)}.yml`
);

interface IWrapperField {
    fieldName: string;
    recipeValue: string;
    unconstrainedRecipeValue?: string;
    validationRuleConstraints?: Array<{ ruleName: string; applied: boolean; reason?: string }>;
}

const readWrapperField = (backendRun: BackendRun, objectApiName: string, fieldApiName: string): IWrapperField => {
    const runFolderPath = path.join(VALIDATION_RULE_GENERATED_RECIPES_PATH, backendRun.runFolderName);
    const wrapperFileName = fs.readdirSync(runFolderPath).find(fileName => fileName.startsWith('treecipeObjectsWrapper-')) as string;
    const wrapper = JSON.parse(fs.readFileSync(path.join(runFolderPath, wrapperFileName), 'utf8'));
    return ( wrapper.ObjectToObjectInfoMap[objectApiName].Fields as IWrapperField[] ).find(field => field.fieldName === fieldApiName) as IWrapperField;
};

const unconstrainedOf = (backendRun: BackendRun, objectApiName: string, fieldApiName: string): IRecipeUnconstrainedValue => {
    const wrapperField = readWrapperField(backendRun, objectApiName, fieldApiName);
    return { constrainedValue: wrapperField.recipeValue, unconstrainedValue: wrapperField.unconstrainedRecipeValue as string };
};

const valuesOf = (entries: Record<string, Record<string, IRecipeUnconstrainedValue>>) => new Map(Object.entries(entries).map(([objectApiName, byField]) => [objectApiName, new Map(Object.entries(byField))]));

function expectFiltered(result: RecipeFilterResult): Extract<RecipeFilterResult, { isFiltered: true }> {
    if ( 'refusal' in result ) {
        throw new Error(`expected a filtered copy, got a refusal: ${result.refusal.message}`);
    }
    return result;
}

// EACH OCCURRENCE'S FIELD LINES, AS THE SCANNER READS THEM BACK
function readFieldLines(recipeText: string, objectApiName: string, fieldApiName: string): string[][] {
    const { lines } = RecipeCockpitRecipeWriter.splitRecipeLines(recipeText);
    return RecipeCockpitRecipeWriter.scanRecipeObjects(lines)
        .filter(scannedObject => scannedObject.objectApiName === objectApiName)
        .map(scannedObject => scannedObject.fields.find(scannedField => scannedField.fieldApiName === fieldApiName))
        .filter((scannedField): scannedField is NonNullable<typeof scannedField> => !!scannedField)
        .map(scannedField => lines.slice(scannedField.startIndex, scannedField.endIndex));
}

const emptyFilter = { excludedObjectApiNames: [], parentLookupsByObjectApiName: new Map() };

describe.each(BACKEND_RUNS)('RecipeCockpitRecipeWriter.buildFilteredRecipe with unconstrainedValuesByObject, $backend (#325)', (backendRun) => {

    const recipeText = fs.readFileSync(recipeFilePathOf(backendRun), 'utf8');

    it('writes the value the field had before its rules in place of the rule-written lines, every other line kept', () => {

        const amount = unconstrainedOf(backendRun, 'Gadget__c', 'Amount__c');
        const result = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            ...emptyFilter,
            unconstrainedValuesByObject: valuesOf({ Gadget__c: { Amount__c: amount } })
        }));

        expect(readFieldLines(result.recipeText, 'Gadget__c', 'Amount__c')).toEqual([`    Amount__c: ${amount.unconstrainedValue}`.split('\n')]);
        expect(result.recipeText).not.toContain('"Require_Amount_Maximum"');
        expect(result.appliedUnconstrainedValues).toEqual([{ objectApiName: 'Gadget__c', fieldApiName: 'Amount__c' }]);
        expect(result.recipeText.split('\n')[0]).toBe('# Recipe Cockpit -- a filtered copy of this tree\'s recipe, with validation rules off: Gadget__c.Amount__c');

        const ruleWrittenLines = `    Amount__c: ${amount.constrainedValue}`.split('\n');
        const originalLines = recipeText.split('\n');
        const amountIndex = originalLines.indexOf(ruleWrittenLines[0]);
        const expectedLines = [
            '# Recipe Cockpit -- a filtered copy of this tree\'s recipe, with validation rules off: Gadget__c.Amount__c',
            ...originalLines.slice(0, amountIndex),
            ...`    Amount__c: ${amount.unconstrainedValue}`.split('\n'),
            ...originalLines.slice(amountIndex + ruleWrittenLines.length)
        ];
        expect(result.recipeText.split('\n')).toEqual(expectedLines);
        expect(() => yaml.load(result.recipeText)).not.toThrow();

    });

    it('switches off a multi-line dependent picklist, its rule comment included', () => {

        const town = unconstrainedOf(backendRun, 'Gadget__c', 'Town__c');
        const result = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            ...emptyFilter,
            unconstrainedValuesByObject: valuesOf({ Gadget__c: { Town__c: town } })
        }));

        expect(readFieldLines(result.recipeText, 'Gadget__c', 'Town__c')).toEqual([`    Town__c: ${town.unconstrainedValue}`.split('\n')]);
        expect(result.recipeText).toContain('- Portland');
        expect(result.recipeText).not.toContain('"Restrict_Portland"');

    });

    it('writes a friend\'s value at the friend\'s depth', () => {

        const weightLines = readFieldLines(recipeText, 'Widget__c', 'Weight__c')[0];
        const indent = weightLines[0].length - weightLines[0].trimStart().length - 4;
        const writtenAsTopLevel = weightLines.map((weightLine, lineIndex) => ( lineIndex === 0 ? weightLine.trimStart().slice('Weight__c: '.length) : weightLine.slice(indent) )).join('\n');
        const result = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            ...emptyFilter,
            unconstrainedValuesByObject: valuesOf({ Widget__c: { Weight__c: { constrainedValue: writtenAsTopLevel, unconstrainedValue: '|\n            ${{ 42 }}' } } })
        }));

        expect(readFieldLines(result.recipeText, 'Widget__c', 'Weight__c')).toEqual([[`${' '.repeat(indent + 4)}Weight__c: |`, `${' '.repeat(indent + 12)}\${{ 42 }}`]]);

    });

    it('refuses the copy when the recipe no longer holds what the rules wrote, rather than guessing', () => {

        const amount = unconstrainedOf(backendRun, 'Gadget__c', 'Amount__c');
        const handEdited = recipeText.replace(/^ {4}Amount__c: .*$/m, '    Amount__c: 12');
        const result = RecipeCockpitRecipeWriter.buildFilteredRecipe(handEdited, {
            ...emptyFilter,
            unconstrainedValuesByObject: valuesOf({ Gadget__c: { Amount__c: amount } })
        });

        expect(result).toEqual({
            isFiltered: false,
            refusal: expect.objectContaining({ reason: 'unsupported-filter-layout', objectApiName: 'Gadget__c', fieldApiName: 'Amount__c', message: 'Gadget__c.Amount__c in the recipe is not the value its validation rules wrote, so they could not be switched off.' })
        });

    });

    it.each([
        ['a continuation line at the field\'s own column', '1\n    Evil__c: 2'],
        ['a new object', '1\n- object: Evil'],
        ['a U+2028 line break', '${{ 1 }} - object: Evil'],
        ['a trailing blank line', '|\n            ${{ 1 }}\n']
    ])('refuses an unconstrained value with %s', (_caseName, unconstrainedValue) => {

        const amount = unconstrainedOf(backendRun, 'Gadget__c', 'Amount__c');
        const result = RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            ...emptyFilter,
            unconstrainedValuesByObject: valuesOf({ Gadget__c: { Amount__c: { constrainedValue: amount.constrainedValue, unconstrainedValue: unconstrainedValue } } })
        });

        expect(result).toEqual({ isFiltered: false, refusal: expect.objectContaining({ reason: 'invalid-value', fieldApiName: 'Amount__c' }) });

    });

    it('refuses a name that is not an api name', () => {

        const amount = unconstrainedOf(backendRun, 'Gadget__c', 'Amount__c');

        expect(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, { ...emptyFilter, unconstrainedValuesByObject: valuesOf({ 'Gadget__c\n- object: X': { Amount__c: amount } }) }))
            .toEqual({ isFiltered: false, refusal: expect.objectContaining({ reason: 'invalid-object-api-name' }) });
        expect(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, { ...emptyFilter, unconstrainedValuesByObject: valuesOf({ Gadget__c: { 'Amount__c: 1': amount } }) }))
            .toEqual({ isFiltered: false, refusal: expect.objectContaining({ reason: 'invalid-field-api-name' }) });

    });

    it('lets a fixed value or a constrained expression on the same field win', () => {

        const amount = unconstrainedOf(backendRun, 'Gadget__c', 'Amount__c');
        const quantity = unconstrainedOf(backendRun, 'Gadget__c', 'Quantity__c');
        const result = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            ...emptyFilter,
            fixedValuesByObject: new Map([['Gadget__c', new Map([['Amount__c', { value: '7', kind: 'number' as const }]])]]),
            constrainedExpressionsByObject: new Map([['Gadget__c', new Map([['Quantity__c', '${{ 3 }}']])]]),
            unconstrainedValuesByObject: valuesOf({ Gadget__c: { Amount__c: amount, Quantity__c: quantity } })
        }));

        expect(readFieldLines(result.recipeText, 'Gadget__c', 'Amount__c')).toEqual([['    Amount__c: 7']]);
        expect(readFieldLines(result.recipeText, 'Gadget__c', 'Quantity__c')).toEqual([['    Quantity__c: "${{ 3 }}"']]);
        expect(result.appliedUnconstrainedValues).toEqual([]);

    });

    it('leaves the recipe byte for byte with no field switched off', () => {

        expect(expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, { ...emptyFilter, unconstrainedValuesByObject: new Map() })).recipeText).toBe(recipeText);

    });

    it('leaves an excluded object\'s field alone', () => {

        const amount = unconstrainedOf(backendRun, 'Gadget__c', 'Amount__c');
        const result = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
            ...emptyFilter,
            excludedFieldApiNamesByObject: new Map([['Gadget__c', ['Amount__c']]]),
            unconstrainedValuesByObject: valuesOf({ Gadget__c: { Amount__c: amount } })
        }));

        expect(readFieldLines(result.recipeText, 'Gadget__c', 'Amount__c')).toEqual([]);
        expect(result.appliedUnconstrainedValues).toEqual([]);

    });

});

const loadRecipe = (backendRun: BackendRun = BACKEND_RUNS[0]): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(VALIDATION_RULE_GENERATED_RECIPES_PATH),
    VALIDATION_RULE_WORKSPACE_ROOT,
    backendRun.runFolderName
).recipeViewModel;

const treeOf = (recipe: IRecipeCockpitRecipeViewModel, treeKey = GADGET_TREE_KEY) => recipe.trees.find(tree => tree.treeKey === treeKey) as IRecipeCockpitTreeViewModel;
const objectOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string) => recipe.objects.find(objectViewModel => objectViewModel.objectApiName === objectApiName) as IRecipeCockpitObjectViewModel;
const fieldOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string, fieldApiName: string) => objectOf(recipe, objectApiName).fields.find(field => field.fieldApiName === fieldApiName) as IRecipeCockpitFieldViewModel;

const toMaps = <T>(byFolder: Record<string, Record<string, Record<string, T>>>) => new Map(Object.entries(byFolder).map(([folderName, byObject]) => [folderName, new Map(Object.entries(byObject).map(([objectApiName, byField]) => [objectApiName, new Map(Object.entries(byField))]))]));
const toFieldSets = (byFolder: Record<string, Record<string, string[]>>) => new Map(Object.entries(byFolder).map(([folderName, byObject]) => [folderName, new Map(Object.entries(byObject).map(([objectApiName, fieldApiNames]) => [objectApiName, new Set(fieldApiNames)]))]));

interface ISelectionChoices {
    validationRulesOff?: Record<string, Record<string, string[]>>;
    fixedValues?: Record<string, Record<string, Record<string, string>>>;
    excludedObjects?: Record<string, string[]>;
    excludedFields?: Record<string, Record<string, string[]>>;
}

const applySelections = (recipe: IRecipeCockpitRecipeViewModel, choices: ISelectionChoices = {}) => RecipeCockpitService.applyObjectSelections(
    recipe,
    new Map(Object.entries(choices.excludedObjects ?? {}).map(([folderName, objectApiNames]) => [folderName, new Set(objectApiNames)])),
    toFieldSets(choices.excludedFields ?? {}),
    undefined,
    new Map(),
    toMaps(choices.fixedValues ?? {}),
    toFieldSets(choices.validationRulesOff ?? {})
);

const storedSelections = (choices: ISelectionChoices = {}) => ({
    version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    excludedObjectApiNamesByFolderName: choices.excludedObjects ?? {},
    excludedFieldApiNamesByFolderName: choices.excludedFields ?? {},
    objectCountsByFolderName: {},
    // A FIXED VALUE IS IN THE RECIPE FILE SINCE #342: A STORED ONE IS WHAT AN OLDER VERSION LEFT, AND IS NOT READ
    ...( choices.fixedValues ? { fixedValuesByFolderName: choices.fixedValues } : {} ),
    validationRulesOffByFolderName: choices.validationRulesOff ?? {}
});

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

const AMOUNT_RULES = ['Require_Amount_Maximum', 'Require_Amount_Minimum'];

describe('RecipeCockpitService -- validation-rule checkbox (#325)', () => {

    describe('normalizeObjectsWrapper', () => {

        it.each(BACKEND_RUNS)('carries a $backend field\'s applied rules and both values its box switches between', (backendRun) => {

            const recipe = loadRecipe(backendRun);
            const amount = readWrapperField(backendRun, 'Gadget__c', 'Amount__c');

            expect(fieldOf(recipe, 'Gadget__c', 'Amount__c').validationRules).toEqual({
                appliedRuleNames: AMOUNT_RULES,
                notAppliedRules: [],
                recipeValue: amount.recipeValue,
                unconstrainedRecipeValue: amount.unconstrainedRecipeValue,
                unconstrainedExpression: RecipeCockpitService.buildDisplayExpression(( amount.unconstrainedRecipeValue as string ).split('\n'))
            });
            expect(fieldOf(recipe, 'Gadget__c', 'Score__c').validationRules).toEqual({
                appliedRuleNames: [],
                notAppliedRules: [
                    { ruleName: 'Score_High', reason: 'together these rules leave no value to generate: The minimum 10 is greater than the maximum 5.' },
                    { ruleName: 'Score_Low', reason: 'together these rules leave no value to generate: The minimum 10 is greater than the maximum 5.' }
                ]
            });
            expect(fieldOf(recipe, 'Gadget__c', 'Region__c')).not.toHaveProperty('validationRules');
            expect(fieldOf(recipe, 'Widget__c', 'Weight__c')).not.toHaveProperty('validationRules');

        });

        it('carries nothing for a wrapper with no rules, so it posts as it did before', () => {

            const historyRecipe = RecipeCockpitService.loadRecipeRunByRuns(
                RecipeCockpitService.findGeneratedRecipeRuns(path.join(__dirname, 'mocks', 'historyWorkspace', 'treecipe', 'GeneratedRecipes')),
                path.join(__dirname, 'mocks', 'historyWorkspace'),
                'recipe-2026-09-20T10-00-00'
            ).recipeViewModel;

            expect(JSON.stringify(historyRecipe)).not.toContain('validationRules');

        });

        it.each([
            ['no list', { recipeValue: 'a', unconstrainedRecipeValue: 'b' }, undefined],
            ['an empty list', { validationRuleConstraints: [], recipeValue: 'a', unconstrainedRecipeValue: 'b' }, undefined],
            ['records it cannot read', { validationRuleConstraints: [null, 7, { ruleName: 3, applied: true }, { ruleName: 'R', applied: 'yes' }], recipeValue: 'a', unconstrainedRecipeValue: 'b' }, undefined],
            ['an applied rule with no value to switch back to', { validationRuleConstraints: [{ ruleName: 'R', applied: true }], recipeValue: 'a' }, undefined],
            ['a rule not applied with no reason', { validationRuleConstraints: [{ ruleName: 'R', applied: false }] }, { appliedRuleNames: [], notAppliedRules: [{ ruleName: 'R', reason: '' }] }]
        ])('reads %s', (_caseName, wrapperFieldRecord, expected) => {

            expect(RecipeCockpitService.readFieldValidationRules(wrapperFieldRecord as Record<string, unknown>)).toEqual(expected);

        });

    });

    describe('readTreeSelections and writeTreeSelections', () => {

        it('writes version 7 with only the unticks, names named __proto__ as keys, and reads back every api name', async () => {

            const workspaceState = buildWorkspaceState();
            await expect(RecipeCockpitService.writeTreeSelections(workspaceState, {
                excludedObjectApiNamesByFolderName: new Map(),
                excludedFieldApiNamesByFolderName: new Map(),
                objectCountsByFolderName: new Map(),
                fixedValuesByFolderName: new Map(),
                validationRulesOffByFolderName: toFieldSets({ [GADGET_TREE_KEY]: { Gadget__c: ['Amount__c', '__proto__'] }, ['__proto__']: { Lead: ['Company'] }, ['Empty-Tree']: { Lead: [] } })
            })).resolves.toBeTrue();

            const stored = workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY) as any;
            expect(stored.version).toBe(7);
            expect(stored.validationRulesOffByFolderName).toEqual({ [GADGET_TREE_KEY]: { Gadget__c: ['Amount__c', '__proto__'] }, ['__proto__']: { Lead: ['Company'] } });
            expect(Object.keys(stored.validationRulesOffByFolderName)).toEqual([GADGET_TREE_KEY, '__proto__']);
            expect(RecipeCockpitService.readTreeSelections(workspaceState).validationRulesOffByFolderName)
                .toEqual(toFieldSets({ [GADGET_TREE_KEY]: { Gadget__c: ['Amount__c'] }, ['__proto__']: { Lead: ['Company'] } }));

        });

        it('says the choices could not be saved, and writes nothing, when workspaceState refuses the write', async () => {

            const workspaceState = buildWorkspaceState();
            workspaceState.update.mockRejectedValueOnce('disk full');
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            await expect(RecipeCockpitService.writeTreeSelections(workspaceState, RecipeCockpitService.readTreeSelections(workspaceState))).resolves.toBeFalse();
            expect(warningSpy).toHaveBeenCalledWith('The excluded objects, unticked fields, record counts and validation rule choices could not be saved: disk full');

        });

        it('drops a name that is not an api name', () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ validationRulesOff: { [GADGET_TREE_KEY]: { Gadget__c: ['Amount__c', 'Amount__c: 1'], 'Bad Object': ['X'] } } }) });

            expect(RecipeCockpitService.readTreeSelections(workspaceState).validationRulesOffByFolderName).toEqual(toFieldSets({ [GADGET_TREE_KEY]: { Gadget__c: ['Amount__c'] } }));

        });

        it('reads a version 5 entry, written before #325, as every rule applied, and drops its bounds (#356) on a write', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: {
                ...storedSelections({ validationRulesOff: { [GADGET_TREE_KEY]: { Gadget__c: ['Quantity__c'] } } }),
                constraintsByFolderName: { [GADGET_TREE_KEY]: { Gadget__c: { Amount__c: { min: '200' } } } },
                version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_VALIDATION_RULES
            } });

            const treeSelections = RecipeCockpitService.readTreeSelections(workspaceState);
            expect(treeSelections.validationRulesOffByFolderName).toEqual(new Map());
            expect(treeSelections).not.toHaveProperty('constraintsByFolderName');

            await RecipeCockpitService.writeObjectSelections(workspaceState, new Map());
            expect(workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY)).toEqual(storedSelections({}));

        });

    });

    describe('findValidationRuleLockReason, buildTreeValidationRulesOff and applyObjectSelections', () => {

        it('sets nothing on a card whose rules are all applied', () => {

            const recipe = loadRecipe();
            applySelections(recipe);

            expect(treeOf(recipe)).not.toHaveProperty('validationRulesOff');

        });

        it('lists a stored untick of a field with applied rules, and nothing else', () => {

            const recipe = loadRecipe();
            applySelections(recipe, {
                validationRulesOff: { [GADGET_TREE_KEY]: { Gadget__c: ['Amount__c', 'Score__c', 'Region__c', 'Not_A_Field__c'] } }
            });

            expect(treeOf(recipe).validationRulesOff).toEqual([
                { objectApiName: 'Gadget__c', fieldApiName: 'Amount__c' }
            ]);

        });

        it('locks a field with a fixed value, an unticked field and every field of an excluded object, and lists none of them', () => {

            const recipe = loadRecipe();
            applySelections(recipe, {
                validationRulesOff: { [GADGET_TREE_KEY]: { Gadget__c: ['Amount__c', 'Quantity__c'] } },
                fixedValues: { [GADGET_TREE_KEY]: { Gadget__c: { Amount__c: '7' } } },
                excludedFields: { [GADGET_TREE_KEY]: { Gadget__c: ['Quantity__c'] } }
            });
            const tree = treeOf(recipe);
            const gadget = objectOf(recipe, 'Gadget__c');

            expect(tree).not.toHaveProperty('validationRulesOff');
            expect(RecipeCockpitService.findValidationRuleLockReason(tree, gadget, fieldOf(recipe, 'Gadget__c', 'Amount__c'))).toBe(RECIPE_COCKPIT_VALIDATION_RULE_FIXED_VALUE_REASON);
            expect(RecipeCockpitService.findValidationRuleLockReason(tree, gadget, fieldOf(recipe, 'Gadget__c', 'Quantity__c'))).toBe(RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON);
            expect(RecipeCockpitService.findValidationRuleLockReason(tree, gadget, fieldOf(recipe, 'Gadget__c', 'Notes__c'))).toBeUndefined();
            expect(RecipeCockpitService.findValidationRuleLockReason(tree, gadget, fieldOf(recipe, 'Gadget__c', 'Score__c'))).toBe(RECIPE_COCKPIT_VALIDATION_RULE_NOT_APPLIED_LABEL);

            const excludedRecipe = loadRecipe();
            applySelections(excludedRecipe, { excludedObjects: { [GADGET_TREE_KEY]: ['Gadget__c'] }, validationRulesOff: { [GADGET_TREE_KEY]: { Gadget__c: ['Amount__c'] } } });
            expect(RecipeCockpitService.findValidationRuleLockReason(treeOf(excludedRecipe), objectOf(excludedRecipe, 'Gadget__c'), fieldOf(excludedRecipe, 'Gadget__c', 'Amount__c'))).toBe(RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON);

        });

        it('finds a drawn field only on a model, a card and an object that draw it with a recipe line', () => {

            const recipe = loadRecipe();

            expect(RecipeCockpitService.findDrawnField(recipe, GADGET_TREE_KEY, 'Gadget__c', 'Amount__c')?.fieldViewModel.fieldApiName).toBe('Amount__c');
            expect(RecipeCockpitService.findDrawnField(undefined, GADGET_TREE_KEY, 'Gadget__c', 'Amount__c')).toBeUndefined();
            expect(RecipeCockpitService.findDrawnField(recipe, 'Forged-Folder', 'Gadget__c', 'Amount__c')).toBeUndefined();
            expect(RecipeCockpitService.findDrawnField(recipe, GADGET_TREE_KEY, 'Lead', 'Amount__c')).toBeUndefined();
            expect(RecipeCockpitService.findDrawnField(recipe, GADGET_TREE_KEY, 'Gadget__c', 'Not_A_Field__c')).toBeUndefined();

            delete fieldOf(recipe, 'Gadget__c', 'Amount__c').lineNumber;
            expect(RecipeCockpitService.findDrawnField(recipe, GADGET_TREE_KEY, 'Gadget__c', 'Amount__c')).toBeUndefined();

        });

        it('locks a field whose parent is excluded, and frees one on a card with no field selection at all', () => {

            const recipe = loadRecipe();
            const tree = treeOf(recipe);
            const gadget = objectOf(recipe, 'Gadget__c');
            const amount = fieldOf(recipe, 'Gadget__c', 'Amount__c');

            tree.fieldSelection = { objects: [{ objectApiName: 'Gadget__c', excludedFieldApiNames: [], lockedFields: [{ fieldApiName: 'Amount__c', reason: RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON }] }] } as any;
            expect(RecipeCockpitService.findValidationRuleLockReason(tree, gadget, amount)).toBe(RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON);

            delete tree.fieldSelection;
            expect(RecipeCockpitService.findValidationRuleLockReason(tree, gadget, amount)).toBeUndefined();

        });

        it('swaps nothing for a switched-off field the model no longer draws, or whose values it does not hold', () => {

            const recipe = loadRecipe();
            const tree = treeOf(recipe);
            tree.validationRulesOff = [
                { objectApiName: 'Gadget__c', fieldApiName: 'Not_A_Field__c' },
                { objectApiName: 'Lead', fieldApiName: 'Amount__c' },
                { objectApiName: 'Gadget__c', fieldApiName: 'Quantity__c' }
            ];
            delete fieldOf(recipe, 'Gadget__c', 'Quantity__c').validationRules?.unconstrainedRecipeValue;

            expect(RecipeCockpitService.listUnconstrainedValuesByObject(recipe, tree)).toEqual(new Map());

        });

        it('leaves a dependent picklist and a controlling field free, since both are still generated', () => {

            const recipe = loadRecipe();
            applySelections(recipe, { validationRulesOff: { [GADGET_TREE_KEY]: { Gadget__c: ['Town__c', 'Stage__c'] } } });

            expect(treeOf(recipe).validationRulesOff).toEqual([
                { objectApiName: 'Gadget__c', fieldApiName: 'Stage__c' },
                { objectApiName: 'Gadget__c', fieldApiName: 'Town__c' }
            ]);

        });

        it.each(BACKEND_RUNS)('builds the $backend Run Faker copy with the value each switched-off field had before its rules, and names them for the data set', (backendRun) => {

            const recipe = loadRecipe(backendRun);
            applySelections(recipe, { validationRulesOff: { [GADGET_TREE_KEY]: { Gadget__c: ['Amount__c', 'Description__c'] } } });
            const recipeText = fs.readFileSync(recipeFilePathOf(backendRun), 'utf8');

            const filteredRecipe = RecipeCockpitService.buildRunFakerFilteredRecipe(recipeText, treeOf(recipe), undefined, recipe);

            if ( 'refusalMessage' in filteredRecipe ) {
                throw new Error(filteredRecipe.refusalMessage);
            }
            expect(filteredRecipe.validationRulesOffByObject).toEqual({ Gadget__c: ['Amount__c'] });
            expect(readFieldLines(filteredRecipe.recipeText, 'Gadget__c', 'Amount__c')).toEqual([`    Amount__c: ${readWrapperField(backendRun, 'Gadget__c', 'Amount__c').unconstrainedRecipeValue}`.split('\n')]);
            expect(filteredRecipe).not.toHaveProperty('constraintsByObject');

        });

        it('lists a field once even when a hand-edited wrapper repeats it', () => {

            const recipe = loadRecipe();
            objectOf(recipe, 'Gadget__c').fields.push({ ...fieldOf(recipe, 'Gadget__c', 'Amount__c') });
            applySelections(recipe, { validationRulesOff: { [GADGET_TREE_KEY]: { Gadget__c: ['Amount__c'] } } });

            expect(treeOf(recipe).validationRulesOff).toEqual([{ objectApiName: 'Gadget__c', fieldApiName: 'Amount__c' }]);

        });

        it('has nothing to swap for a field its rules did not change', () => {

            const recipe = loadRecipe();
            applySelections(recipe, { validationRulesOff: { [GADGET_TREE_KEY]: { Gadget__c: ['Description__c'] } } });

            expect(treeOf(recipe).validationRulesOff).toEqual([{ objectApiName: 'Gadget__c', fieldApiName: 'Description__c' }]);
            expect(RecipeCockpitService.listUnconstrainedValuesByObject(recipe, treeOf(recipe))).toEqual(new Map());

        });

    });

    describe('buildInsertConfirmationDetail', () => {

        it('names each field generated without its rules, leaving out one the rules did not change', () => {

            const recipe = loadRecipe();
            applySelections(recipe, {
                validationRulesOff: { [GADGET_TREE_KEY]: { Gadget__c: ['Amount__c', 'Stage__c', 'Description__c'] } }
            });

            const detail = RecipeCockpitService.buildInsertConfirmationDetail('my-sandbox', undefined, treeOf(recipe), recipe, new Map([['Gadget__c', 1]]), [], 'faker-js', 'recipe.yml');

            expect(detail).toContain('Validation rules switched off, so the org may reject these values: Gadget__c.Amount__c, Gadget__c.Stage__c\n');
            expect(detail).not.toContain('Faker constraints');

        });

        it('says nothing of validation rules while every one is applied', () => {

            const recipe = loadRecipe();
            applySelections(recipe);

            expect(RecipeCockpitService.buildInsertConfirmationDetail('my-sandbox', undefined, treeOf(recipe), recipe, new Map([['Gadget__c', 1]]), [], 'faker-js', 'recipe.yml')).not.toContain('Validation rules');

        });

    });

    describe('routePanelMessage setFieldValidationRuleApplied', () => {

        const buildDrawnPanelState = (choices: ISelectionChoices = {}): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState(VALIDATION_RULE_WORKSPACE_ROOT);
            const recipe = loadRecipe();
            applySelections(recipe, choices);
            panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 4 };
            panelState.treeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipe);
            return panelState;
        };

        const route = (payload: Record<string, unknown>, panelState = buildDrawnPanelState()) => RecipeCockpitService.routePanelMessage({ command: 'setFieldValidationRuleApplied', ...payload } as any, panelState);

        it('routes a drawn rule-shaped field to its folder, with the state asked for', () => {

            expect(route({ treeKey: GADGET_TREE_KEY, objectApiName: 'Gadget__c', fieldApiName: 'Amount__c', applied: false }))
                .toEqual({ kind: 'setFieldValidationRuleApplied', treeKey: GADGET_TREE_KEY, folderName: GADGET_TREE_KEY, objectApiName: 'Gadget__c', fieldApiName: 'Amount__c', isApplied: false });
            expect(route({ treeKey: GADGET_TREE_KEY, objectApiName: 'Gadget__c', fieldApiName: 'Town__c', applied: true })).toMatchObject({ isApplied: true });

        });

        it.each([
            ['a field whose rules were all not applied', { fieldApiName: 'Score__c' }],
            ['a field no rule names', { fieldApiName: 'Region__c' }],
            ['a friend\'s field no rule names', { objectApiName: 'Widget__c', fieldApiName: 'Weight__c' }],
            ['a state that is not a boolean', { applied: 'false' }],
            ['no state', { applied: undefined }],
            ['a forged card', { treeKey: 'Forged-Folder' }],
            ['a field no card draws', { fieldApiName: 'Not_A_Field__c' }],
            ['a field name that is a line of YAML', { fieldApiName: 'Amount__c: x\n    Evil' }],
            ['a nickname the object is not drawn with', { nickname: 'Gadget_Other' }]
        ])('does nothing for %s', (_caseName, payload) => {

            expect(route({ treeKey: GADGET_TREE_KEY, objectApiName: 'Gadget__c', fieldApiName: 'Amount__c', applied: false, ...payload })).toBeUndefined();

        });

        it('does nothing for a field with a fixed value, an unticked field, an excluded object\'s, before "rendered", or with no model', () => {

            const lockedPanelState = buildDrawnPanelState({ fixedValues: { [GADGET_TREE_KEY]: { Gadget__c: { Amount__c: '7' } } }, excludedFields: { [GADGET_TREE_KEY]: { Gadget__c: ['Quantity__c'] } } });
            const excludedPanelState = buildDrawnPanelState({ excludedObjects: { [GADGET_TREE_KEY]: ['Gadget__c'] } });
            const undrawnPanelState = buildDrawnPanelState();
            undrawnPanelState.treeHistoryAllowLists = RecipeCockpitService.buildEmptyTreeHistoryAllowLists();
            const modelLessPanelState = buildDrawnPanelState();
            modelLessPanelState.recipeDataMessage = undefined;
            const payload = { treeKey: GADGET_TREE_KEY, objectApiName: 'Gadget__c', fieldApiName: 'Amount__c', applied: false };

            expect(route(payload, lockedPanelState)).toBeUndefined();
            expect(route({ ...payload, fieldApiName: 'Quantity__c' }, lockedPanelState)).toBeUndefined();
            expect(route({ ...payload, fieldApiName: 'Notes__c' }, lockedPanelState)).toMatchObject({ kind: 'setFieldValidationRuleApplied' });
            expect(route(payload, excludedPanelState)).toBeUndefined();
            expect(route(payload, undrawnPanelState)).toBeUndefined();
            expect(route(payload, modelLessPanelState)).toBeUndefined();

        });

    });

    describe('openRecipeCockpitPanel', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;

        // THE Run Faker by Recipe CALL THE CARD'S INSERT MAKES (#375): THE RECIPE, AND ITS FILTERED COPY ONLY WHEN THE CARD LEAVES SOMETHING OUT
        const resolveRunFakerCall = (treeKey: string): any[] => {
            const panelState = (RecipeCockpitService as any).recipeCockpitPanelState;
            const recipeFilePath = panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(treeKey);
            const filteredRecipe = RecipeCockpitService.resolveRunFakerFilteredRecipe(panelState, treeKey, recipeFilePath, 'Nothing was generated or inserted for');
            return [RECIPE_COCKPIT_RUN_FAKER_COMMAND, recipeFilePath, ...( filteredRecipe ? [filteredRecipe] : [] )];
        };
        let disposeHandler: (() => void) | undefined;
        let postedPanelMessages: any[];

        const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);
        const executeCommand = vscode.commands.executeCommand as jest.Mock;
        const showWarningMessage = vscode.window.showWarningMessage as jest.Mock;
        const showInputBox = vscode.window.showInputBox as jest.Mock;
        const FAKER_JS_RECIPE_FILE_PATH = recipeFilePathOf(BACKEND_RUNS[0]);

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
            await RecipeCockpitService.openRecipeCockpitPanel(VALIDATION_RULE_WORKSPACE_ROOT, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            const recipeDataMessage = lastPosted('recipeData');
            await receivedMessageHandler({ command: 'rendered', renderSequence: recipeDataMessage.renderSequence });
            return recipeDataMessage;
        };

        const storedOf = (workspaceState: ReturnType<typeof buildWorkspaceState>) => workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY);
        const setAmountApplied = (applied: boolean) => receivedMessageHandler({ command: 'setFieldValidationRuleApplied', treeKey: GADGET_TREE_KEY, objectApiName: 'Gadget__c', fieldApiName: 'Amount__c', applied: applied });

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

        it('opens a newly generated tree with every rule applied', async () => {

            const recipeDataMessage = await openAndDraw(buildWorkspaceState());

            expect(recipeDataMessage.recipe.selectedRunFolderName).toBe(BACKEND_RUNS[0].runFolderName);
            expect(treeOf(recipeDataMessage.recipe)).not.toHaveProperty('validationRulesOff');

        });

        it('stores only the untick, posts the card back in place, and ticking again asks nothing; the recipe file never changes', async () => {

            const recipeBefore = fs.readFileSync(FAKER_JS_RECIPE_FILE_PATH, 'utf8');
            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);

            await setAmountApplied(false);

            expect(showWarningMessage).not.toHaveBeenCalled();
            expect(storedOf(workspaceState)).toEqual(storedSelections({ validationRulesOff: { [GADGET_TREE_KEY]: { Gadget__c: ['Amount__c'] } } }));
            expect(lastPosted('objectSelection')).toMatchObject({
                command: 'objectSelection',
                renderSequence: recipeDataMessage.renderSequence,
                treeKey: GADGET_TREE_KEY,
                validationRulesOff: [{ objectApiName: 'Gadget__c', fieldApiName: 'Amount__c' }]
            });
            await setAmountApplied(true);

            expect(showWarningMessage).not.toHaveBeenCalled();
            expect(storedOf(workspaceState)).toEqual(storedSelections({}));
            expect(lastPosted('objectSelection')).not.toHaveProperty('validationRulesOff');
            expect(fs.readFileSync(FAKER_JS_RECIPE_FILE_PATH, 'utf8')).toBe(recipeBefore);

        });

        it('writes nothing when the field is locked meanwhile, and routes nothing for a posted editFieldConstraints (#356)', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            await receivedMessageHandler({ command: 'setObjectIncluded', treeKey: GADGET_TREE_KEY, objectApiName: 'Gadget__c', included: false });
            const lockedStored = storedOf(workspaceState);

            await setAmountApplied(false);
            await receivedMessageHandler({ command: 'editFieldConstraints', treeKey: GADGET_TREE_KEY, objectApiName: 'Gadget__c', fieldApiName: 'Amount__c', min: '10', max: '20' });

            expect(storedOf(workspaceState)).toEqual(lockedStored);
            expect(showWarningMessage).not.toHaveBeenCalled();
            expect(showInputBox).not.toHaveBeenCalled();

        });

        it('writes nothing once the panel that drew the field is closed', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            const handleMessage = receivedMessageHandler;
            disposeHandler?.();
            disposeHandler = undefined;

            await handleMessage({ command: 'setFieldValidationRuleApplied', treeKey: GADGET_TREE_KEY, objectApiName: 'Gadget__c', fieldApiName: 'Amount__c', applied: false });

            expect(storedOf(workspaceState)).toBeUndefined();

        });

        it('writes nothing and asks nothing for a forged message on a field with no applied rule', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            workspaceState.update.mockClear();

            await receivedMessageHandler({ command: 'setFieldValidationRuleApplied', treeKey: GADGET_TREE_KEY, objectApiName: 'Gadget__c', fieldApiName: 'Score__c', applied: false });
            await receivedMessageHandler({ command: 'setFieldValidationRuleApplied', treeKey: GADGET_TREE_KEY, objectApiName: 'Gadget__c', fieldApiName: 'Region__c', applied: false });
            await receivedMessageHandler({ command: 'setFieldValidationRuleApplied', treeKey: GADGET_TREE_KEY, objectApiName: 'Widget__c', fieldApiName: 'Weight__c', applied: true });

            expect(workspaceState.update).not.toHaveBeenCalled();
            expect(showWarningMessage).not.toHaveBeenCalled();

        });

        it('Reset asks for a folder whose only change is an unticked rule, and ticks every box again', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ validationRulesOff: { [GADGET_TREE_KEY]: { Gadget__c: ['Amount__c', 'Town__c'] } } }) });
            await openAndDraw(workspaceState);

            showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL);
            await receivedMessageHandler({ command: 'resetTreeSelection', treeKey: GADGET_TREE_KEY });

            expect(showWarningMessage).toHaveBeenCalledTimes(1);
            expect(showWarningMessage.mock.calls[0][1].detail).toContain('every validation rule is applied again');
            expect(storedOf(workspaceState)).toEqual(storedSelections({}));
            expect(lastPosted('objectSelection')).not.toHaveProperty('validationRulesOff');

        });

        it('runs a card with a switched-off rule on a filtered copy that carries the value from before the rules, and never writes the recipe', async () => {

            const recipeBefore = fs.readFileSync(FAKER_JS_RECIPE_FILE_PATH, 'utf8');
            await openAndDraw(buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ validationRulesOff: { [GADGET_TREE_KEY]: { Gadget__c: ['Amount__c'] } } }) }));

            const runFakerCall = resolveRunFakerCall(GADGET_TREE_KEY);
            expect(runFakerCall).toHaveLength(3);
            expect(runFakerCall?.[1]).toBe(FAKER_JS_RECIPE_FILE_PATH);
            expect(runFakerCall?.[2]).toMatchObject({ excludedObjectApiNames: [], validationRulesOffByObject: { Gadget__c: ['Amount__c'] } });
            expect(readFieldLines(runFakerCall?.[2].recipeText, 'Gadget__c', 'Amount__c')).toEqual([`    Amount__c: ${readWrapperField(BACKEND_RUNS[0], 'Gadget__c', 'Amount__c').unconstrainedRecipeValue}`.split('\n')]);
            expect(fs.readFileSync(FAKER_JS_RECIPE_FILE_PATH, 'utf8')).toBe(recipeBefore);

        });

        it('runs a card with every rule applied, or only a rule that changed nothing switched off, on its recipe exactly as before', async () => {

            await openAndDraw(buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ validationRulesOff: { [GADGET_TREE_KEY]: { Gadget__c: ['Description__c'] } } }) }));

            expect(resolveRunFakerCall(GADGET_TREE_KEY)).toEqual([RECIPE_COCKPIT_RUN_FAKER_COMMAND, FAKER_JS_RECIPE_FILE_PATH]);

        });

    });

    describe('the panel script', () => {

        const drawRecipe = (choices: ISelectionChoices = {}) => {
            const panel = runPanelScript();
            const recipe = loadRecipe();
            recipe.trees.push({ treeKey: '', title: RECIPE_COCKPIT_UNGROUPED_TREE_TITLE, folderName: '', objects: [{ objectApiName: 'Gadget__c', parentLookups: [] }], fieldCount: 12 });
            applySelections(recipe, choices);
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
            panel.postToPanel({ command: 'loadPhase', message: '' });
            panel.expandAllTrees();
            return { panel, recipe };
        };

        type Panel = ReturnType<typeof runPanelScript>;
        const gadgetOf = (panel: Panel, isUngrouped = false) => {
            const gadgetElement = panel.objectElements()
                .filter(objectElement => panel.objectNameOf(objectElement) === 'Gadget__c')
                .find(objectElement => ( panel.findAll(objectElement, 'treeObjectInclude').length === 0 ) === isUngrouped);
            panel.expandObject(gadgetElement);
            return gadgetElement;
        };
        const rowOf = (panel: Panel, objectElement: any, fieldApiName: string) => panel.fieldRowNamed(objectElement, fieldApiName);
        const boxOf = (panel: Panel, objectElement: any, fieldApiName: string) => panel.findAll(rowOf(panel, objectElement, fieldApiName), 'treeFieldValidationRule')[0];
        const only = (panel: Panel, element: any, className: string) => panel.findAll(element, className)[0];

        it('draws a checked box at the end of a rule-shaped field\'s row, its title naming the rules', () => {

            const { panel } = drawRecipe();
            const gadget = gadgetOf(panel);
            const header = only(panel, rowOf(panel, gadget, 'Amount__c'), 'treeFieldHeader');
            const box = boxOf(panel, gadget, 'Amount__c');

            expect(header.children[header.children.length - 1].classList.contains('validationRuleControl')).toBeTrue();
            expect(box.parentNode).toBe(header.children[header.children.length - 1]);
            expect(box.tagName).toBe('button');
            expect(box.attributes.role).toBe('checkbox');
            expect(box.attributes['aria-checked']).toBe('true');
            expect(box.textContent).toBe('✓');
            expect(box.disabled).toBeFalse();
            expect(box.attributes.title).toBe(`Validation rules applied: ${AMOUNT_RULES.join(', ')} — untick to generate without them`);
            expect(boxOf(panel, gadget, 'Town__c').attributes.title).toBe('Validation rules applied: Restrict_Portland — untick to generate without them');

        });

        it('draws a muted note, and no box, for a field whose rules were all not applied; nothing for a field no rule names', () => {

            const { panel } = drawRecipe();
            const gadget = gadgetOf(panel);
            const scoreRow = rowOf(panel, gadget, 'Score__c');
            const note = only(panel, scoreRow, 'validationRuleNotApplied');

            expect(boxOf(panel, gadget, 'Score__c')).toBeUndefined();
            expect(note.classList.contains('muted')).toBeTrue();
            expect(note.textContent).toBe(`${RECIPE_COCKPIT_VALIDATION_RULE_NOT_APPLIED_LABEL}: Score_High, Score_Low`);
            expect(note.attributes.title).toContain('Score_High — together these rules leave no value to generate');
            expect(panel.findAll(rowOf(panel, gadget, 'Region__c'), 'validationRuleNotApplied')).toEqual([]);
            expect(boxOf(panel, gadget, 'Region__c')).toBeUndefined();

        });

        it('posts an untick as names and the state asked for, and draws the host\'s answer: unticked, the expression from before the rules, Reset shown', () => {

            const { panel, recipe } = drawRecipe();
            panel.postToPanel({ command: 'rendered' });
            const gadget = gadgetOf(panel);
            const expression = only(panel, rowOf(panel, gadget, 'Amount__c'), 'expression');
            const resetElement = panel.findAll(panel.treeCards()[0], 'treeResetSelection')[0];

            expect(expression.textContent).toBe(fieldOf(recipe, 'Gadget__c', 'Amount__c').recipeValue);
            boxOf(panel, gadget, 'Amount__c').dispatch('click');
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'setFieldValidationRuleApplied')).toEqual([
                { command: 'setFieldValidationRuleApplied', treeKey: GADGET_TREE_KEY, objectApiName: 'Gadget__c', fieldApiName: 'Amount__c', applied: false }
            ]);

            panel.postToPanel({ command: 'objectSelection', treeKey: GADGET_TREE_KEY, renderSequence: 99, validationRulesOff: [{ objectApiName: 'Gadget__c', fieldApiName: 'Amount__c' }] });
            expect(boxOf(panel, gadget, 'Amount__c').attributes['aria-checked']).toBe('true');

            panel.postToPanel({ command: 'objectSelection', treeKey: GADGET_TREE_KEY, renderSequence: 3, validationRulesOff: [{ objectApiName: 'Gadget__c', fieldApiName: 'Amount__c' }] });

            const box = boxOf(panel, gadget, 'Amount__c');
            expect(box.attributes['aria-checked']).toBe('false');
            expect(box.textContent).toBe('');
            expect(box.attributes.title).toBe(`Validation rules not applied: ${AMOUNT_RULES.join(', ')} — tick to apply them`);
            expect(expression.textContent).toBe(fieldOf(recipe, 'Gadget__c', 'Amount__c').validationRules?.unconstrainedExpression);
            expect(panel.isHidden(resetElement)).toBeFalse();

            box.dispatch('click');
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'setFieldValidationRuleApplied').at(-1)).toMatchObject({ fieldApiName: 'Amount__c', applied: true });

            panel.postToPanel({ command: 'objectSelection', treeKey: GADGET_TREE_KEY, renderSequence: 3 });
            expect(boxOf(panel, gadget, 'Amount__c').attributes['aria-checked']).toBe('true');
            expect(expression.textContent).toBe(fieldOf(recipe, 'Gadget__c', 'Amount__c').recipeValue);
            expect(panel.isHidden(resetElement)).toBeTrue();

        });

        it('disables the box of a field with a fixed value, or unticked, with the reason in its title, and posts nothing', () => {

            const { panel } = drawRecipe({ fixedValues: { [GADGET_TREE_KEY]: { Gadget__c: { Amount__c: '7' } } }, excludedFields: { [GADGET_TREE_KEY]: { Gadget__c: ['Quantity__c'] } } });
            const gadget = gadgetOf(panel);

            expect(boxOf(panel, gadget, 'Amount__c').disabled).toBeTrue();
            expect(boxOf(panel, gadget, 'Amount__c').attributes.title).toBe(`Validation rules ${AMOUNT_RULES.join(', ')} cannot be switched: ${RECIPE_COCKPIT_VALIDATION_RULE_FIXED_VALUE_REASON}`);
            expect(boxOf(panel, gadget, 'Quantity__c').attributes.title).toBe(`Validation rules Quantity_Cap, Quantity_Positive cannot be switched: ${RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON}`);

            boxOf(panel, gadget, 'Amount__c').dispatch('click');
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'setFieldValidationRuleApplied')).toEqual([]);

        });

        it('draws no box on the ungrouped card, which has no folder to keep a choice by', () => {

            const { panel } = drawRecipe();
            const ungroupedGadget = gadgetOf(panel, true);

            expect(panel.findAll(ungroupedGadget, 'treeFieldValidationRule')).toEqual([]);
            expect(panel.findAll(ungroupedGadget, 'expression').length).toBeGreaterThan(0);

        });

    });

});

/*
    What each state of the box GENERATES, through each backend's real reader: ticked, the recipe as
    #324 wrote it, every value inside the rules; unticked, the copy, whose values go back to the
    field's own range -- a value the rules forbid turns up, and every field still ticked keeps to them.
*/
describe('what each state of the validation-rule box generates (#325)', () => {

    const RECORD_COUNT = 300;

    const runnableRecipe = (recipeText: string): string => {
        const countedRecipe = recipeText.replace(/^(- object: Gadget__c\n(?: {2}\S.*\n)*?) {2}count: 1\n/m, `$1  count: ${RECORD_COUNT}\n`);
        expect(countedRecipe).toContain(`  count: ${RECORD_COUNT}\n`);
        return countedRecipe;
    };

    const buildCopy = (backendRun: BackendRun): string => {
        const recipe = loadRecipe(backendRun);
        applySelections(recipe, { validationRulesOff: { [GADGET_TREE_KEY]: { Gadget__c: ['Amount__c', 'Stage__c'] } } });
        const filteredRecipe = RecipeCockpitService.buildRunFakerFilteredRecipe(fs.readFileSync(recipeFilePathOf(backendRun), 'utf8'), treeOf(recipe), undefined, recipe);
        if ( 'refusalMessage' in filteredRecipe ) {
            throw new Error(filteredRecipe.refusalMessage);
        }
        return filteredRecipe.recipeText;
    };

    const isAmountInRules = (amount: unknown) => /^\d+(\.\d{1,2})?$/.test(String(amount)) && Number(amount) >= 100 && Number(amount) < 50000;
    const isQuantityInRules = (quantity: unknown) => /^\d+$/.test(String(quantity)) && Number(quantity) > 0 && Number(quantity) <= 500;

    const expectTicked = (gadgets: Array<Record<string, unknown>>) => {
        expect(gadgets).toHaveLength(RECORD_COUNT);
        expect(gadgets.filter(gadget => !isAmountInRules(gadget.Amount__c)).slice(0, 3)).toEqual([]);
        expect(gadgets.filter(gadget => gadget.Stage__c === 'Lost')).toEqual([]);
    };

    const expectUnticked = (gadgets: Array<Record<string, unknown>>) => {
        expect(gadgets).toHaveLength(RECORD_COUNT);
        expect(gadgets.some(gadget => !isAmountInRules(gadget.Amount__c))).toBeTrue();
        expect(gadgets.some(gadget => gadget.Stage__c === 'Lost')).toBeTrue();
        expect(gadgets.filter(gadget => !isQuantityInRules(gadget.Quantity__c)).slice(0, 3)).toEqual([]);
    };

    describe('faker-js, through the real recipe processor', () => {

        const generateGadgets = async (recipeText: string): Promise<Array<Record<string, unknown>>> => {
            const temporaryFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-validation-rule-box-'));
            try {
                const recipeFilePath = path.join(temporaryFolderPath, 'recipe.yml');
                fs.writeFileSync(recipeFilePath, runnableRecipe(recipeText));
                const generatedRecords = JSON.parse(await new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath)) as Array<{ object: string, fields: Record<string, unknown> }>;
                return generatedRecords.filter(generatedRecord => generatedRecord.object === 'Gadget__c').map(generatedRecord => generatedRecord.fields);
            } finally {
                fs.rmSync(temporaryFolderPath, { recursive: true, force: true });
            }
        };

        it('ticked, keeps every value inside the rules', async () => {
            expectTicked(await generateGadgets(fs.readFileSync(recipeFilePathOf(BACKEND_RUNS[0]), 'utf8')));
        });

        it('unticked, generates the field\'s own range, and the fields still ticked keep to theirs', async () => {
            expectUnticked(await generateGadgets(buildCopy(BACKEND_RUNS[0])));
        });

    });

    describe('snowfakery, read with PyYAML and rendered with Jinja and Faker', () => {

        const renderGadgets = (recipeText: string): Array<Record<string, unknown>> => PythonTestHarness.runPython([
            'import datetime, json, random, sys, yaml, jinja2',
            'from faker import Faker',
            'environment = jinja2.Environment(block_start_string="${%", block_end_string="%}", variable_start_string="${{", variable_end_string="}}")',
            'environment.globals.update(fake=Faker(), date=datetime.date.fromisoformat, datetime=datetime.datetime.fromisoformat, random_choice=lambda *options: random.choice(options))',
            'request = json.load(sys.stdin)',
            'recipe = [entry for entry in yaml.safe_load(request["recipeText"]) if entry.get("object") == "Gadget__c"][0]',
            'templates = {name: environment.from_string(value) for name, value in recipe["fields"].items() if isinstance(value, str)}',
            'print(json.dumps([{name: template.render() for name, template in templates.items()} for _ in range(recipe["count"])]))'
        ].join('\n'), { recipeText: runnableRecipe(recipeText) }) as Array<Record<string, unknown>>;

        PythonTestHarness.testRequiringModules('yaml', 'jinja2', 'faker')('ticked, keeps every value inside the rules', () => {
            expectTicked(renderGadgets(fs.readFileSync(recipeFilePathOf(BACKEND_RUNS[1]), 'utf8')));
        });

        PythonTestHarness.testRequiringModules('yaml', 'jinja2', 'faker')('unticked, generates the field\'s own range, and the fields still ticked keep to theirs', () => {
            expectUnticked(renderGadgets(buildCopy(BACKEND_RUNS[1])));
        });

    });

});
