import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

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
    RECIPE_COCKPIT_FIELD_CONTROLS_REASON_PREFIX,
    RECIPE_COCKPIT_FIELD_EDIT_NOT_SAVED_REFUSAL,
    RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH,
    RECIPE_COCKPIT_FIXED_VALUE_BADGE_LABEL,
    RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX,
    RECIPE_COCKPIT_FIXED_VALUE_GLYPH_PATH,
    RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_RECORD_TYPE_REASON,
    RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON,
    RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIXED_VALUES,
    RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL,
    RECIPE_COCKPIT_RUN_FAKER_COMMAND,
    RECIPE_COCKPIT_UNGROUPED_TREE_TITLE
} from '../RecipeCockpitService';
import { IRecipeFixedValue, RecipeCockpitRecipeWriter, RecipeFilterResult } from '../RecipeCockpitRecipeWriter';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';
import { HOSTILE_PICKLIST_VALUES, ORDINARY_PICKLIST_VALUES } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/HostilePicklistValues';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

/*
    #262: a pin beside each field's checkbox gives the field a fixed value that the generate button and the
    whole-tree insert generate in place of its faker expression. It is kept by tree folder beside the
    excluded objects, unticked fields and counts, and rides on the filtered copy: the recipe file is
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

function readFixture(fileName: string): string {
    return fs.readFileSync(path.join(recipeWriterMocksPath, fileName), 'utf8');
}

function expectFiltered(result: RecipeFilterResult): Extract<RecipeFilterResult, { isFiltered: true }> {
    if ( 'refusal' in result ) {
        throw new Error(`expected a filtered copy, got a refusal: ${result.refusal.message}`);
    }
    return result;
}

const text = (value: string): IRecipeFixedValue => ({ value: value, kind: 'text' });

const fixedValuesOf = (entries: Record<string, Record<string, IRecipeFixedValue>>) => new Map(Object.entries(entries).map(([objectApiName, byField]) => [objectApiName, new Map(Object.entries(byField))]));

const filterWithFixedValues = (recipeText: string, fixedValuesByObject: Map<string, Map<string, IRecipeFixedValue>>, excludedFieldApiNamesByObject?: Map<string, string[]>) => RecipeCockpitRecipeWriter.buildFilteredRecipe(recipeText, {
    excludedObjectApiNames: [],
    parentLookupsByObjectApiName: new Map([
        ['Contact', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]],
        ['Opportunity', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]],
        ['Case', [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }, { fieldApiName: 'ContactId', parentObjectApiName: 'Contact' }]]
    ]),
    ...( excludedFieldApiNamesByObject ? { excludedFieldApiNamesByObject: excludedFieldApiNamesByObject } : {} ),
    fixedValuesByObject: fixedValuesByObject
});

// EACH OCCURRENCE'S FIELD LINES, AS THE SCANNER READS THEM BACK
function readFieldLines(recipeText: string, objectApiName: string, fieldApiName: string): string[][] {
    const { lines } = RecipeCockpitRecipeWriter.splitRecipeLines(recipeText);
    return RecipeCockpitRecipeWriter.scanRecipeObjects(lines)
        .filter(scannedObject => scannedObject.objectApiName === objectApiName)
        .map(scannedObject => scannedObject.fields.find(scannedField => scannedField.fieldApiName === fieldApiName))
        .filter((scannedField): scannedField is NonNullable<typeof scannedField> => !!scannedField)
        .map(scannedField => lines.slice(scannedField.startIndex, scannedField.endIndex));
}

function writeTemporaryRecipe(recipeText: string): string {
    const directoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-fixed-values-test-'));
    const recipeFilePath = path.join(directoryPath, 'filteredRecipe.yml');
    fs.writeFileSync(recipeFilePath, recipeText);
    return recipeFilePath;
}

async function generateWithFakerJs(recipeText: string): Promise<Array<{ object: string; nickname: string; fields: Record<string, unknown> }>> {
    const recipeFilePath = writeTemporaryRecipe(recipeText);
    try {
        return JSON.parse(await new FakerJSRecipeProcessor().generateFakeDataBySelectedRecipeFile(recipeFilePath) as string);
    } finally {
        fs.rmSync(path.dirname(recipeFilePath), { recursive: true, force: true });
    }
}

const loadRecipeRun = () => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT,
    CURRENT_RUN_FOLDER_NAME
);

const loadRecipe = (): IRecipeCockpitRecipeViewModel => loadRecipeRun().recipeViewModel;

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

const storedSelections = (fixedValuesByFolderName: Record<string, unknown>, excludedObjectApiNamesByFolderName: Record<string, unknown> = {}, excludedFieldApiNamesByFolderName: Record<string, unknown> = {}) => ({
    version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    excludedObjectApiNamesByFolderName: excludedObjectApiNamesByFolderName,
    excludedFieldApiNamesByFolderName: excludedFieldApiNamesByFolderName,
    objectCountsByFolderName: {},
    fixedValuesByFolderName: fixedValuesByFolderName,
    constraintsByFolderName: {},
    validationRulesOffByFolderName: {}
});

const treeOf = (recipe: IRecipeCockpitRecipeViewModel, treeKey: string) => recipe.trees.find(tree => tree.treeKey === treeKey) as IRecipeCockpitTreeViewModel;
const objectOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string) => recipe.objects.find(objectViewModel => objectViewModel.objectApiName === objectApiName) as IRecipeCockpitObjectViewModel;
const fieldOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string, fieldApiName: string) => objectOf(recipe, objectApiName).fields.find(field => field.fieldApiName === fieldApiName) as IRecipeCockpitFieldViewModel;

const applyFixedValues = (recipe: IRecipeCockpitRecipeViewModel,
                            fixedValuesByFolderName: Record<string, Record<string, Record<string, string>>>,
                            excludedObjectApiNamesByFolderName: Record<string, string[]> = {},
                            excludedFieldApiNamesByFolderName: Record<string, Record<string, string[]>> = {}) => RecipeCockpitService.applyObjectSelections(
    recipe,
    new Map(Object.entries(excludedObjectApiNamesByFolderName).map(([folderName, objectApiNames]) => [folderName, new Set(objectApiNames)])),
    new Map(Object.entries(excludedFieldApiNamesByFolderName).map(([folderName, byObject]) => [folderName, new Map(Object.entries(byObject).map(([objectApiName, fieldApiNames]) => [objectApiName, new Set(fieldApiNames)]))])),
    undefined,
    new Map(),
    new Map(Object.entries(fixedValuesByFolderName).map(([folderName, byObject]) => [folderName, new Map(Object.entries(byObject).map(([objectApiName, byField]) => [objectApiName, new Map(Object.entries(byField))]))]))
);

describe('RecipeCockpitRecipeWriter -- fixed values (#262)', () => {

    describe('checkFixedValue', () => {

        it.each([
            ...ORDINARY_PICKLIST_VALUES,
            'EMEA', 'Yes', 'No', 'null', '~', '007', '1e3', '2024-01-01', '.inf', 'Type: A #1', 'a}}b', 'trailing\\', 'say "hi"', "x' or True or '", '-- {not a map}'
        ])('accepts the text %p', (value) => {
            expect(RecipeCockpitRecipeWriter.checkFixedValue(text(value))).toBeUndefined();
        });

        it.each(HOSTILE_PICKLIST_VALUES.filter(([, value]) => /[\r\n\u0085\u2028\u2029]|\$\{|\{\{|\{%|<<|<%/.test(value)))('refuses the hostile value with %s', (_caseName, value) => {
            expect(RecipeCockpitRecipeWriter.checkFixedValue(text(value))).toBeString();
        });

        it.each([
            ['empty', ''],
            ['a tab', 'a\tb'],
            ['a NUL', 'a\u0000b'],
            ['a byte-order mark', '﻿EMEA'],
            ['a template literal opener', '${x}'],
            ['a Jinja variable opener', '{{ x }}'],
            ['a Jinja block opener', '{% x %}'],
            ['a legacy snowfakery variable', '<< x >>'],
            ['a legacy snowfakery block', '<% x %>']
        ])('refuses %s', (_caseName, value) => {
            expect(RecipeCockpitRecipeWriter.checkFixedValue(text(value))).toBeString();
        });

        it.each(['0', '42', '-7', '3.25', '-0.5'])('accepts the number %p', (value) => {
            expect(RecipeCockpitRecipeWriter.checkFixedValue({ value: value, kind: 'number' })).toBeUndefined();
        });

        it.each(['007', '1e3', '+4', '4.', '.5', ' 4', '0x1F', 'four', '.inf'])('refuses the number %p', (value) => {
            expect(RecipeCockpitRecipeWriter.checkFixedValue({ value: value, kind: 'number' })).toBe('is not a plain number.');
        });

        it('accepts only true and false for a boolean, and refuses a kind it does not know', () => {
            expect(RecipeCockpitRecipeWriter.checkFixedValue({ value: 'true', kind: 'boolean' })).toBeUndefined();
            expect(RecipeCockpitRecipeWriter.checkFixedValue({ value: 'false', kind: 'boolean' })).toBeUndefined();
            ['True', 'yes', '1', 'on'].forEach(value => expect(RecipeCockpitRecipeWriter.checkFixedValue({ value: value, kind: 'boolean' })).toBe('is not true or false.'));
            expect(RecipeCockpitRecipeWriter.checkFixedValue({ value: 'x', kind: 'date' as any })).toBe('has no kind the writer knows.');
            expect(RecipeCockpitRecipeWriter.checkFixedValue({ value: 7 as any, kind: 'text' })).toBe('is empty.');
        });

    });

    describe('toFixedValueScalar', () => {

        it('double-quotes text, escaping only backslashes and double quotes, and writes a number or boolean plain', () => {
            expect(RecipeCockpitRecipeWriter.toFixedValueScalar(text('Yes'))).toBe('"Yes"');
            expect(RecipeCockpitRecipeWriter.toFixedValueScalar(text('say "hi" \\ bye'))).toBe('"say \\"hi\\" \\\\ bye"');
            expect(RecipeCockpitRecipeWriter.toFixedValueScalar({ value: '-3.25', kind: 'number' })).toBe('-3.25');
            expect(RecipeCockpitRecipeWriter.toFixedValueScalar({ value: 'false', kind: 'boolean' })).toBe('false');
        });

        it('quotes a number past 15 significant digits, which a double would not hold exactly, and leaves one of 15 plain', () => {
            expect(RecipeCockpitRecipeWriter.toFixedValueScalar({ value: '123456789012345', kind: 'number' })).toBe('123456789012345');
            expect(RecipeCockpitRecipeWriter.toFixedValueScalar({ value: '-0.000123456789012345', kind: 'number' })).toBe('-0.000123456789012345');
            expect(RecipeCockpitRecipeWriter.toFixedValueScalar({ value: '123456789012345678', kind: 'number' })).toBe('"123456789012345678"');
            expect(RecipeCockpitRecipeWriter.toFixedValueScalar({ value: '1234567890123456.78', kind: 'number' })).toBe('"1234567890123456.78"');
        });

    });

    describe('buildFilteredRecipe with fixedValuesByObject', () => {

        it('replaces the field on every occurrence of its object at that occurrence\'s depth, changes no other line, and reads it back', () => {

            const recipeText = readFixture(SELF_LOOKUP_FRIENDS_FIXTURE);
            const filtered = expectFiltered(filterWithFixedValues(recipeText, fixedValuesOf({ Account: { Name: text('Acme') } })));
            const [headerComment, ...filteredLines] = filtered.recipeText.split('\n');

            expect(headerComment).toBe('# Recipe Cockpit -- a filtered copy of this tree\'s recipe, with fixed values: Account.Name');
            expect(readFieldLines(filtered.recipeText, 'Account', 'Name')).toEqual([['    Name: "Acme"'], ['        Name: "Acme"']]);
            expect(filteredLines.filter(filteredLine => !recipeText.split('\n').includes(filteredLine))).toEqual(['    Name: "Acme"', '        Name: "Acme"']);
            expect(filteredLines).toHaveLength(recipeText.split('\n').length);
            expect(filtered.appliedFixedValues).toEqual([{ objectApiName: 'Account', fieldApiName: 'Name', value: 'Acme', kind: 'text' }]);
            expect(readFieldLines(filtered.recipeText, 'Opportunity', 'Name')).toEqual([['        Name: ${{ faker.commerce.productName() }}']]);

        });

        it('drops a multi-line field\'s continuation lines with its expression', () => {

            const filtered = expectFiltered(filterWithFixedValues(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), fixedValuesOf({ Opportunity: { Description: text('Fixed: "quoted" #1') } })));

            expect(readFieldLines(filtered.recipeText, 'Opportunity', 'Description')).toEqual([['        Description: "Fixed: \\"quoted\\" #1"']]);
            expect(filtered.recipeText).not.toContain('faker.lorem.paragraph');

        });

        it('writes a flat snowfakery field at the top-level field column', () => {

            const recipeText = readFixture(SNOWFAKERY_FIXTURE);
            const filtered = expectFiltered(filterWithFixedValues(recipeText, fixedValuesOf({ Account: { Name: text('Acme') } })));

            expect(readFieldLines(filtered.recipeText, 'Account', 'Name')).toEqual([['    Name: "Acme"']]);
            expect(filtered.recipeText.split('\n')).toHaveLength(recipeText.split('\n').length + 1);

        });

        it('returns the recipe byte for byte with no fixed value, and with one only for a field the recipe does not carry', () => {

            const recipeText = readFixture(SELF_LOOKUP_FRIENDS_FIXTURE);

            expect(expectFiltered(filterWithFixedValues(recipeText, new Map())).recipeText).toBe(recipeText);
            const filtered = expectFiltered(filterWithFixedValues(recipeText, fixedValuesOf({ Account: { Not_In_Recipe__c: text('x') }, Task: { Subject: text('x') } })));
            expect(filtered.recipeText).toBe(recipeText);
            expect(filtered.appliedFixedValues).toEqual([]);

        });

        it('leaves out an unticked field even when it has a fixed value', () => {

            const filtered = expectFiltered(filterWithFixedValues(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), fixedValuesOf({ Lead: { LastName: text('Smith') } }), new Map([['Lead', ['LastName']]])));

            expect(readFieldLines(filtered.recipeText, 'Lead', 'LastName')).toEqual([]);
            expect(filtered.appliedFixedValues).toEqual([]);

        });

        it('combines with a count and an unticked field in the header', () => {

            const filtered = expectFiltered(RecipeCockpitRecipeWriter.buildFilteredRecipe(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), {
                excludedObjectApiNames: [],
                parentLookupsByObjectApiName: new Map(),
                excludedFieldApiNamesByObject: new Map([['Opportunity', ['Description']]]),
                objectCountsByObject: new Map([['Lead', 4]]),
                fixedValuesByObject: fixedValuesOf({ Lead: { LastName: text('Smith') } })
            }));

            expect(filtered.recipeText.split('\n')[0]).toBe('# Recipe Cockpit -- a filtered copy of this tree\'s recipe, leaving out: fields Opportunity.Description; with counts: Lead 4; with fixed values: Lead.LastName');

        });

        it.each([
            ['a line break', text('a\nb'), 'invalid-value'],
            ['a template opener', text('${{ 7*7 }}'), 'invalid-value'],
            ['a number that is not plain', { value: '1e3', kind: 'number' as const }, 'invalid-value']
        ])('refuses %s before writing anything', (_caseName, fixedValue, reason) => {

            const result = filterWithFixedValues(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), fixedValuesOf({ Lead: { LastName: fixedValue } }));

            expect('refusal' in result && result.refusal).toMatchObject({ reason: reason, objectApiName: 'Lead', fieldApiName: 'LastName' });

        });

        it('refuses a value that is exactly a nickname in the recipe, which generation would read as a reference to that record', () => {

            const result = filterWithFixedValues(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), fixedValuesOf({ Opportunity: { Description: text('Account_NickName') } }));

            expect('refusal' in result && result.refusal).toMatchObject({ reason: 'invalid-value', objectApiName: 'Opportunity', fieldApiName: 'Description' });
            expect(expectFiltered(filterWithFixedValues(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), fixedValuesOf({ Opportunity: { Description: text('Account_NickName ') } }))).appliedFixedValues).toHaveLength(1);

        });

        it('generates an 18-digit number exactly through the faker-js processor, as its digits', async () => {

            const filtered = expectFiltered(filterWithFixedValues(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), fixedValuesOf({ Lead: { LastName: { value: '123456789012345678', kind: 'number' } } })));
            const generatedRecords = await generateWithFakerJs(filtered.recipeText);

            expect(generatedRecords.find(record => record.object === 'Lead')?.fields['LastName']).toBe('123456789012345678');

        });

        it('refuses an object or field name that is not an api name', () => {

            const badObject = filterWithFixedValues(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), new Map([['Lead\n- object: Evil', new Map([['LastName', text('x')]])]]));
            const badField = filterWithFixedValues(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), new Map([['Lead', new Map([['LastName: x\n    Evil', text('x')]])]]));

            expect('refusal' in badObject && badObject.refusal.reason).toBe('invalid-object-api-name');
            expect('refusal' in badField && badField.refusal.reason).toBe('invalid-field-api-name');

        });

        it.each([...ORDINARY_PICKLIST_VALUES, 'Yes', '007', 'null', 'say "hi" \\ bye', 'Type: A #1', 'a}}b', "x' or True or '"])('generates the text %p exactly through the faker-js processor, on every record', async (value) => {

            const filtered = expectFiltered(filterWithFixedValues(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), fixedValuesOf({ Account: { Name: text(value) }, Opportunity: { Description: text(value) } })));
            const generatedRecords = await generateWithFakerJs(filtered.recipeText);
            const accounts = generatedRecords.filter(record => record.object === 'Account');
            const opportunities = generatedRecords.filter(record => record.object === 'Opportunity');

            expect(accounts.length).toBeGreaterThan(2);
            accounts.forEach(account => expect(account.fields['Name']).toBe(value));
            opportunities.forEach(opportunity => expect(opportunity.fields['Description']).toBe(value));

        });

        it('generates a number and a boolean as their own types through the faker-js processor', async () => {

            const filtered = expectFiltered(filterWithFixedValues(readFixture(SELF_LOOKUP_FRIENDS_FIXTURE), fixedValuesOf({ Lead: { LastName: { value: '-3.25', kind: 'number' } }, Opportunity: { StageName: { value: 'false', kind: 'boolean' } } })));
            const generatedRecords = await generateWithFakerJs(filtered.recipeText);

            expect(generatedRecords.find(record => record.object === 'Lead')?.fields['LastName']).toBe(-3.25);
            expect(generatedRecords.find(record => record.object === 'Opportunity')?.fields['StageName']).toBeFalse();

        });

        PythonTestHarness.testRequiringModules('yaml', 'jinja2')('loads a snowfakery copy in PyYAML as exactly the text typed, which snowfakery\'s template selection then leaves as it is', () => {

            const values = [...ORDINARY_PICKLIST_VALUES, 'Yes', '007', 'null', 'say "hi" \\ bye', 'Type: A #1', 'a}}b', '2024-01-01'];
            const recipeTexts = values.map(value => expectFiltered(filterWithFixedValues(readFixture(SNOWFAKERY_FIXTURE), fixedValuesOf({ Account: { Name: text(value) } }))).recipeText);

            const loadedRecipes = PythonTestHarness.loadWithPyYaml(recipeTexts) as Array<Array<{ object: string; fields: Record<string, unknown> }>>;
            const loadedNames = loadedRecipes.map(loadedRecipe => loadedRecipe.find(entry => entry.object === 'Account')?.fields['Name']);

            expect(loadedNames).toEqual(values);
            expect(PythonTestHarness.renderWithSnowfakeryJinja(values.map(value => ({ template: value })))).toEqual(values.map(value => ({ rendered: value })));

        });

    });

});

describe('RecipeCockpitService -- fixed values (#262)', () => {

    describe('readTreeSelections and writeTreeSelections', () => {

        it('writes the current version with a folder, object and field named __proto__ as keys, and reads back every api name', async () => {

            const workspaceState = buildWorkspaceState();
            await expect(RecipeCockpitService.writeTreeSelections(workspaceState, {
                excludedObjectApiNamesByFolderName: new Map(),
                excludedFieldApiNamesByFolderName: new Map(),
                objectCountsByFolderName: new Map(),
                fixedValuesByFolderName: new Map([
                    [ACCOUNT_TREE_KEY, new Map([['Account', new Map([['Legacy_Code__c', 'X-1'], ['__proto__', 'y']])], ['__proto__', new Map([['Name', 'z']])]])],
                    ['__proto__', new Map([['Lead', new Map([['Company', 'Acme']])]])],
                    ['Empty-Tree', new Map([['Lead', new Map()]])]
                ]),
                constraintsByFolderName: new Map(),
                validationRulesOffByFolderName: new Map()
            })).resolves.toBeTrue();

            const stored = workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY) as any;
            expect(stored.version).toBe(RECIPE_COCKPIT_OBJECT_SELECTION_VERSION);
            expect(Object.keys(stored.fixedValuesByFolderName)).toEqual([ACCOUNT_TREE_KEY, '__proto__']);
            expect(Object.keys(stored.fixedValuesByFolderName[ACCOUNT_TREE_KEY])).toEqual(['Account', '__proto__']);
            expect(Object.keys(stored.fixedValuesByFolderName[ACCOUNT_TREE_KEY].Account)).toEqual(['Legacy_Code__c', '__proto__']);

            expect(RecipeCockpitService.readTreeSelections(workspaceState).fixedValuesByFolderName).toEqual(new Map([
                [ACCOUNT_TREE_KEY, new Map([['Account', new Map([['Legacy_Code__c', 'X-1']])]])],
                ['__proto__', new Map([['Lead', new Map([['Company', 'Acme']])]])]
            ]));

        });

        it('drops every value no kind could write, and every name that is not an api name', () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({
                [ACCOUNT_TREE_KEY]: {
                    Account: { Legacy_Code__c: 'ok', Name: 'a\nb', Rating__c: '${{ 7*7 }}', Score__c: 4, 'Bad Name': 'x', Empty__c: '', Long__c: 'x'.repeat(40000) },
                    'Bad Object': { Name: 'x' },
                    Contact: 'not a map'
                },
                '': { Lead: { Company: 'x' } },
                [LEAD_TREE_KEY]: ['Lead']
            }) });

            expect(RecipeCockpitService.readTreeSelections(workspaceState).fixedValuesByFolderName).toEqual(new Map([
                [ACCOUNT_TREE_KEY, new Map([['Account', new Map([['Legacy_Code__c', 'ok']])]])]
            ]));

        });

        it('reads a version 3 entry, written before fixed values, as its selection with no fixed values', () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: {
                ...storedSelections({ [ACCOUNT_TREE_KEY]: { Account: { Legacy_Code__c: 'X' } } }, { [ACCOUNT_TREE_KEY]: ['Contact'] }),
                version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIXED_VALUES,
                objectCountsByFolderName: { [LEAD_TREE_KEY]: { Lead: 3 } }
            } });

            const treeSelections = RecipeCockpitService.readTreeSelections(workspaceState);

            expect(treeSelections.fixedValuesByFolderName.size).toBe(0);
            expect(treeSelections.excludedObjectApiNamesByFolderName).toEqual(new Map([[ACCOUNT_TREE_KEY, new Set(['Contact'])]]));
            expect(treeSelections.objectCountsByFolderName).toEqual(new Map([[LEAD_TREE_KEY, new Map([['Lead', 3]])]]));

        });

        it('keeps the stored fixed values when #219\'s writeObjectSelections writes the objects', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [LEAD_TREE_KEY]: { Lead: { Company: 'Acme' } } }) });

            await RecipeCockpitService.writeObjectSelections(workspaceState, new Map([[ACCOUNT_TREE_KEY, new Set(['Contact'])]]));

            expect(workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY)).toEqual(storedSelections({ [LEAD_TREE_KEY]: { Lead: { Company: 'Acme' } } }, { [ACCOUNT_TREE_KEY]: ['Contact'] }));

        });

    });

    describe('findFixedValueLockReason, buildTreeFixedValues and applyObjectSelections', () => {

        const lockReasonOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string, fieldApiName: string, treeKey = ACCOUNT_TREE_KEY) =>
            RecipeCockpitService.findFixedValueLockReason(treeOf(recipe, treeKey), objectOf(recipe, objectApiName), fieldOf(recipe, objectApiName, fieldApiName));

        it('locks a lookup, RecordTypeId, a dependent picklist and a controlling field, and leaves every other field free', () => {

            const recipe = loadRecipe();
            applyFixedValues(recipe, {});
            objectOf(recipe, 'Account').fields.push({ ...fieldOf(recipe, 'Account', 'Legacy_Code__c'), fieldApiName: 'RecordTypeId', fieldType: '', fieldTypeWithSize: '' });

            expect(lockReasonOf(recipe, 'Account', 'ParentId')).toBe(RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_REASON);
            expect(lockReasonOf(recipe, 'Account', 'OwnerId')).toBe(RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_REASON);
            expect(lockReasonOf(recipe, 'Contact', 'AccountId')).toBe(RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_REASON);
            expect(lockReasonOf(recipe, 'Account', 'RecordTypeId')).toBe(RECIPE_COCKPIT_FIXED_VALUE_RECORD_TYPE_REASON);
            expect(lockReasonOf(recipe, 'Account', 'Sub_Rating__c')).toBe(`${RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX}Rating__c`);
            expect(lockReasonOf(recipe, 'Account', 'Rating__c')).toBe(`${RECIPE_COCKPIT_FIELD_CONTROLS_REASON_PREFIX}Sub_Rating__c`);
            ['Name', 'Legacy_Code__c', 'Annual_Budget__c', 'Regions__c'].forEach(fieldApiName => expect(lockReasonOf(recipe, 'Account', fieldApiName)).toBeUndefined());
            expect(lockReasonOf(recipe, 'Lead', 'Status', LEAD_TREE_KEY)).toBeUndefined();

        });

        it('locks an unticked field and every field of an excluded object', () => {

            const recipe = loadRecipe();
            applyFixedValues(recipe, {}, { [ACCOUNT_TREE_KEY]: ['Contact'] }, { [ACCOUNT_TREE_KEY]: { Account: ['Legacy_Code__c'] } });

            expect(lockReasonOf(recipe, 'Account', 'Legacy_Code__c')).toBe(RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON);
            expect(lockReasonOf(recipe, 'Contact', 'LastName')).toBe(RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON);
            expect(lockReasonOf(recipe, 'OtherChildObject__c', 'Score__c')).toBe(RECIPE_COCKPIT_FIXED_VALUE_OBJECT_EXCLUDED_REASON);

        });

        it('sets tree.fixedValues only for a free field of its folder, with the kind its type writes', () => {

            const recipe = loadRecipe();
            applyFixedValues(recipe, { [ACCOUNT_TREE_KEY]: {
                Account: { Name: 'Acme', Annual_Budget__c: '12.50', ParentId: 'x', Sub_Rating__c: 'Very Hot', Rating__c: 'Hot', Not_A_Field__c: 'x' },
                OtherChildObject__c: { Score__c: '4' },
                Lead: { Company: 'not this card' }
            } });

            expect(treeOf(recipe, ACCOUNT_TREE_KEY).fixedValues).toEqual([
                { objectApiName: 'Account', fieldApiName: 'Name', value: 'Acme', kind: 'text' },
                { objectApiName: 'Account', fieldApiName: 'Annual_Budget__c', value: '12.50', kind: 'number' },
                { objectApiName: 'OtherChildObject__c', fieldApiName: 'Score__c', value: '4', kind: 'number' }
            ]);
            expect(treeOf(recipe, LEAD_TREE_KEY)).not.toHaveProperty('fixedValues');

        });

        it('holds back a value its field\'s kind could not write, and a value of an unticked field or excluded object, which come back once freed', () => {

            const recipe = loadRecipe();
            const stored = { [ACCOUNT_TREE_KEY]: { Account: { Annual_Budget__c: 'lots', Legacy_Code__c: 'X-1' }, Contact: { LastName: 'Smith' } } };

            applyFixedValues(recipe, stored, { [ACCOUNT_TREE_KEY]: ['Contact'] }, { [ACCOUNT_TREE_KEY]: { Account: ['Legacy_Code__c'] } });
            expect(treeOf(recipe, ACCOUNT_TREE_KEY)).not.toHaveProperty('fixedValues');

            applyFixedValues(recipe, stored);
            expect(treeOf(recipe, ACCOUNT_TREE_KEY).fixedValues).toEqual([
                { objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'X-1', kind: 'text' },
                { objectApiName: 'Contact', fieldApiName: 'LastName', value: 'Smith', kind: 'text' }
            ]);

        });

        it('posts no fixedValues on any card when nothing is stored, and drops ones it set before', () => {

            const recipe = loadRecipe();
            applyFixedValues(recipe, { [LEAD_TREE_KEY]: { Lead: { Company: 'Acme' } } });
            expect(treeOf(recipe, LEAD_TREE_KEY).fixedValues).toHaveLength(1);

            applyFixedValues(recipe, {});
            recipe.trees.forEach(tree => expect(tree).not.toHaveProperty('fixedValues'));

        });

        it('builds the Run Faker copy with the fixed values, and names them for the data set', () => {

            const recipe = loadRecipe();
            applyFixedValues(recipe, { [ACCOUNT_TREE_KEY]: { Account: { Legacy_Code__c: 'X "1"', Annual_Budget__c: '12.5' } } });

            const filteredRecipe = RecipeCockpitService.buildRunFakerFilteredRecipe(fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8'), treeOf(recipe, ACCOUNT_TREE_KEY), undefined, recipe);

            if ( 'refusalMessage' in filteredRecipe ) {
                throw new Error(filteredRecipe.refusalMessage);
            }
            expect(filteredRecipe.fixedValuesByObject).toEqual({ Account: { Legacy_Code__c: 'X "1"', Annual_Budget__c: '12.5' } });
            expect(filteredRecipe).not.toHaveProperty('objectCountsByObject');
            expect(readFieldLines(filteredRecipe.recipeText, 'Account', 'Legacy_Code__c')).toEqual([['    Legacy_Code__c: "X \\"1\\""']]);
            expect(readFieldLines(filteredRecipe.recipeText, 'Account', 'Annual_Budget__c')).toEqual([['    Annual_Budget__c: 12.5']]);

        });

    });

    describe('validateFixedValueInput', () => {

        const recipe = loadRecipe();
        const validate = (objectApiName: string, fieldApiName: string, value: string, declaredValues?: string[]) =>
            RecipeCockpitService.validateFixedValueInput(value, fieldOf(recipe, objectApiName, fieldApiName), declaredValues);

        it('holds a number to its precision and scale', () => {
            expect(validate('Account', 'Annual_Budget__c', '9999999999999999.99')).toBeUndefined();
            expect(validate('Account', 'Annual_Budget__c', '-0.5')).toBeUndefined();
            expect(validate('Account', 'Annual_Budget__c', '1.005')).toBe('Currency(18,2) takes at most 2 decimal places.');
            expect(validate('Account', 'Annual_Budget__c', '12345678901234567')).toBe('Currency(18,2) takes at most 16 digits before the decimal point.');
            expect(validate('OtherChildObject__c', 'Score__c', '1.5')).toBe('Number(18,0) takes at most 0 decimal places.');
            expect(validate('OtherChildObject__c', 'Ratio__c', '999.99')).toBeUndefined();
            expect(validate('OtherChildObject__c', 'Ratio__c', '1000')).toBe('Percent(5,2) takes at most 3 digits before the decimal point.');
            expect(validate('OtherChildObject__c', 'Ratio__c', 'lots')).toBe('Type a plain number, such as 42, -7 or 3.25.');
        });

        it('takes a value under 1 for a field whose precision equals its scale', () => {
            const fraction = { ...fieldOf(recipe, 'OtherChildObject__c', 'Ratio__c'), fieldTypeWithSize: 'Number(2,2)' };
            expect(RecipeCockpitService.validateFixedValueInput('0.5', fraction, undefined)).toBeUndefined();
            expect(RecipeCockpitService.validateFixedValueInput('-0.99', fraction, undefined)).toBeUndefined();
            expect(RecipeCockpitService.validateFixedValueInput('1.5', fraction, undefined)).toBe('Number(2,2) takes at most 0 digits before the decimal point.');
        });

        it('escapes a type the workspace wrote that could form a link, and the typed text it echoes', () => {
            const linkType = '[Show allowed values](command:workbench.action.terminal.sendSequence)';
            const linkField = { ...fieldOf(recipe, 'Account', 'Legacy_Code__c'), fieldType: linkType, fieldTypeWithSize: `${linkType}(1)` };

            const message = RecipeCockpitService.validateFixedValueInput('xy', linkField, undefined) as string;
            expect(message).toEndWith(' takes at most 1 characters.');
            expect(message).not.toMatch(/[[\]()]/);
            expect(validate('Lead', 'Status', '[x](command:y)', ['Open'])).toBe('"\\u005bx\\u005d\\u0028command:y\\u0029" is not a value this picklist declares.');
        });

        it('holds text to its length and refuses what the writer refuses', () => {
            expect(validate('Account', 'Legacy_Code__c', 'x'.repeat(50))).toBeUndefined();
            expect(validate('Account', 'Legacy_Code__c', 'x'.repeat(51))).toBe('Text(50) takes at most 50 characters.');
            expect(validate('Account', 'Legacy_Code__c', 'a\nb')).toBe('This value has a line break or another control character in it.');
            expect(validate('Account', 'Legacy_Code__c', '<< 7*7 >>')).toBe('This value has "<<" in it, which a faker backend would read as the start of a template.');
            expect(validate('Account', 'Name', 'Any length at all, the recipe-only Name has no type')).toBeUndefined();
            expect(validate('Account', 'Name', 'x'.repeat(32769))).toBe('A fixed value can be at most 32768 characters.');
        });

        it('holds a picklist to its declared values, each of a multi-select once', () => {
            expect(validate('Lead', 'Status', 'Open', ['Open', 'Closed'])).toBeUndefined();
            expect(validate('Lead', 'Status', 'Pending', ['Open', 'Closed'])).toBe('"Pending" is not a value this picklist declares.');
            expect(validate('Account', 'Regions__c', 'EMEA;APAC', ['EMEA', 'APAC'])).toBeUndefined();
            expect(validate('Account', 'Regions__c', 'EMEA;Mars', ['EMEA', 'APAC'])).toBe('"Mars" is not a value this picklist declares.');
            expect(validate('Account', 'Regions__c', 'EMEA;EMEA', ['EMEA', 'APAC'])).toBe('A multi-select picklist value names each value once.');
            expect(validate('Account', 'Regions__c', 'Anything', [])).toBeUndefined();
        });

        it('holds a checkbox, date and date-time to their forms', () => {
            const checkbox = { ...fieldOf(recipe, 'Account', 'Legacy_Code__c'), fieldType: 'Checkbox', fieldTypeWithSize: 'Checkbox' };
            const date = { ...checkbox, fieldType: 'Date', fieldTypeWithSize: 'Date' };
            const dateTime = { ...checkbox, fieldType: 'DateTime', fieldTypeWithSize: 'DateTime' };

            expect(RecipeCockpitService.validateFixedValueInput('true', checkbox, undefined)).toBeUndefined();
            expect(RecipeCockpitService.validateFixedValueInput('Yes', checkbox, undefined)).toBe('Type true or false.');
            expect(RecipeCockpitService.validateFixedValueInput('2024-02-29', date, undefined)).toBeUndefined();
            ['2023-02-29', '2024-13-01', '01/02/2024', '2024-1-1'].forEach(value => expect(RecipeCockpitService.validateFixedValueInput(value, date, undefined)).toBe('Type a date as YYYY-MM-DD, such as 2026-01-31.'));
            ['2026-01-31T09:30:00Z', '2026-01-31T09:30Z', '2026-01-31T09:30:00.123+05:30'].forEach(value => expect(RecipeCockpitService.validateFixedValueInput(value, dateTime, undefined)).toBeUndefined());
            ['2026-01-31T09:30:00', '2026-01-31 09:30:00Z', '2026-02-30T09:30:00Z', '2026-01-31T24:00:00Z'].forEach(value => expect(RecipeCockpitService.validateFixedValueInput(value, dateTime, undefined)).toBe('Type a date and time as ISO 8601 with a zone, such as 2026-01-31T09:30:00Z.'));
        });

    });

    describe('routePanelMessage setFieldFixedValue', () => {

        const buildDrawnPanelState = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
            const recipe = loadRecipe();
            recipe.trees.push({ treeKey: '', title: RECIPE_COCKPIT_UNGROUPED_TREE_TITLE, folderName: '', objects: [{ objectApiName: 'Lead', parentLookups: [] }], fieldCount: 2 });
            applyFixedValues(recipe, {});
            recipeChanges(recipe);
            panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 4 };
            panelState.treeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipe);
            return panelState;
        };

        const route = (payload: Record<string, unknown>, panelState = buildDrawnPanelState()) => RecipeCockpitService.routePanelMessage({ command: 'setFieldFixedValue', ...payload } as any, panelState);

        it('routes a drawn, free field to its folder with the value as typed, which the host checks before writing (#337)', () => {

            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: '${{ 7*7 }}', extra: 'ignored' }))
                .toEqual({ kind: 'setFieldFixedValue', treeKey: ACCOUNT_TREE_KEY, folderName: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: '${{ 7*7 }}' });
            expect(route({ treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', value: '' })).toMatchObject({ kind: 'setFieldFixedValue', folderName: LEAD_TREE_KEY, value: '' });
            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'x'.repeat(RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH) }))
                .toMatchObject({ kind: 'setFieldFixedValue' });

        });

        it.each([
            ['a lookup', { fieldApiName: 'ParentId' }],
            ['a dependent picklist', { fieldApiName: 'Sub_Rating__c' }],
            ['a controlling field', { fieldApiName: 'Rating__c' }],
            ['a field of another card', { treeKey: LEAD_TREE_KEY }],
            ['a field no card draws', { fieldApiName: 'Not_A_Field__c' }],
            ['a field name that is a line of YAML', { fieldApiName: 'Name: x\n    Evil' }],
            ['an object name that is not an api name', { objectApiName: 'Account Name' }],
            ['a key that is not a string', { treeKey: 7 }],
            ['a nickname the object is not drawn with', { nickname: 'Account_NickName' }],
            ['a nickname that is not a string', { nickname: 7 }],
            ['the ungrouped card, which has no folder', { treeKey: '', objectApiName: 'Lead', fieldApiName: 'Company' }],
            ['no value', { value: undefined }],
            ['a value that is not a string', { value: 7 }],
            ['a value longer than any fixed value can be', { value: 'x'.repeat(RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH + 1) }]
        ])('does nothing for %s', (_caseName, payload) => {

            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'X-1', ...payload })).toBeUndefined();

        });

        it('does nothing for an unticked field or an excluded object\'s', () => {

            const panelState = buildDrawnPanelState(recipe => applyFixedValues(recipe, {}, { [ACCOUNT_TREE_KEY]: ['Contact'] }, { [ACCOUNT_TREE_KEY]: { Account: ['Legacy_Code__c'] } }));

            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'X' }, panelState)).toBeUndefined();
            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', fieldApiName: 'LastName', value: 'X' }, panelState)).toBeUndefined();
            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Annual_Budget__c', value: '1' }, panelState)).toMatchObject({ kind: 'setFieldFixedValue' });

        });

        it('does nothing before "rendered", after "ready" or a failure to draw, or with no model', () => {

            const undrawnPanelState = buildDrawnPanelState();
            undrawnPanelState.treeHistoryAllowLists = RecipeCockpitService.buildEmptyTreeHistoryAllowLists();
            const modelLessPanelState = buildDrawnPanelState();
            modelLessPanelState.recipeDataMessage = undefined;

            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'X' }, undrawnPanelState)).toBeUndefined();
            expect(route({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'X' }, modelLessPanelState)).toBeUndefined();

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

        it('stores the value the inline editor posts, posts the card back in place and then the result, clears it on an empty value, and opens no box; the recipe file never changes (#337)', async () => {

            const recipeBefore = fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8');
            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'X-1' });

            expect(storedOf(workspaceState)).toEqual(storedSelections({ [ACCOUNT_TREE_KEY]: { Account: { Legacy_Code__c: 'X-1' } } }));
            const objectSelectionIndex = postedPanelMessages.findIndex(hostMessage => hostMessage.command === 'objectSelection');
            const resultIndex = postedPanelMessages.findIndex(hostMessage => hostMessage.command === 'fieldEditResult');
            expect(postedPanelMessages[objectSelectionIndex]).toMatchObject({
                renderSequence: recipeDataMessage.renderSequence,
                treeKey: ACCOUNT_TREE_KEY,
                fixedValues: [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'X-1', kind: 'text' }]
            });
            expect(resultIndex).toBeGreaterThan(objectSelectionIndex);
            expect(postedPanelMessages[resultIndex]).toEqual({
                command: 'fieldEditResult', renderSequence: recipeDataMessage.renderSequence, treeKey: ACCOUNT_TREE_KEY,
                objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', edit: 'fixedValue'
            });

            // A REVEAL REPLAYS THE STORED MODEL, WHICH CARRIES THE VALUE
            postedPanelMessages = [];
            await receivedMessageHandler({ command: 'ready' });
            expect(treeOf(lastPosted('recipeData').recipe, ACCOUNT_TREE_KEY).fixedValues).toEqual([{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'X-1', kind: 'text' }]);
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastPosted('recipeData').renderSequence });

            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: '' });

            expect(storedOf(workspaceState)).toEqual(storedSelections({}));
            expect(lastPosted('objectSelection')).not.toHaveProperty('fixedValues');
            expect(lastPosted('fieldEditResult')).not.toHaveProperty('refusal');
            expect(showInputBox).not.toHaveBeenCalled();
            expect(fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8')).toBe(recipeBefore);

        });

        it('answers a value the field cannot hold with its refusal, for the editor to show, and writes nothing', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);
            workspaceState.update.mockClear();
            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: '${{ 7*7 }}' });
            expect(lastPosted('fieldEditResult')).toEqual({
                command: 'fieldEditResult', renderSequence: recipeDataMessage.renderSequence, treeKey: ACCOUNT_TREE_KEY,
                objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', edit: 'fixedValue',
                refusal: 'This value has "${" in it, which a faker backend would read as the start of a template.'
            });

            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'x'.repeat(51) });
            expect(lastPosted('fieldEditResult').refusal).toBe('Text(50) takes at most 50 characters.');

            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', value: 'Pending' });
            expect(lastPosted('fieldEditResult').refusal).toBe('"Pending" is not a value this picklist declares.');

            expect(lastPosted('objectSelection')).toBeUndefined();
            expect(workspaceState.update).not.toHaveBeenCalled();
            expect(warningSpy).not.toHaveBeenCalled();

            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Status', value: 'Closed' });
            expect(storedOf(workspaceState)).toEqual(storedSelections({ [LEAD_TREE_KEY]: { Lead: { Status: 'Closed' } } }));

        });

        it('answers a save the workspace storage refused as not saved', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            workspaceState.update.mockRejectedValueOnce(new Error('read-only'));
            jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);

            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'X-1' });

            expect(lastPosted('fieldEditResult').refusal).toBe(RECIPE_COCKPIT_FIELD_EDIT_NOT_SAVED_REFUSAL);
            expect(lastPosted('objectSelection')).toBeUndefined();

        });

        it('writes nothing and answers nothing for a forged or locked field', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            workspaceState.update.mockClear();

            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'ParentId', value: 'x' });
            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Sub_Rating__c', value: 'x' });
            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: 'Forged-Folder', objectApiName: 'Account', fieldApiName: 'Name', value: 'x' });
            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Task', fieldApiName: 'Subject', value: 'x' });
            await receivedMessageHandler({ command: 'setFieldFixedValue', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 7 });

            // A SAVE ROUTED FOR A PANEL CLOSED SINCE WRITES NOTHING
            const panelState = (RecipeCockpitService as any).recipeCockpitPanelState;
            const routedAction = RecipeCockpitService.routePanelMessage({ command: 'setFieldFixedValue', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'X-1' } as any, panelState);
            disposeHandler?.();
            disposeHandler = undefined;
            await (RecipeCockpitService as any).setFieldFixedValue(undefined, panelState, routedAction);

            expect(showInputBox).not.toHaveBeenCalled();
            expect(workspaceState.update).not.toHaveBeenCalled();
            expect(lastPosted('fieldEditResult')).toBeUndefined();

        });

        it('runs a card with a fixed value on a filtered copy that carries it, and never writes the recipe', async () => {

            const recipeBefore = fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8');
            await openAndDraw(buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: { Contact: { LastName: 'Smith' } } }) }));

            await receivedMessageHandler({ command: 'generateTree', treeKey: ACCOUNT_TREE_KEY });

            const runFakerCall = executeCommand.mock.calls.find(call => call[0] === RECIPE_COCKPIT_RUN_FAKER_COMMAND);
            expect(runFakerCall).toHaveLength(3);
            expect(runFakerCall?.[1]).toBe(ACCOUNT_RECIPE_FILE_PATH);
            expect(runFakerCall?.[2]).toMatchObject({ excludedObjectApiNames: [], fixedValuesByObject: { Contact: { LastName: 'Smith' } } });
            expect(readFieldLines(runFakerCall?.[2].recipeText, 'Contact', 'LastName')).toEqual([['    LastName: "Smith"']]);
            expect(fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8')).toBe(recipeBefore);

        });

        it('runs a card whose only stored value a lock holds back on its recipe exactly as before', async () => {

            await openAndDraw(buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: { Account: { ParentId: 'x' } } }) }));

            await receivedMessageHandler({ command: 'generateTree', treeKey: ACCOUNT_TREE_KEY });

            expect(executeCommand.mock.calls.find(call => call[0] === RECIPE_COCKPIT_RUN_FAKER_COMMAND)).toEqual([RECIPE_COCKPIT_RUN_FAKER_COMMAND, ACCOUNT_RECIPE_FILE_PATH]);

        });

        it('Reset asks for a folder whose only change is a fixed value, and clears it', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: { Account: { Name: 'Acme' } }, [LEAD_TREE_KEY]: { Lead: { Company: 'Acme' } } }) });
            await openAndDraw(workspaceState);

            showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL);
            await receivedMessageHandler({ command: 'resetTreeSelection', treeKey: ACCOUNT_TREE_KEY });

            expect(showWarningMessage).toHaveBeenCalledTimes(1);
            expect(showWarningMessage.mock.calls[0][1].detail).toContain('every fixed value and faker constraint is cleared');
            expect(storedOf(workspaceState)).toEqual(storedSelections({ [LEAD_TREE_KEY]: { Lead: { Company: 'Acme' } } }));
            expect(lastPosted('objectSelection')).not.toHaveProperty('fixedValues');

        });

    });

    describe('buildInsertConfirmationDetail', () => {

        it('names each fixed value with its field, through escapeForNotification', () => {

            const recipe = loadRecipe();
            applyFixedValues(recipe, { [ACCOUNT_TREE_KEY]: { Account: { Legacy_Code__c: '[x](command:y)' } } });

            const detail = RecipeCockpitService.buildInsertConfirmationDetail('my-sandbox', undefined, treeOf(recipe, ACCOUNT_TREE_KEY), recipe, new Map([['Account', 1]]), [], 'snowfakery', 'recipe.yml');

            expect(detail).toContain('Fixed values, the same on every record: Account.Legacy_Code__c = \\u005bx\\u005d\\u0028command:y\\u0029');

        });

    });

    describe('the panel script', () => {

        const drawRecipe = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined) => {
            const panel = runPanelScript();
            const recipe = loadRecipe();
            recipe.trees.push({ treeKey: '', title: RECIPE_COCKPIT_UNGROUPED_TREE_TITLE, folderName: '', objects: [{ objectApiName: 'Lead', parentLookups: [] }], fieldCount: 2 });
            applyFixedValues(recipe, {});
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
        const pinOf = (panel: Panel, objectElement: any, fieldApiName: string) => panel.findAll(rowOf(panel, objectElement, fieldApiName), 'treeFieldFixedValue')[0];
        const only = (panel: Panel, element: any, className: string) => panel.findAll(element, className)[0];

        it('draws a pin right of each field\'s checkbox, built node by node with the pin path', () => {

            const panel = drawRecipe();
            const account = expanded(panel, 'Account');
            const headerChildren = rowOf(panel, account, 'Legacy_Code__c').children[0].children;
            const pin = pinOf(panel, account, 'Legacy_Code__c');

            expect(headerChildren[0].classList.contains('treeFieldInclude')).toBeTrue();
            expect(headerChildren[1]).toBe(pin);
            expect(pin.tagName).toBe('button');
            expect(pin.children[0].namespaceURI).toBe('http://www.w3.org/2000/svg');
            expect(pin.children[0].children[0].attributes.d).toBe(RECIPE_COCKPIT_FIXED_VALUE_GLYPH_PATH);
            expect(pin.attributes['aria-pressed']).toBe('false');
            expect(pin.disabled).toBeFalse();
            expect(pin.attributes.title).toBe('Give this field a fixed value instead of its faker expression');

        });

        it('disables the pin of a field a lock holds back, with the reason in its title', () => {

            const panel = drawRecipe();
            const account = expanded(panel, 'Account');

            expect(pinOf(panel, account, 'ParentId').disabled).toBeTrue();
            expect(pinOf(panel, account, 'ParentId').attributes.title).toBe(`Cannot have a fixed value: ${RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_REASON}`);
            expect(pinOf(panel, account, 'Sub_Rating__c').attributes.title).toBe(`Cannot have a fixed value: ${RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX}Rating__c`);
            expect(pinOf(panel, account, 'Rating__c').attributes.title).toBe(`Cannot have a fixed value: ${RECIPE_COCKPIT_FIELD_CONTROLS_REASON_PREFIX}Sub_Rating__c`);
            expect(pinOf(panel, expanded(panel, 'Contact'), 'AccountId').disabled).toBeTrue();

            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, fieldSelection: { objects: [{ objectApiName: 'Account', excludedFieldApiNames: ['Legacy_Code__c'], lockedFields: [] }] } });
            expect(pinOf(panel, account, 'Legacy_Code__c').attributes.title).toBe(`Cannot have a fixed value: ${RECIPE_COCKPIT_FIXED_VALUE_UNTICKED_REASON}`);

        });

        it('locks a field the tree wires as a lookup whatever type the wrapper gives it', () => {

            const panel = drawRecipe(recipe => { treeOf(recipe, ACCOUNT_TREE_KEY).objects.find(treeObject => treeObject.objectApiName === 'Account')?.parentLookups.push({ fieldApiName: 'Legacy_Code__c', parentObjectApiName: 'Account' }); });
            const account = expanded(panel, 'Account');

            expect(pinOf(panel, account, 'Legacy_Code__c').attributes.title).toBe(`Cannot have a fixed value: ${RECIPE_COCKPIT_FIXED_VALUE_LOOKUP_REASON}`);
            expect(pinOf(panel, account, 'Annual_Budget__c').disabled).toBeFalse();

        });

        it('opens an inline editor under the row on a click, posts nothing until Save, and closes it on a second click or Cancel (#337)', () => {

            const panel = drawRecipe();
            panel.postToPanel({ command: 'rendered' });
            const account = expanded(panel, 'Account');
            const row = rowOf(panel, account, 'Legacy_Code__c');
            const pin = pinOf(panel, account, 'Legacy_Code__c');

            expect(panel.findAll(row, 'fieldEditor')).toEqual([]);
            pin.dispatch('click');

            const editor = only(panel, row, 'fieldEditor');
            expect(panel.isHidden(editor)).toBeFalse();
            expect(editor.attributes.role).toBe('group');
            expect(editor.attributes['aria-label']).toBe('Fixed value for Account.Legacy_Code__c');
            expect(pin.attributes['aria-expanded']).toBe('true');
            expect(only(panel, editor, 'fieldEditorInput').value).toBe('');
            expect(only(panel, editor, 'fieldEditorInput').attributes.maxlength).toBe(String(RECIPE_COCKPIT_FIXED_VALUE_MAX_LENGTH));
            expect(only(panel, editor, 'fieldEditorHint').textContent).toBe('Type the text every record gets. Empty goes back to the faker expression. The recipe file is not changed.');
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'setFieldFixedValue')).toEqual([]);

            pin.dispatch('click');
            expect(panel.isHidden(editor)).toBeTrue();
            expect(editor.children).toEqual([]);
            expect(pin.attributes['aria-expanded']).toBe('false');

            pin.dispatch('click');
            only(panel, editor, 'fieldEditorCancel').dispatch('click');
            expect(panel.isHidden(editor)).toBeTrue();

            pin.dispatch('click');
            only(panel, editor, 'fieldEditorInput').dispatch('keydown', { key: 'Escape' });
            expect(panel.isHidden(editor)).toBeTrue();
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'setFieldFixedValue')).toEqual([]);

        });

        it('posts the value typed on Save or Enter, and an empty one on Clear, with the nickname the object is drawn with', () => {

            const panel = drawRecipe(recipe => { objectOf(recipe, 'Account').nickname = 'Account_NickName'; });
            panel.postToPanel({ command: 'rendered' });
            const account = expanded(panel, 'Account');
            const row = rowOf(panel, account, 'Legacy_Code__c');

            pinOf(panel, account, 'Legacy_Code__c').dispatch('click');
            pinOf(panel, account, 'ParentId').dispatch('click');
            const input = only(panel, row, 'fieldEditorInput');
            input.value = ' X-1 ';
            only(panel, row, 'fieldEditorSave').dispatch('click');
            input.value = 'X-2';
            input.dispatch('keydown', { key: 'Enter' });
            input.dispatch('keydown', { key: 'a' });
            input.value = 'X-3';
            input.dispatch('keydown', { key: 'Enter', isComposing: true });
            only(panel, row, 'fieldEditorClear').dispatch('click');

            const base = { command: 'setFieldFixedValue', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', nickname: 'Account_NickName' };
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'setFieldFixedValue')).toEqual([
                { ...base, value: ' X-1 ' },
                { ...base, value: 'X-2' },
                { ...base, value: '' }
            ]);
            expect(panel.findAll(rowOf(panel, account, 'ParentId'), 'fieldEditor')).toEqual([]);

        });

        it('pre-fills the stored value, writes a refusal under the box as text and keeps it open, and closes it once saved', () => {

            const panel = drawRecipe();
            panel.postToPanel({ command: 'rendered' });
            const account = expanded(panel, 'Account');
            const row = rowOf(panel, account, 'Legacy_Code__c');
            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, fixedValues: [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'X-1', kind: 'text' }] });

            pinOf(panel, account, 'Legacy_Code__c').dispatch('click');
            const editor = only(panel, row, 'fieldEditor');
            expect(only(panel, editor, 'fieldEditorInput').value).toBe('X-1');
            expect(panel.isHidden(only(panel, editor, 'fieldEditorRefusal'))).toBeTrue();

            const result = { command: 'fieldEditResult', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', edit: 'fixedValue' };
            panel.postToPanel({ ...result, renderSequence: 99, refusal: 'stale' });
            panel.postToPanel({ ...result, renderSequence: 3, edit: 'constraint', refusal: 'other editor' });
            expect(panel.isHidden(only(panel, editor, 'fieldEditorRefusal'))).toBeTrue();

            panel.postToPanel({ ...result, renderSequence: 3, refusal: '<img src=x> is [not](command:x) a value' });
            const refusal = only(panel, editor, 'fieldEditorRefusal');
            expect(refusal.textContent).toBe('<img src=x> is [not](command:x) a value');
            expect(refusal.children).toEqual([]);
            expect(refusal.attributes.role).toBe('alert');
            expect(panel.isHidden(refusal)).toBeFalse();
            expect(panel.isHidden(editor)).toBeFalse();

            // A NEW SAVE CLEARS THE OLD REFUSAL UNTIL THE HOST ANSWERS AGAIN
            only(panel, editor, 'fieldEditorSave').dispatch('click');
            expect(panel.isHidden(refusal)).toBeTrue();

            panel.postToPanel({ ...result, renderSequence: 3 });
            expect(panel.isHidden(editor)).toBeTrue();

        });

        it('closes an open editor when a redraw locks its field', () => {

            const panel = drawRecipe();
            panel.postToPanel({ command: 'rendered' });
            const account = expanded(panel, 'Account');
            const row = rowOf(panel, account, 'Legacy_Code__c');

            pinOf(panel, account, 'Legacy_Code__c').dispatch('click');
            expect(panel.isHidden(only(panel, row, 'fieldEditor'))).toBeFalse();

            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, fieldSelection: { objects: [{ objectApiName: 'Account', excludedFieldApiNames: ['Legacy_Code__c'], lockedFields: [] }] } });
            expect(panel.isHidden(only(panel, row, 'fieldEditor'))).toBeTrue();

        });

        it('shows a fixed value in place of the expression, as text, from an objectSelection for the model on screen, and Reset while one is set', () => {

            const panel = drawRecipe();
            panel.postToPanel({ command: 'rendered' });
            const account = expanded(panel, 'Account');
            const row = rowOf(panel, account, 'Legacy_Code__c');
            const resetElement = panel.findAll(panel.treeCards()[0], 'treeResetSelection')[0];
            const fixedValues = [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: '<b>X</b>', kind: 'text' }];

            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 99, fixedValues: fixedValues });
            expect(panel.isHidden(only(panel, row, 'fixedValue'))).toBeTrue();

            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, fixedValues: fixedValues });

            expect(only(panel, row, 'fixedValue').textContent).toBe('<b>X</b>');
            expect(only(panel, row, 'fixedValue').children).toEqual([]);
            expect(panel.isHidden(only(panel, row, 'fixedValue'))).toBeFalse();
            expect(panel.isHidden(only(panel, row, 'expression'))).toBeTrue();
            expect(only(panel, row, 'fixedValueBadge').textContent).toBe(RECIPE_COCKPIT_FIXED_VALUE_BADGE_LABEL);
            expect(panel.isHidden(only(panel, row, 'fixedValueBadge'))).toBeFalse();
            expect(pinOf(panel, account, 'Legacy_Code__c').attributes['aria-pressed']).toBe('true');
            expect(pinOf(panel, account, 'Legacy_Code__c').attributes.title).toBe('Fixed value — click to change or clear it');
            expect(panel.isHidden(resetElement)).toBeFalse();
            expect(panel.isHidden(only(panel, rowOf(panel, account, 'Annual_Budget__c'), 'fixedValue'))).toBeTrue();

            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3 });

            expect(panel.isHidden(only(panel, row, 'fixedValue'))).toBeTrue();
            expect(panel.isHidden(only(panel, row, 'expression'))).toBeFalse();
            expect(panel.isHidden(only(panel, row, 'fixedValueBadge'))).toBeTrue();
            expect(pinOf(panel, account, 'Legacy_Code__c').attributes['aria-pressed']).toBe('false');
            expect(panel.isHidden(resetElement)).toBeTrue();

        });

        it('draws no pin on the ungrouped card, which has no folder to keep a value by', () => {

            const panel = drawRecipe();
            const ungroupedLead = objectsNamed(panel, 'Lead').find(objectElement => panel.findAll(objectElement, 'treeObjectInclude').length === 0);
            panel.expandObject(ungroupedLead);

            expect(panel.findAll(ungroupedLead, 'treeFieldFixedValue')).toEqual([]);

        });

    });

});
