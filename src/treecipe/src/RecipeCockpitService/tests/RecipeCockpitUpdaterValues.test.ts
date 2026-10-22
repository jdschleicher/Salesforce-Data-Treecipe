import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: jest.fn().mockReturnValue({ get: jest.fn(), update: jest.fn(), inspect: jest.fn() }),
        fs: { readDirectory: jest.fn(), readFile: jest.fn() }
    },
    env: { openExternal: jest.fn() },
    window: {
        createWebviewPanel: jest.fn(),
        createQuickPick: jest.fn(),
        withProgress: jest.fn(),
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        showErrorMessage: jest.fn(),
        showQuickPick: jest.fn(),
        createOutputChannel: jest.fn(),
        createStatusBarItem: jest.fn().mockImplementation(() => ({ text: '', show: jest.fn(), dispose: jest.fn() }))
    },
    commands: { registerCommand: jest.fn(), executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15, Window: 10 },
    ConfigurationTarget: { Workspace: 2 },
    FileType: { Directory: 2, File: 1, SymbolicLink: 64 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }), parse: (uriValue: string) => ({ toString: () => uriValue }) }
}), { virtual: true });

jest.mock('@salesforce/core', () => ({
    AuthInfo: { listAllAuthorizations: jest.fn() },
    StateAggregator: { clearInstance: jest.fn() },
    Org: { create: jest.fn() }
}));

jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), execFile: jest.fn(), exec: jest.fn() }));

import {
    IRecipeCockpitPanelState,
    RecipeCockpitService,
    RECIPE_COCKPIT_UPDATER_GENERATE_CONFIRM_LABEL,
    RECIPE_COCKPIT_UPDATER_GENERATE_LABEL,
    RECIPE_COCKPIT_UPDATER_GENERATION_CHUNK_SIZE,
    RECIPE_COCKPIT_UPDATER_GENERATING_LABEL,
    RECIPE_COCKPIT_UPDATER_LOAD_LABEL,
    RECIPE_COCKPIT_UPDATER_LOADING_LABEL,
    RECIPE_COCKPIT_UPDATER_NOT_LOADED_REFUSAL,
    RECIPE_COCKPIT_UPDATER_TAB_LABEL
} from '../RecipeCockpitService';
import { RecipeCockpitRecipeWriter } from '../RecipeCockpitRecipeWriter';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { SnowfakeryRecipeProcessor } from '../../FakerRecipeProcessor/SnowfakeryRecipeProcessor/SnowfakeryRecipeProcessor';
import { IFakerRecipeProcessor } from '../../FakerRecipeProcessor/IFakerRecipeProcessor';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { PythonTestHarness } from '../../RecipeFakerService.ts/RecipeYamlScalar/tests/mocks/PythonTestHarness';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const SANDBOX_ORG = { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa', alias: 'qa' };

const loadTreeRecipe = () => {
    const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
    return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME).recipeViewModel;
};

const loadRequest = (renderSequence: number) => ({
    command: 'loadUpdaterRecords',
    treeKey: ACCOUNT_TREE_KEY,
    renderSequence: renderSequence,
    objects: [
        { objectApiName: 'Account', fieldApiNames: ['Legacy_Code__c', 'Rating__c', 'Annual_Budget__c', 'Regions__c'], whereClause: '' },
        { objectApiName: 'Contact', fieldApiNames: ['LastName'], whereClause: '' },
        { objectApiName: 'OtherChildObject__c', fieldApiNames: [], whereClause: '' }
    ]
});

const generateRequest = (renderSequence: number, fields: unknown, treeKey: unknown = ACCOUNT_TREE_KEY) => ({
    command: 'generateUpdaterValues',
    treeKey: treeKey,
    renderSequence: renderSequence,
    fields: fields
});

answerInPanelConfirmationsThroughWarningMock();

describe('RecipeCockpitService, the Treecipe Updater\'s values (#417)', () => {

    describe('RecipeCockpitRecipeWriter.buildUpdaterValueRecipe', () => {

        it('writes one object, its own nickname, the count asked for and only the fields given, which both YAML readers load', () => {

            const build = RecipeCockpitRecipeWriter.buildUpdaterValueRecipe('Account', 3, [
                { fieldApiName: 'Legacy_Code__c', valueText: '${{fake.Word}}' },
                { fieldApiName: 'Rating__c', valueText: '"${{ faker.helpers.arrayElement([\'Hot\', \'Cold\']) }}"' },
                { fieldApiName: 'Annual_Budget__c', valueText: new FakerJSRecipeFakerService().buildNumericRecipeValueWithPrecisionAndScale(2) },
                { fieldApiName: 'Regions__c', valueText: '${{ random_choice(\'East\') }}\n        ### TODO -- RecordType Options --\n        # ${{ random_choice(\'West\') }}' }
            ]);

            expect(build).toMatchObject({ isBuilt: true });
            const recipeText = (build as { recipeText: string }).recipeText;
            expect(yaml.load(recipeText)).toEqual([{
                object: 'Account',
                nickname: 'Account_Updater_NickName',
                count: 3,
                fields: {
                    Legacy_Code__c: '${{fake.Word}}',
                    Rating__c: '${{ faker.helpers.arrayElement([\'Hot\', \'Cold\']) }}',
                    Annual_Budget__c: '${{ faker.number.int({min: 0, max: 99}) }}\n',
                    Regions__c: '${{ random_choice(\'East\') }}'
                }
            }]);

        });

        it.each([
            ['an object name that is not an api name', 'Account: x', 1, [{ fieldApiName: 'Name', valueText: 'x' }]],
            ['a count of zero', 'Account', 0, [{ fieldApiName: 'Name', valueText: 'x' }]],
            ['a count that is not whole', 'Account', 1.5, [{ fieldApiName: 'Name', valueText: 'x' }]],
            ['no fields', 'Account', 1, []],
            ['a field named twice', 'Account', 1, [{ fieldApiName: 'Name', valueText: 'x' }, { fieldApiName: 'Name', valueText: 'y' }]],
            ['a field name that is not an api name', 'Account', 1, [{ fieldApiName: 'Name: x', valueText: 'x' }]],
            ['an empty value', 'Account', 1, [{ fieldApiName: 'Name', valueText: '  ' }]],
            ['a value that would start another field', 'Account', 1, [{ fieldApiName: 'Name', valueText: 'x\n    Other__c: y' }]],
            ['a value that would start another object', 'Account', 1, [{ fieldApiName: 'Name', valueText: 'x\n- object: Contact' }]],
            ['a value with a line break PyYAML sees', 'Account', 1, [{ fieldApiName: 'Name', valueText: 'x - object: Contact' }]],
            ['a value with a lone carriage return', 'Account', 1, [{ fieldApiName: 'Name', valueText: 'x\r- object: Contact' }]]
        ])('refuses %s', (_description, objectApiName, recordCount, fields) => {

            expect(RecipeCockpitRecipeWriter.buildUpdaterValueRecipe(objectApiName as string, recordCount as number, fields as any)).toMatchObject({ isBuilt: false, refusal: expect.any(String) });

        });

    });

    describe('findRecipeExpression and readRecordFieldValue', () => {

        it('takes the first expression line of a display value, unquoting a double-quoted one, and nothing from a TODO', () => {

            expect(RecipeCockpitService.findRecipeExpression('${{ random_choice(\'East\') }}\n### TODO -- RecordType Options --\n# ${{ random_choice(\'West\') }}')).toBe('${{ random_choice(\'East\') }}');
            expect(RecipeCockpitService.findRecipeExpression('"${{ faker.number.int({min: 1, max: 5}) }}"\n### Driven by ValidationRule "Cap"')).toBe('${{ faker.number.int({min: 1, max: 5}) }}');
            expect(RecipeCockpitService.findRecipeExpression('"${{ broken')).toBeUndefined();
            expect(RecipeCockpitService.findRecipeExpression('"not json\\x"')).toBeUndefined();
            expect(RecipeCockpitService.findRecipeExpression('### TODO -- NO PICKLIST VALUES')).toBeUndefined();
            expect(RecipeCockpitService.findRecipeExpression(undefined)).toBeUndefined();

        });

        it('reads a field whatever casing the org answers with', () => {

            expect(RecipeCockpitService.readRecordFieldValue({ Legacy_Code__c: 'A' }, 'Legacy_Code__c')).toBe('A');
            expect(RecipeCockpitService.readRecordFieldValue({ legacy_code__c: 'B' }, 'Legacy_Code__c')).toBe('B');
            expect(RecipeCockpitService.readRecordFieldValue({ Other__c: 'C' }, 'Legacy_Code__c')).toBeNull();

        });

        it('generates with faker-js from every multi-line value the real pipeline writes: validation-rule lines, a block scalar, a quoted and an unquoted expression', async () => {

            const workspaceRoot = path.join(__dirname, 'mocks', 'validationRuleWorkspace');
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes'));
            const recipe = RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, workspaceRoot, 'recipe-fakerjs-2026-10-01T09-00-00').recipeViewModel;
            const gadget = recipe.objects.find((object: any) => object.objectApiName === 'Gadget__c')!;
            const fieldNames = ['Amount__c', 'Score__c', 'Stage__c', 'Quantity__c', 'Notes__c', 'Code__c'];

            const fields = fieldNames.map(fieldApiName => {
                const expression = RecipeCockpitService.findRecipeExpression(gadget.fields.find((field: any) => field.fieldApiName === fieldApiName)!.recipeValue);
                expect(expression).toMatch(/^\$\{\{.*\}\}$/);
                return { fieldApiName: fieldApiName, valueText: RecipeCockpitRecipeWriter.toFixedValueScalar({ value: expression!, kind: 'expression' }) };
            });

            const generation = await RecipeCockpitService.generateUpdaterObjectValues('faker-js', 'Gadget__c', 5, fields);

            const records = (generation as { records: Record<string, unknown>[] }).records;
            expect(records).toHaveLength(5);
            records.forEach(record => {
                expect(Number(record.Amount__c)).toBeWithin(100, 50000);
                expect(Number(record.Score__c)).toBeWithin(0, 1000);
                expect(['Open', 'Won']).toContain(record.Stage__c);
                expect(Number(record.Quantity__c)).toBeWithin(1, 501);
                expect(String(record.Notes__c).length).toBeWithin(10, 201);
                expect(String(record.Code__c)).toMatch(/^[A-Z]{3}-[0-9]{4}$/);
            });

        });

    });

    describe('readUpdaterFieldValueRequests', () => {

        const treeObjects = [
            { objectApiName: 'Account', fieldApiNames: ['Name', 'Rating__c'], lookupFieldApiNames: [] },
            { objectApiName: 'Contact', fieldApiNames: ['LastName'], lookupFieldApiNames: [] }
        ];

        it('keeps the fields asked for, in order, with a value only where one was typed', () => {

            expect(RecipeCockpitService.readUpdaterFieldValueRequests([
                { objectApiName: 'Contact', fieldApiName: 'LastName' },
                { objectApiName: 'Account', fieldApiName: 'Rating__c', value: 'Hot' }
            ], treeObjects)).toEqual({ requests: [
                { objectApiName: 'Contact', fieldApiName: 'LastName' },
                { objectApiName: 'Account', fieldApiName: 'Rating__c', value: 'Hot' }
            ] });

        });

        it.each([
            ['not a list', 'Name'],
            ['an empty list', []],
            ['more fields than the card lists', [{ objectApiName: 'Account', fieldApiName: 'Name' }, { objectApiName: 'Account', fieldApiName: 'Rating__c' }, { objectApiName: 'Contact', fieldApiName: 'LastName' }, { objectApiName: 'Contact', fieldApiName: 'LastName' }]],
            ['an entry that is not an object', [null]],
            ['an object the card does not list', [{ objectApiName: 'Lead', fieldApiName: 'Name' }]],
            ['a field the object does not list', [{ objectApiName: 'Account', fieldApiName: 'LastName' }]],
            ['a field named twice', [{ objectApiName: 'Account', fieldApiName: 'Name' }, { objectApiName: 'Account', fieldApiName: 'Name' }]],
            ['a value that is not text', [{ objectApiName: 'Account', fieldApiName: 'Name', value: 7 }]],
            ['an empty value', [{ objectApiName: 'Account', fieldApiName: 'Name', value: '' }]],
            ['a value past what the editor holds', [{ objectApiName: 'Account', fieldApiName: 'Name', value: 'x'.repeat(40000) }]],
            ['an object named __proto__', [{ objectApiName: '__proto__', fieldApiName: 'Name' }]],
            ['an object name that is not text', [{ objectApiName: 7, fieldApiName: 'Name' }]]
        ])('refuses the whole request for %s', (_description, fields) => {

            expect(RecipeCockpitService.readUpdaterFieldValueRequests(fields, treeObjects)).toHaveProperty('refusal');

        });

    });

    describe('routePanelMessage', () => {

        const buildPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 3 };
            panelState.treeHistoryAllowLists.nameableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            return panelState;
        };

        const notRunning = { command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' };

        it('routes the chosen fields of the card on screen, with any value typed', () => {

            expect(RecipeCockpitService.routePanelMessage(generateRequest(3, [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'NEW' }]), buildPanelState())).toEqual({
                kind: 'generateUpdaterValues',
                treeKey: ACCOUNT_TREE_KEY,
                renderSequence: 3,
                fieldRequests: [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'NEW' }]
            });

        });

        it.each([
            ['another model', generateRequest(2, [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }])],
            ['a card it did not draw', generateRequest(3, [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }], 'Lead-ONLY')],
            ['a card key that is not text', generateRequest(3, [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }], 7)]
        ])('gives the button back and generates nothing for %s', (_description, panelMessage) => {

            expect(RecipeCockpitService.routePanelMessage(panelMessage, buildPanelState())).toEqual({
                kind: 'refuseUpdaterLoad',
                hostMessage: { ...notRunning, treeKey: typeof panelMessage.treeKey === 'string' ? panelMessage.treeKey : '' }
            });

        });

        it('refuses a field of another card, saying so', () => {

            expect(RecipeCockpitService.routePanelMessage(generateRequest(3, [{ objectApiName: 'Lead', fieldApiName: 'LastName' }]), buildPanelState())).toEqual({
                kind: 'refuseUpdaterLoad',
                refusalText: expect.stringMatching(/^No values were generated: /),
                hostMessage: notRunning
            });

        });

        it('answers a generation while a load or another generation runs with the running state', () => {

            const panelState = buildPanelState();
            panelState.updaterLoadStateMessage = { command: 'updaterLoadState', isRunning: true, treeKey: 'Lead-ONLY' };

            expect(RecipeCockpitService.routePanelMessage(generateRequest(3, [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }]), panelState))
                .toEqual({ kind: 'refuseUpdaterLoad', hostMessage: panelState.updaterLoadStateMessage });

        });

    });

    describe('findUpdaterFieldLockReason, the panel\'s rule held by the host', () => {

        it('locks what the tab draws locked, and nothing else', () => {

            const recipe = loadTreeRecipe();
            const tree = recipe.trees.find((recipeTree: any) => recipeTree.treeKey === ACCOUNT_TREE_KEY)!;
            const reasonOf = (objectApiName: string, fieldApiName: string) => {
                const field = recipe.objects.find((object: any) => object.objectApiName === objectApiName)!.fields.find((candidate: any) => candidate.fieldApiName === fieldApiName)!;
                return RecipeCockpitService.findUpdaterFieldLockReason(tree, objectApiName, field);
            };

            expect(reasonOf('Account', 'Legacy_Code__c')).toBeUndefined();
            expect(reasonOf('Account', 'ParentId')).toMatch(/lookup/);
            expect(reasonOf('Account', 'OwnerId')).toMatch(/lookup/);
            expect(reasonOf('Account', 'Sub_Rating__c')).toBe('depends on Rating__c');
            expect(reasonOf('Contact', 'AccountId')).toMatch(/lookup/);
            expect(RecipeCockpitService.findUpdaterFieldLockReason(tree, 'Account', { fieldApiName: 'RecordTypeId', fieldType: 'Text' } as any)).toMatch(/record type/);
            expect(RecipeCockpitService.findUpdaterFieldLockReason(tree, 'Account', { fieldApiName: 'Name', isOnlyInRecipeFile: true } as any)).toMatch(/recipe file/);
            expect(RecipeCockpitService.findUpdaterFieldLockReason(tree, 'Account', { fieldApiName: 'Number__c', fieldType: 'AutoNumber' } as any)).toMatch(/Salesforce sets/);

        });

    });

    describe('generateUpdaterObjectValues, through each backend\'s own processor', () => {

        it('generates one faker-js value per record from a temporary folder outside the workspace, and removes the folder', async () => {

            const recipePaths: string[] = [];
            const generateSpy = jest.spyOn(FakerJSRecipeProcessor.prototype, 'generateFakeDataBySelectedRecipeFile');
            generateSpy.mockImplementation(async function (this: FakerJSRecipeProcessor, recipePath: string) {
                recipePaths.push(recipePath);
                generateSpy.mockRestore();
                return await this.generateFakeDataBySelectedRecipeFile(recipePath);
            });

            const generation = await RecipeCockpitService.generateUpdaterObjectValues('faker-js', 'Account', 7, [
                { fieldApiName: 'Legacy_Code__c', valueText: '${{ faker.lorem.word() }}' },
                { fieldApiName: 'Annual_Budget__c', valueText: new FakerJSRecipeFakerService().buildNumericRecipeValueWithPrecisionAndScale(2) },
                { fieldApiName: 'Amount__c', valueText: new FakerJSRecipeFakerService().buildNumericRecipeValueWithPrecisionAndScale(4, 2) }
            ]);

            expect(generation).toHaveProperty('records');
            const records = (generation as { records: Record<string, unknown>[] }).records;
            expect(records).toHaveLength(7);
            records.forEach(record => {
                expect(typeof record.Legacy_Code__c).toBe('string');
                expect(record.Legacy_Code__c).not.toBe('');
                expect(Number(record.Annual_Budget__c)).toBeWithin(0, 100);
                expect(Number(record.Amount__c)).toBeWithin(0, 100);
            });

            expect(recipePaths).toHaveLength(1);
            expect(recipePaths[0].startsWith(fs.realpathSync(os.tmpdir())) || recipePaths[0].startsWith(os.tmpdir())).toBe(true);
            expect(fs.existsSync(path.dirname(recipePaths[0]))).toBe(false);

        });

        /*
            snowfakery is not installed in CI, so its CLI is stood in for by a Python script that does what
            snowfakery does with this recipe: PyYAML reads it, and each field is rendered with Jinja in
            snowfakery's "${{" environment, "count" times, with Faker behind "fake." and snowfakery's own
            random_choice and random_number. Its JSON then goes through the real SnowfakeryRecipeProcessor.
        */
        PythonTestHarness.testRequiringModules('yaml', 'jinja2', 'faker')('generates one snowfakery value per record from the expressions generation wrote', async () => {

            const recipeTexts: string[] = [];
            jest.spyOn(SnowfakeryRecipeProcessor.prototype, 'generateFakeDataBySelectedRecipeFile').mockImplementation(async (recipePath: string) => {
                const recipeText = fs.readFileSync(recipePath, 'utf8');
                recipeTexts.push(recipeText);
                return JSON.stringify(PythonTestHarness.runPython([
                    'import json, random, re, sys, yaml, jinja2',
                    'from faker import Faker',
                    'faker = Faker()',
                    'class Fake:',
                    '    def __getattr__(self, name):',
                    '        return getattr(faker, re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower())()',
                    'environment = jinja2.Environment(block_start_string="${%", block_end_string="%}", variable_start_string="${{", variable_end_string="}}")',
                    'environment.globals.update(fake=Fake(), random_choice=lambda *options: random.choice(options), random_number=lambda min=0, max=100, step=1: random.randrange(min, max + 1, step))',
                    'recipe = yaml.safe_load(json.load(sys.stdin))[0]',
                    'templates = {name: environment.from_string(value) for name, value in recipe["fields"].items()}',
                    'print(json.dumps([dict({"_table": recipe["object"], "id": index + 1}, **{name: template.render() for name, template in templates.items()}) for index in range(recipe["count"])]))'
                ].join('\n'), recipeText));
            });

            const generation = await RecipeCockpitService.generateUpdaterObjectValues('snowfakery', 'Account', 6, [
                { fieldApiName: 'Legacy_Code__c', valueText: '${{fake.Word}}' },
                { fieldApiName: 'Annual_Budget__c', valueText: '${{ random_number(min=0, max=9999999999999999) }}' },
                { fieldApiName: 'Rating__c', valueText: '${{ random_choice(\'Hot\',\'Warm\',\'Cold\') }}' }
            ]);

            expect(recipeTexts).toHaveLength(1);
            expect(recipeTexts[0]).toContain('count: 6');
            const records = (generation as { records: Record<string, unknown>[] }).records;
            expect(records).toHaveLength(6);
            records.forEach(record => {
                expect(record.attributes).toMatchObject({ type: 'Account' });
                expect(String(record.Legacy_Code__c)).toMatch(/^\S+$/);
                expect(String(record.Annual_Budget__c)).toMatch(/^\d+$/);
                expect(['Hot', 'Warm', 'Cold']).toContain(record.Rating__c);
            });

        });

        it('generates a large load in runs of the chunk size, reports each, and stops between runs on a cancel', async () => {

            const askedCounts: number[] = [];
            jest.spyOn(RecipeCockpitService, 'createUpdaterRecipeProcessor').mockReturnValue({
                generateFakeDataBySelectedRecipeFile: async (recipePath: string) => fs.readFileSync(recipePath, 'utf8'),
                transformFakerJsonDataToCollectionApiFormattedFilesBySObject: (recipeText: string) => {
                    const [recipe] = yaml.load(recipeText) as any[];
                    askedCounts.push(recipe.count);
                    return new Map([[recipe.object, { allOrNone: true, records: Array.from({ length: recipe.count }, (_value, recordIndex) => ({ Name: `N${askedCounts.length}-${recordIndex}` })) }]]);
                }
            } as any);
            const reported: number[] = [];

            const generation = await RecipeCockpitService.generateUpdaterObjectValues('faker-js', 'Account', RECIPE_COCKPIT_UPDATER_GENERATION_CHUNK_SIZE * 2 + 5, [{ fieldApiName: 'Name', valueText: '${{ faker.company.name() }}' }], () => false, generatedCount => reported.push(generatedCount));

            expect(askedCounts).toEqual([RECIPE_COCKPIT_UPDATER_GENERATION_CHUNK_SIZE, RECIPE_COCKPIT_UPDATER_GENERATION_CHUNK_SIZE, 5]);
            expect(reported).toEqual([RECIPE_COCKPIT_UPDATER_GENERATION_CHUNK_SIZE, RECIPE_COCKPIT_UPDATER_GENERATION_CHUNK_SIZE * 2, RECIPE_COCKPIT_UPDATER_GENERATION_CHUNK_SIZE * 2 + 5]);
            const records = (generation as { records: Record<string, unknown>[] }).records;
            expect(records).toHaveLength(RECIPE_COCKPIT_UPDATER_GENERATION_CHUNK_SIZE * 2 + 5);
            expect(records[RECIPE_COCKPIT_UPDATER_GENERATION_CHUNK_SIZE].Name).toBe('N2-0');

            askedCounts.length = 0;
            await expect(RecipeCockpitService.generateUpdaterObjectValues('faker-js', 'Account', RECIPE_COCKPIT_UPDATER_GENERATION_CHUNK_SIZE * 3, [{ fieldApiName: 'Name', valueText: '${{ faker.company.name() }}' }], () => askedCounts.length >= 1))
                .resolves.toEqual({ isCancelled: true });
            expect(askedCounts).toEqual([RECIPE_COCKPIT_UPDATER_GENERATION_CHUNK_SIZE]);

        });

        it('refuses when the backend answers no records of the object at all', async () => {

            jest.spyOn(FakerJSRecipeProcessor.prototype, 'generateFakeDataBySelectedRecipeFile').mockResolvedValue(JSON.stringify([{ object: 'Contact', nickname: 'Contact_NickName', fields: { LastName: 'One' } }]));

            await expect(RecipeCockpitService.generateUpdaterObjectValues('faker-js', 'Account', 1, [{ fieldApiName: 'Name', valueText: '${{ faker.company.name() }}' }]))
                .resolves.toEqual({ refusal: 'faker-js generated 0 Account records for 1 asked for.' });

        });

        it('refuses rather than pairing values with the wrong records when the backend answers another count', async () => {

            jest.spyOn(FakerJSRecipeProcessor.prototype, 'generateFakeDataBySelectedRecipeFile').mockResolvedValue(JSON.stringify([{ object: 'Account', nickname: 'Account_Updater_NickName', fields: { Name: 'One' } }]));

            await expect(RecipeCockpitService.generateUpdaterObjectValues('faker-js', 'Account', 2, [{ fieldApiName: 'Name', valueText: '${{ faker.company.name() }}' }]))
                .resolves.toEqual({ refusal: 'faker-js generated 1 Account record for 2 asked for.' });

        });

        it('answers a backend that throws, or a recipe it cannot build, as a refusal and leaves no folder behind', async () => {

            const recipePaths: string[] = [];
            jest.spyOn(FakerJSRecipeProcessor.prototype, 'generateFakeDataBySelectedRecipeFile').mockImplementation(async (recipePath: string) => {
                recipePaths.push(recipePath);
                throw new Error('bad expression');
            });

            await expect(RecipeCockpitService.generateUpdaterObjectValues('faker-js', 'Account', 2, [{ fieldApiName: 'Name', valueText: '${{ faker.nothing() }}' }]))
                .resolves.toEqual({ refusal: 'faker-js could not generate the values of Account: bad expression' });
            expect(fs.existsSync(path.dirname(recipePaths[0]))).toBe(false);

            await expect(RecipeCockpitService.generateUpdaterObjectValues('faker-js', 'Account', 2, [{ fieldApiName: 'Name', valueText: 'x\n- object: Contact' }]))
                .resolves.toHaveProperty('refusal');
            expect(recipePaths).toHaveLength(1);

        });

    });

    describe('the host, against a faked org, records and processor', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let workspaceState: { get: jest.Mock; update: jest.Mock };
        let generatedRecipeTexts: string[];
        let processorSpy: jest.SpyInstance;
        let processorAnswer: (recipeText: string) => Record<string, unknown>[];

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
        const warnings = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.filter(([, options]) => !options?.inPanel).map(([warningText]) => warningText);
        const confirmations = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.filter(([, options]) => options?.inPanel);
        const informations = () => (vscode.window.showInformationMessage as jest.Mock).mock.calls.map(([informationText]) => informationText);
        const recipeFilePath = () => path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', TREE_RUN_FOLDER_NAME, ACCOUNT_TREE_KEY, `recipe--${ACCOUNT_TREE_KEY}-2026-09-20T10-00-00.yml`);

        const answerConfirmation = (answer: string | undefined) => {
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation((_message: string, options?: { inPanel?: boolean }) => Promise.resolve(options?.inPanel ? answer : undefined));
        };

        const openCockpitAndLoad = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            panelState().dataOrgDetails = [SANDBOX_ORG];
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: SANDBOX_ORG, requestSequence: 1, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' } };
            await send(loadRequest(lastRenderSequence()));
        };

        const send = async (panelMessage: Record<string, unknown>) => {
            await receivedMessageHandler(panelMessage);
            await flushAsyncWork();
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-updater-values-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });

            (RecipeCockpitService as any).isUpdaterLoadInFlight = false;
            (RecipeCockpitService as any).updaterLoadRunStateMessage = undefined;
            RecipeCockpitService.clearHeldUpdaterRecords();

            postedPanelMessages = [];
            generatedRecipeTexts = [];
            const storedWorkspaceState = new Map<string, unknown>();
            workspaceState = {
                get: jest.fn().mockImplementation((stateKey: string) => storedWorkspaceState.get(stateKey)),
                update: jest.fn().mockImplementation(async (stateKey: string, stateValue: unknown) => { storedWorkspaceState.set(stateKey, JSON.parse(JSON.stringify(stateValue))); })
            };

            (vscode.window.withProgress as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, { isCancellationRequested: false }));
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showInformationMessage as jest.Mock).mockReset();
            answerConfirmation(RECIPE_COCKPIT_UPDATER_GENERATE_CONFIRM_LABEL);

            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => ({
                reveal: jest.fn(),
                visible: true,
                onDidDispose: jest.fn(),
                onDidChangeViewState: jest.fn(),
                webview: {
                    html: '',
                    postMessage: jest.fn().mockImplementation((hostMessage: any) => { postedPanelMessages.push(hostMessage); return Promise.resolve(true); }),
                    onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: any) => {
                        receivedMessageHandler = messageHandler;
                        return { dispose: jest.fn() };
                    })
                }
            }));

            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation(() => ({ text: '', dispose: jest.fn() }) as any);
            jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation((warningText: string) => { vscode.window.showWarningMessage(warningText); });
            jest.spyOn(VSCodeWorkspaceService, 'showInformationMessage').mockImplementation((informationText: string) => { vscode.window.showInformationMessage(informationText); });
            jest.spyOn(SalesforceOrgService, 'getConnection').mockImplementation(async () => ({
                query: async (soql: string) => {
                    const objectApiName = /FROM (\w+)/.exec(soql)![1];
                    const recordCount = objectApiName === 'Account' ? 3 : objectApiName === 'Contact' ? 2 : 0;
                    const records = Array.from({ length: recordCount }, (_value, recordIndex) => ({
                        attributes: { type: objectApiName },
                        Id: `${objectApiName}-${recordIndex}`,
                        Legacy_Code__c: `OLD-${recordIndex}`,
                        Rating__c: 'Warm',
                        LastName: `Old ${recordIndex}`
                    }));
                    return { totalSize: records.length, done: true, records: records };
                },
                queryMore: async () => { throw new Error('no more pages'); }
            }) as any);

            processorAnswer = (recipeText: string) => {
                const [recipe] = yaml.load(recipeText) as any[];
                return Array.from({ length: recipe.count }, (_value, recordIndex) => ({
                    attributes: { type: recipe.object },
                    ...Object.fromEntries(Object.keys(recipe.fields).map(fieldApiName => [fieldApiName, `${fieldApiName}-new-${recordIndex}`]))
                }));
            };
            const standInProcessor: IFakerRecipeProcessor = {
                generateFakeDataBySelectedRecipeFile: async (recipePath: string) => {
                    const recipeText = fs.readFileSync(recipePath, 'utf8');
                    generatedRecipeTexts.push(recipeText);
                    return recipeText;
                },
                transformFakerJsonDataToCollectionApiFormattedFilesBySObject: (recipeText: string) => {
                    const [recipe] = yaml.load(recipeText) as any[];
                    return new Map([[recipe.object, { allOrNone: true, records: processorAnswer(recipeText) }]]);
                }
            } as unknown as IFakerRecipeProcessor;
            processorSpy = jest.spyOn(RecipeCockpitService, 'createUpdaterRecipeProcessor').mockReturnValue(standInProcessor);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('generates each field from the recipe\'s own backend, pairs the values with the loaded Ids in order, and posts only a preview', async () => {

            await openCockpitAndLoad();
            const recipeBefore = fs.readFileSync(recipeFilePath(), 'utf8');

            await send(generateRequest(lastRenderSequence(), [
                { objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' },
                { objectApiName: 'Contact', fieldApiName: 'LastName', value: '${{ fake.FirstName }}' }
            ]));

            expect(processorSpy).toHaveBeenCalledWith('snowfakery');
            expect(generatedRecipeTexts.map(recipeText => yaml.load(recipeText))).toEqual([
                [{ object: 'Account', nickname: 'Account_Updater_NickName', count: 3, fields: { Legacy_Code__c: '${{fake.Word}}' } }],
                [{ object: 'Contact', nickname: 'Contact_Updater_NickName', count: 2, fields: { LastName: '${{ fake.FirstName }}' } }]
            ]);

            expect(RecipeCockpitService.readHeldUpdaterValues('Account')).toEqual([
                { recordId: 'Account-0', fieldValues: { Legacy_Code__c: 'Legacy_Code__c-new-0' } },
                { recordId: 'Account-1', fieldValues: { Legacy_Code__c: 'Legacy_Code__c-new-1' } },
                { recordId: 'Account-2', fieldValues: { Legacy_Code__c: 'Legacy_Code__c-new-2' } }
            ]);

            const [valuesMessage] = postedNamed('updaterValues');
            expect(valuesMessage).toMatchObject({ renderSequence: lastRenderSequence(), treeKey: ACCOUNT_TREE_KEY });
            expect(valuesMessage.objects[0]).toEqual({
                objectApiName: 'Account',
                recordCount: 3,
                fieldApiNames: ['Legacy_Code__c'],
                columns: ['Id', 'Legacy_Code__c (current)', 'Legacy_Code__c (new)'],
                rows: [['Account-0', 'OLD-0', 'Legacy_Code__c-new-0'], ['Account-1', 'OLD-1', 'Legacy_Code__c-new-1'], ['Account-2', 'OLD-2', 'Legacy_Code__c-new-2']],
                hiddenColumnCount: 0
            });
            expect(valuesMessage.objects[1].rows[0]).toEqual(['Contact-0', 'Old 0', 'LastName-new-0']);

            // NOTHING WRITTEN: NOT THE RECIPE, AND NOTHING SENT TO THE ORG BUT THE LOAD'S READS
            expect(fs.readFileSync(recipeFilePath(), 'utf8')).toBe(recipeBefore);
            expect(informations().at(-1)).toBe('Generated new values for 5 records of Account-thru-OtherChildObject__c. Nothing was written to the org.');
            expect(postedNamed('updaterLoadState').slice(-2)).toEqual([
                { command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' },
                { command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' }
            ]);

        });

        it('shows every value, an edited expression in full, in the panel\'s confirmation before anything runs, and runs nothing on Cancel', async () => {

            answerConfirmation(undefined);
            await openCockpitAndLoad();

            await send(generateRequest(lastRenderSequence(), [
                { objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: "${{ fake.Word ~ '-edited' }}" },
                { objectApiName: 'Account', fieldApiName: 'Rating__c', value: 'Hot' },
                { objectApiName: 'Contact', fieldApiName: 'LastName' }
            ]));

            const [[title, options, ...buttons]] = confirmations();
            expect(title).toBe('Generate new values for 3 fields of Account-thru-OtherChildObject__c?');
            expect(buttons).toEqual([RECIPE_COCKPIT_UPDATER_GENERATE_CONFIRM_LABEL]);
            expect(options.detail.split('\n')).toEqual([
                'Generated by the recipe\'s own backend, snowfakery. Nothing is written to the org or the recipe file.',
                '',
                'Account: 3 records',
                "  Legacy_Code__c -- edited expression: ${{ fake.Word ~ '-edited' }}",
                '  Rating__c -- fixed value: Hot',
                'Contact: 2 records',
                '  LastName -- recipe expression: ${{fake.LastName}}'
            ]);

            expect(generatedRecipeTexts).toEqual([]);
            expect(RecipeCockpitService.readHeldUpdaterValues('Account')).toBeUndefined();
            expect(postedNamed('updaterValues')).toEqual([]);
            expect(postedNamed('updaterLoadState').at(-1)).toEqual({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' });

        });

        it('uses a fixed value as it is for every record, as the kind its field writes, and generates nothing for it', async () => {

            await openCockpitAndLoad();

            await send(generateRequest(lastRenderSequence(), [
                { objectApiName: 'Account', fieldApiName: 'Rating__c', value: 'Hot' },
                { objectApiName: 'Account', fieldApiName: 'Annual_Budget__c', value: '1250.5' }
            ]));

            expect(generatedRecipeTexts).toEqual([]);
            expect(RecipeCockpitService.readHeldUpdaterValues('Account')).toEqual(['Account-0', 'Account-1', 'Account-2'].map(recordId => ({
                recordId: recordId,
                fieldValues: { Rating__c: 'Hot', Annual_Budget__c: 1250.5 }
            })));

        });

        it('generates only the fields that are not fixed when an object has both', async () => {

            await openCockpitAndLoad();

            await send(generateRequest(lastRenderSequence(), [
                { objectApiName: 'Account', fieldApiName: 'Rating__c', value: 'Cold' },
                { objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }
            ]));

            expect(generatedRecipeTexts.map(recipeText => (yaml.load(recipeText) as any[])[0].fields)).toEqual([{ Legacy_Code__c: '${{fake.Word}}' }]);
            expect(RecipeCockpitService.readHeldUpdaterValues('Account')![1]).toEqual({ recordId: 'Account-1', fieldValues: { Rating__c: 'Cold', Legacy_Code__c: 'Legacy_Code__c-new-1' } });

        });

        it.each([
            ['a value the field\'s type refuses', [{ objectApiName: 'Account', fieldApiName: 'Annual_Budget__c', value: 'twelve' }], /Annual_Budget__c: Type a plain number/],
            ['a value that is not a declared picklist value', [{ objectApiName: 'Account', fieldApiName: 'Rating__c', value: 'Lukewarm' }], /is not a value this picklist declares/],
            ['an expression with a template inside it', [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: '${{ x }}${{ y }}' }], /This expression contains/],
            ['a value that is a nickname of the recipe', [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'Contact_NickName' }], /is a nickname in this card's recipe/],
            ['a field whose recipe has no expression and no value typed', [{ objectApiName: 'Account', fieldApiName: 'Regions__c' }], /has no faker expression/],
            ['a field locked as a lookup', [{ objectApiName: 'Account', fieldApiName: 'OwnerId' }], /cannot be filled: a lookup/],
            ['a field read only from the recipe file', [{ objectApiName: 'Account', fieldApiName: 'Name', value: 'Acme' }], /cannot be filled: read from the recipe file/]
        ])('refuses %s with a warning, asking nothing and generating nothing', async (_description, fields, warningPattern) => {

            await openCockpitAndLoad();

            await send(generateRequest(lastRenderSequence(), fields));

            expect(warnings().at(-1)).toMatch(warningPattern);
            expect(warnings().at(-1)).toMatch(/^No values were generated: /);
            expect(confirmations()).toEqual([]);
            expect(generatedRecipeTexts).toEqual([]);
            expect(postedNamed('updaterLoadState').at(-1)).toMatchObject({ isRunning: false, runKind: 'generate' });

        });

        it('refuses a field that was not chosen when the records were loaded, since its current value was not read', async () => {

            await openCockpitAndLoad();
            (RecipeCockpitService as any).heldUpdaterRecords.loadedFieldApiNamesByObjectApiName.set('Account', ['Legacy_Code__c']);

            await send(generateRequest(lastRenderSequence(), [{ objectApiName: 'Account', fieldApiName: 'Rating__c', value: 'Hot' }]));

            expect(warnings().at(-1)).toBe('No values were generated: Account.Rating__c was not chosen when the records were loaded, so its current value was not read. Load records again.');

        });

        it('refuses before any load, and after a new model lets the records go', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });

            await send(generateRequest(lastRenderSequence(), [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }]));
            expect(warnings()).toEqual([RECIPE_COCKPIT_UPDATER_NOT_LOADED_REFUSAL]);

        });

        it('says when the last load read none of the objects chosen', async () => {

            await openCockpitAndLoad();
            (RecipeCockpitService as any).heldUpdaterRecords.recordsByObjectApiName.set('Account', []);

            await send(generateRequest(lastRenderSequence(), [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }]));

            expect(warnings().at(-1)).toBe('No values were generated: the last load read no records of Account.');

        });

        it('warns with the backend\'s refusal and keeps nothing when a generation fails', async () => {

            await openCockpitAndLoad();
            processorAnswer = () => [];

            await send(generateRequest(lastRenderSequence(), [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }]));

            expect(warnings().at(-1)).toBe('No values were generated: snowfakery generated 0 Account records for 3 asked for.');
            expect(RecipeCockpitService.readHeldUpdaterValues('Account')).toBeUndefined();
            expect(postedNamed('updaterValues')).toEqual([]);

        });

        it('keeps nothing when the records changed while the confirmation was open', async () => {

            await openCockpitAndLoad();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation((_message: string, options?: { inPanel?: boolean }) => {
                if ( options?.inPanel ) {
                    RecipeCockpitService.clearHeldUpdaterRecords();
                    return Promise.resolve(RECIPE_COCKPIT_UPDATER_GENERATE_CONFIRM_LABEL);
                }
                return Promise.resolve(undefined);
            });

            await send(generateRequest(lastRenderSequence(), [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }]));

            expect(generatedRecipeTexts).toEqual([]);
            expect(postedNamed('updaterValues')).toEqual([]);

        });

        it('keeps nothing when the run on screen changed while the values were generated', async () => {

            await openCockpitAndLoad();
            processorAnswer = (recipeText: string) => {
                panelState().recipeDataMessage = { ...panelState().recipeDataMessage! };
                const [recipe] = yaml.load(recipeText) as any[];
                return Array.from({ length: recipe.count }, () => ({ attributes: { type: recipe.object }, Legacy_Code__c: 'x' }));
            };

            await send(generateRequest(lastRenderSequence(), [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }]));

            expect(warnings().at(-1)).toMatch(/were not kept: the run on screen or its records changed/);
            expect(RecipeCockpitService.readHeldUpdaterValues('Account')).toBeUndefined();

        });

        it('answers a generation that reaches the host while a run is in flight with that run\'s state', async () => {

            await openCockpitAndLoad();
            const runningState = { command: 'updaterLoadState', isRunning: true, treeKey: 'Lead-ONLY' };
            (RecipeCockpitService as any).isUpdaterLoadInFlight = true;
            (RecipeCockpitService as any).updaterLoadRunStateMessage = runningState;

            postedPanelMessages = [];
            const cockpitPanel = (RecipeCockpitService as any).recipeCockpitPanel;
            await (RecipeCockpitService as any).generateUpdaterValuesFromPanel(cockpitPanel, panelState(), { kind: 'generateUpdaterValues', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), fieldRequests: [] });

            expect(postedPanelMessages).toEqual([runningState]);

        });

        it('replays the preview on a reveal of the same model, and lets the values go when the next load starts', async () => {

            await openCockpitAndLoad();
            await send(generateRequest(lastRenderSequence(), [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }]));
            const [valuesMessage] = postedNamed('updaterValues');

            postedPanelMessages = [];
            await send({ command: 'ready' });
            expect(postedNamed('updaterValues')).toEqual([valuesMessage]);

            await send({ command: 'rendered', renderSequence: lastRenderSequence() });
            panelState().dataOrgSelection = { orgIndex: 0, orgDetail: SANDBOX_ORG, requestSequence: 2, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' } };
            await send(loadRequest(lastRenderSequence()));
            expect(RecipeCockpitService.readHeldUpdaterRecordCount()).toBe(5);
            expect(RecipeCockpitService.readHeldUpdaterValues('Account')).toBeUndefined();
            postedPanelMessages = [];
            await send({ command: 'ready' });
            expect(postedNamed('updaterValues')).toEqual([]);

        });

        it('refuses a card whose recipe file is gone, or whose backend its path does not tell', async () => {

            await openCockpitAndLoad();
            const renderSequence = lastRenderSequence();
            const cockpitPanel = (RecipeCockpitService as any).recipeCockpitPanel;
            const runGenerate = async () => await (RecipeCockpitService as any).generateUpdaterValuesFromPanel(cockpitPanel, panelState(), {
                kind: 'generateUpdaterValues', treeKey: ACCOUNT_TREE_KEY, renderSequence: renderSequence, fieldRequests: [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }]
            });

            jest.spyOn(VSCodeWorkspaceService, 'readRecipeFakerService').mockReturnValueOnce(undefined);
            await runGenerate();
            expect(warnings().at(-1)).toMatch(/faker backend this card's recipe was written for could not be told/);

            jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => { throw new Error('gone'); });
            await runGenerate();
            expect(warnings().at(-1)).toMatch(/recipe file could not be read/);

            fs.rmSync(recipeFilePath());
            await runGenerate();
            expect(warnings().at(-1)).toMatch(/no single recipe file/);

            // A FIELD THE MODEL NO LONGER LISTS, AND A STALE MODEL, GENERATE NOTHING
            await (RecipeCockpitService as any).generateUpdaterValuesFromPanel(cockpitPanel, panelState(), {
                kind: 'generateUpdaterValues', treeKey: ACCOUNT_TREE_KEY, renderSequence: renderSequence - 1, fieldRequests: []
            });
            expect(generatedRecipeTexts).toEqual([]);

        });

        it('names a renamed card by its name, counts one record as one, says an object with none generates nothing, and gives a field the backend wrote no value for none', async () => {

            await openCockpitAndLoad();
            const heldRecords = (RecipeCockpitService as any).heldUpdaterRecords;
            heldRecords.recordsByObjectApiName.set('Account', heldRecords.recordsByObjectApiName.get('Account').slice(0, 1));
            heldRecords.recordsByObjectApiName.delete('Contact');
            panelState().recipeDataMessage!.recipe.trees.find((tree: any) => tree.treeKey === ACCOUNT_TREE_KEY)!.customName = 'My Accounts';
            processorAnswer = (recipeText: string) => {
                const [recipe] = yaml.load(recipeText) as any[];
                return [{ attributes: { type: recipe.object } }];
            };

            await send(generateRequest(lastRenderSequence(), [
                { objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' },
                { objectApiName: 'Contact', fieldApiName: 'LastName' }
            ]));

            const [[title, options]] = confirmations();
            expect(title).toBe('Generate new values for 2 fields of My Accounts?');
            expect(options.detail.split('\n').slice(2)).toEqual([
                'Account: 1 record',
                '  Legacy_Code__c -- recipe expression: ${{fake.Word}}',
                'Contact: 0 records, so nothing is generated',
                '  LastName -- recipe expression: ${{fake.LastName}}'
            ]);
            expect(generatedRecipeTexts).toHaveLength(1);
            expect(RecipeCockpitService.readHeldUpdaterValues('Account')).toEqual([{ recordId: 'Account-0', fieldValues: { Legacy_Code__c: null } }]);
            expect(postedNamed('updaterValues')[0].objects[1]).toEqual({ objectApiName: 'Contact', recordCount: 0, fieldApiNames: ['LastName'], columns: [], rows: [], hiddenColumnCount: 0 });
            expect(informations().at(-1)).toBe('Generated new values for 1 record of My Accounts. Nothing was written to the org.');

        });

        it('refuses an object the load did not read at all, and runs nothing with no model on screen', async () => {

            await openCockpitAndLoad();
            const cockpitPanel = (RecipeCockpitService as any).recipeCockpitPanel;
            (RecipeCockpitService as any).heldUpdaterRecords.loadedFieldApiNamesByObjectApiName.delete('Contact');

            await send(generateRequest(lastRenderSequence(), [{ objectApiName: 'Contact', fieldApiName: 'LastName' }]));
            expect(warnings().at(-1)).toMatch(/Contact\.LastName was not chosen when the records were loaded/);

            const emptyPanelState = RecipeCockpitService.buildInitialPanelState(workspaceRoot);
            await (RecipeCockpitService as any).generateUpdaterValuesFromPanel(cockpitPanel, emptyPanelState, { kind: 'generateUpdaterValues', treeKey: ACCOUNT_TREE_KEY, renderSequence: 1, fieldRequests: [] });
            expect(confirmations()).toEqual([]);

        });

        it('answers a generation while one is in flight with no stored state as not running', async () => {

            await openCockpitAndLoad();
            (RecipeCockpitService as any).isUpdaterLoadInFlight = true;
            (RecipeCockpitService as any).updaterLoadRunStateMessage = undefined;

            postedPanelMessages = [];
            await (RecipeCockpitService as any).generateUpdaterValuesFromPanel((RecipeCockpitService as any).recipeCockpitPanel, panelState(), { kind: 'generateUpdaterValues', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), fieldRequests: [] });

            expect(postedPanelMessages).toEqual([{ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' }]);

        });

        it('generates from a Treecipe-tab edit in the recipe file over the wrapper\'s expression, and uses a fixed one as it is', async () => {

            await openCockpitAndLoad();
            panelState().recipeDataMessage!.recipe.trees.find((tree: any) => tree.treeKey === ACCOUNT_TREE_KEY)!.fixedValues = [
                { objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: '${{ fake.Word ~ \'!\' }}', kind: 'expression' },
                { objectApiName: 'Account', fieldApiName: 'Annual_Budget__c', value: '99', kind: 'number' }
            ];

            await send(generateRequest(lastRenderSequence(), [
                { objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' },
                { objectApiName: 'Account', fieldApiName: 'Annual_Budget__c' }
            ]));

            expect(confirmations()[0][1].detail.split('\n').slice(3)).toEqual([
                '  Legacy_Code__c -- expression edited in the recipe file: ${{ fake.Word ~ \'!\' }}',
                '  Annual_Budget__c -- fixed value in the recipe file: 99'
            ]);
            expect(generatedRecipeTexts.map(recipeText => (yaml.load(recipeText) as any[])[0].fields)).toEqual([{ Legacy_Code__c: '${{ fake.Word ~ \'!\' }}' }]);
            expect(RecipeCockpitService.readHeldUpdaterValues('Account')![0]).toEqual({ recordId: 'Account-0', fieldValues: { Legacy_Code__c: 'Legacy_Code__c-new-0', Annual_Budget__c: 99 } });

        });

        it('keeps nothing and says so when the reader cancels the generation', async () => {

            await openCockpitAndLoad();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, { isCancellationRequested: true }));
            jest.spyOn(RecipeCockpitService, 'generateUpdaterObjectValues').mockResolvedValue({ isCancelled: true });

            await send(generateRequest(lastRenderSequence(), [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' }]));

            expect(warnings().at(-1)).toBe('Generating new values for Account-thru-OtherChildObject__c was cancelled, so none were kept.');
            expect(RecipeCockpitService.readHeldUpdaterValues('Account')).toBeUndefined();
            expect(postedNamed('updaterValues')).toEqual([]);

        });

        it('refuses a field the model does not list, checked again at the run', async () => {

            await openCockpitAndLoad();
            const cockpitPanel = (RecipeCockpitService as any).recipeCockpitPanel;

            await (RecipeCockpitService as any).generateUpdaterValuesFromPanel(cockpitPanel, panelState(), {
                kind: 'generateUpdaterValues', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), fieldRequests: [{ objectApiName: 'Account', fieldApiName: 'Gone__c' }]
            });

            expect(warnings().at(-1)).toBe('No values were generated: Account.Gone__c is not a field of this treecipe.');

            await (RecipeCockpitService as any).generateUpdaterValuesFromPanel(cockpitPanel, panelState(), {
                kind: 'generateUpdaterValues', treeKey: ACCOUNT_TREE_KEY, renderSequence: lastRenderSequence(), fieldRequests: [{ objectApiName: 'Gone__c', fieldApiName: 'Name' }]
            });

            expect(warnings().at(-1)).toBe('No values were generated: Gone__c.Name is not a field of this treecipe.');

        });

    });

    describe('toUpdaterFixedValue', () => {

        it('gives a number as a number unless a double would round it, a boolean as a boolean, and text as typed', () => {

            expect(RecipeCockpitService.toUpdaterFixedValue('42', 'number')).toBe(42);
            expect(RecipeCockpitService.toUpdaterFixedValue('-3.25', 'number')).toBe(-3.25);
            expect(RecipeCockpitService.toUpdaterFixedValue('123456789012345678', 'number')).toBe('123456789012345678');
            expect(RecipeCockpitService.toUpdaterFixedValue('true', 'boolean')).toBe(true);
            expect(RecipeCockpitService.toUpdaterFixedValue('false', 'boolean')).toBe(false);
            expect(RecipeCockpitService.toUpdaterFixedValue('007', 'text')).toBe('007');

        });

    });

    describe('the panel script', () => {

        const renderUpdater = () => {
            const recipe = loadTreeRecipe();
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            const accountCard = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes('OtherChildObject__c')));
            panel.openTab(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
            const updaterPanel = panel.findAll(accountCard, 'treeUpdater')[0];
            return { panel, accountCard, updaterPanel };
        };

        const objectNamed = (panel: any, updaterPanel: any, objectApiName: string) => panel.findAll(updaterPanel, 'updaterObject')
            .find((objectElement: any) => panel.findAll(objectElement, 'updaterObjectName')[0].textContent === objectApiName);

        const expand = (panel: any, objectElement: any) => panel.findAll(objectElement.children[0], 'updaterObjectToggle')[0].dispatch('click');

        const rowNamed = (panel: any, objectElement: any, fieldApiName: string) => panel.findAll(objectElement, 'updaterField')
            .find((rowElement: any) => panel.findAll(rowElement, 'updaterFieldName')[0].textContent === fieldApiName);

        const loadedMessage = {
            command: 'updaterRecords',
            renderSequence: 1,
            treeKey: ACCOUNT_TREE_KEY,
            orgLabel: 'qa · qa@example.com.qa',
            objects: [{ objectApiName: 'Account', totalSize: 2, recordCount: 2, isTruncated: false, columns: ['Id'], rows: [['001A'], ['001B']], hiddenColumnCount: 0 }]
        };

        const postedNamed = (panel: any, command: string) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === command);

        it('holds Generate values until records are loaded and a field is chosen, then posts every chosen field with the value typed for it', () => {

            const { panel, updaterPanel } = renderUpdater();
            const generateButton = panel.findAll(updaterPanel, 'updaterGenerate')[0];
            expect(generateButton.textContent).toBe(RECIPE_COCKPIT_UPDATER_GENERATE_LABEL);
            expect(generateButton.className).toContain('sdtButton-secondary');
            expect(generateButton.disabled).toBe(true);
            expect(generateButton.attributes.title).toMatch(/^Load records first/);

            const accountObject = objectNamed(panel, updaterPanel, 'Account');
            const contactObject = objectNamed(panel, updaterPanel, 'Contact');
            expand(panel, accountObject);
            expand(panel, contactObject);
            panel.postToPanel(loadedMessage);
            expect(generateButton.disabled).toBe(true);
            expect(generateButton.attributes.title).toBe('Choose a field to fill first.');

            panel.findAll(rowNamed(panel, accountObject, 'Legacy_Code__c'), 'updaterFieldChoose')[0].dispatch('click');
            panel.findAll(rowNamed(panel, accountObject, 'Rating__c'), 'updaterFieldChoose')[0].dispatch('click');
            panel.findAll(rowNamed(panel, contactObject, 'LastName'), 'updaterFieldChoose')[0].dispatch('click');
            expect(generateButton.disabled).toBe(false);

            // A VALUE TYPED FOR Rating__c, AND ONE SAVED THEN CLEARED FOR LastName
            const ratingRow = rowNamed(panel, accountObject, 'Rating__c');
            panel.findAll(ratingRow, 'updaterFieldEdit')[0].dispatch('click');
            const ratingInput = panel.findAll(ratingRow, 'fieldEditorInput')[0];
            expect(ratingInput.value).toBe('${{ random_choice(\'Hot\',\'Warm\',\'Cold\') }}');
            ratingInput.value = 'Hot';
            panel.findAll(ratingRow, 'fieldEditorSave')[0].dispatch('click');

            const lastNameRow = rowNamed(panel, contactObject, 'LastName');
            panel.findAll(lastNameRow, 'updaterFieldEdit')[0].dispatch('click');
            panel.findAll(lastNameRow, 'fieldEditorInput')[0].value = '${{ fake.FirstName }}';
            panel.findAll(lastNameRow, 'fieldEditorSave')[0].dispatch('click');
            panel.findAll(lastNameRow, 'updaterFieldEdit')[0].dispatch('click');
            panel.findAll(lastNameRow, 'fieldEditorClear')[0].dispatch('click');

            generateButton.dispatch('click');

            expect(postedNamed(panel, 'generateUpdaterValues')).toEqual([{
                command: 'generateUpdaterValues',
                treeKey: ACCOUNT_TREE_KEY,
                renderSequence: 1,
                fields: [
                    { objectApiName: 'Account', fieldApiName: 'Legacy_Code__c' },
                    { objectApiName: 'Account', fieldApiName: 'Rating__c', value: 'Hot' },
                    { objectApiName: 'Contact', fieldApiName: 'LastName' }
                ]
            }]);
            expect(generateButton.disabled).toBe(true);
            expect(generateButton.textContent).toBe(RECIPE_COCKPIT_UPDATER_GENERATING_LABEL);
            expect(panel.findAll(updaterPanel, 'updaterLoad')[0].disabled).toBe(true);
            expect(panel.findAll(updaterPanel, 'updaterLoad')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_LOAD_LABEL);

            // A SECOND CLICK WHILE IT RUNS POSTS NOTHING, AND THE RECIPE IS NEVER WRITTEN FROM THIS EDITOR
            generateButton.dispatch('click');
            expect(postedNamed(panel, 'generateUpdaterValues')).toHaveLength(1);
            expect(postedNamed(panel, 'setFieldFixedValue')).toEqual([]);

            panel.postToPanel({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' });
            expect(generateButton.disabled).toBe(false);
            expect(generateButton.textContent).toBe(RECIPE_COCKPIT_UPDATER_GENERATE_LABEL);

        });

        it('draws a typed value in place of the expression, says which kind it is, and keeps the recipe\'s own expression as no edit', () => {

            const { panel, updaterPanel } = renderUpdater();
            const accountObject = objectNamed(panel, updaterPanel, 'Account');
            expand(panel, accountObject);
            const legacyRow = rowNamed(panel, accountObject, 'Legacy_Code__c');
            const editButton = panel.findAll(legacyRow, 'updaterFieldEdit')[0];
            const badge = panel.findAll(legacyRow, 'fixedValueBadge')[0];
            const editedValue = panel.findAll(legacyRow, 'updaterEditedValue')[0];

            expect(editButton.className).toContain('sdtButton-icon');
            expect(editButton.attributes['aria-pressed']).toBe('false');
            expect(panel.isHidden(badge)).toBe(true);

            editButton.dispatch('click');
            expect(editButton.attributes['aria-expanded']).toBe('true');
            expect(panel.findAll(legacyRow, 'fieldEditorHint')[0].textContent).toMatch(/^Generated from this faker expression/);
            const input = panel.findAll(legacyRow, 'fieldEditorInput')[0];
            input.value = '<b>LEGACY</b>';
            input.dispatch('input');
            expect(panel.findAll(legacyRow, 'fieldEditorHint')[0].textContent).toMatch(/^This fixed value for every loaded record\. Type the text every record gets\./);
            input.dispatch('keydown', { key: 'Enter', preventDefault: () => undefined });

            expect(panel.findAll(legacyRow, 'fieldEditorInput')).toEqual([]);
            expect(editButton.attributes['aria-pressed']).toBe('true');
            expect(badge.textContent).toBe('fixed');
            expect(editedValue.textContent).toBe('<b>LEGACY</b>');
            expect(panel.findAll(legacyRow, 'b')).toEqual([]);
            expect(panel.isHidden(panel.findAll(legacyRow, 'expressionRow')[0])).toBe(true);

            editButton.dispatch('click');
            const reopenedInput = panel.findAll(legacyRow, 'fieldEditorInput')[0];
            expect(reopenedInput.value).toBe('<b>LEGACY</b>');
            reopenedInput.value = '  ${{fake.Word}}  ';
            panel.findAll(legacyRow, 'fieldEditorSave')[0].dispatch('click');
            expect(editButton.attributes['aria-pressed']).toBe('false');
            expect(panel.isHidden(badge)).toBe(true);

            editButton.dispatch('click');
            panel.findAll(legacyRow, 'fieldEditorInput')[0].value = '${{ fake.Word }}x';
            panel.findAll(legacyRow, 'fieldEditorInput')[0].dispatch('keydown', { key: 'Enter', preventDefault: () => undefined });
            expect(badge.textContent).toBe('edited');

            // ESCAPE AND CANCEL CLOSE WITHOUT CHANGING IT
            editButton.dispatch('click');
            panel.findAll(legacyRow, 'fieldEditorInput')[0].value = 'other';
            panel.findAll(legacyRow, 'fieldEditorInput')[0].dispatch('keydown', { key: 'Escape', preventDefault: () => undefined });
            editButton.dispatch('click');
            panel.findAll(legacyRow, 'fieldEditorCancel')[0].dispatch('click');
            expect(badge.textContent).toBe('edited');
            editButton.dispatch('click');
            editButton.dispatch('click');
            expect(panel.findAll(legacyRow, 'fieldEditorInput')).toEqual([]);

            // A FIELD WHOSE RECIPE HAS NO EXPRESSION OPENS EMPTY, AND A LOCKED FIELD HAS NO EDITOR
            const regionsRow = rowNamed(panel, accountObject, 'Regions__c');
            expect(panel.findAll(regionsRow, 'updaterFieldEdit')[0].attributes.title).toMatch(/has no faker expression/);
            panel.findAll(regionsRow, 'updaterFieldEdit')[0].dispatch('click');
            expect(panel.findAll(regionsRow, 'fieldEditorInput')[0].value).toBe('');
            expect(panel.findAll(rowNamed(panel, accountObject, 'OwnerId'), 'updaterFieldEdit')).toEqual([]);

        });

        it('draws each object\'s new values as text on the model they were generated on, and lets them go when a load or a generation starts', () => {

            const { panel, updaterPanel } = renderUpdater();
            const accountObject = objectNamed(panel, updaterPanel, 'Account');
            const contactObject = objectNamed(panel, updaterPanel, 'Contact');
            expand(panel, accountObject);
            panel.postToPanel(loadedMessage);

            const valuesMessage = (renderSequence: number) => ({
                command: 'updaterValues',
                renderSequence: renderSequence,
                treeKey: ACCOUNT_TREE_KEY,
                objects: [
                    { objectApiName: 'Account', recordCount: 12, fieldApiNames: ['Legacy_Code__c'], columns: ['Id', 'Legacy_Code__c (current)', 'Legacy_Code__c (new)'], rows: Array.from({ length: 10 }, () => ['001A', 'OLD', '<i>new</i>']), hiddenColumnCount: 0 },
                    { objectApiName: 'Contact', recordCount: 0, fieldApiNames: ['LastName'], columns: [], rows: [], hiddenColumnCount: 0 }
                ]
            });

            panel.postToPanel(valuesMessage(2));
            expect(panel.findAll(accountObject, 'updaterValuesSummary')).toEqual([]);

            panel.postToPanel(valuesMessage(1));
            const valuesElement = panel.findAll(accountObject, 'updaterValues')[0];
            expect(panel.isHidden(valuesElement)).toBe(false);
            expect(panel.findAll(valuesElement, 'updaterValuesSummary')[0].textContent).toBe('New values for 12 records, not written to the org yet. Showing the first 10');
            const cells = panel.findAll(valuesElement, 'treeQueryRow').map((rowElement: any) => rowElement.children.map((cellElement: any) => cellElement.textContent));
            expect(cells[0]).toEqual(['001A', 'OLD', '<i>new</i>']);
            expect(panel.findAll(valuesElement, 'i')).toEqual([]);

            // AN OBJECT OPENED AFTER THE VALUES ARRIVED DRAWS THEM WHEN ITS BODY IS BUILT
            expand(panel, contactObject);
            expect(panel.findAll(contactObject, 'updaterValuesSummary')[0].textContent).toBe('No new values: the last load read no records of this object');

            panel.postToPanel({ command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' });
            expect(panel.isHidden(valuesElement)).toBe(true);
            expect(panel.isHidden(panel.findAll(accountObject, 'updaterRecords')[0])).toBe(false);

            panel.postToPanel(valuesMessage(1));
            panel.postToPanel({ command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY });
            expect(panel.isHidden(valuesElement)).toBe(true);
            expect(panel.findAll(updaterPanel, 'updaterLoad')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_LOADING_LABEL);
            expect(panel.findAll(updaterPanel, 'updaterGenerate')[0].attributes.title).toMatch(/^Load records first/);

        });

        it('starts the editor from a Treecipe-tab edit in the recipe file, and counts that edit as no Updater edit', () => {

            const recipe = loadTreeRecipe();
            recipe.trees.find((tree: any) => tree.treeKey === ACCOUNT_TREE_KEY)!.fixedValues = [{ objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', value: 'PINNED', kind: 'text' }];
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            const accountCard = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes('OtherChildObject__c')));
            panel.openTab(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
            const updaterPanel = panel.findAll(accountCard, 'treeUpdater')[0];
            const accountObject = objectNamed(panel, updaterPanel, 'Account');
            expand(panel, accountObject);
            const legacyRow = rowNamed(panel, accountObject, 'Legacy_Code__c');

            panel.findAll(legacyRow, 'updaterFieldEdit')[0].dispatch('click');
            expect(panel.findAll(legacyRow, 'fieldEditorInput')[0].value).toBe('PINNED');
            panel.findAll(legacyRow, 'fieldEditorSave')[0].dispatch('click');
            expect(panel.findAll(legacyRow, 'updaterFieldEdit')[0].attributes['aria-pressed']).toBe('false');

        });

        it('draws values on a tab built after they arrived', () => {

            const recipe = loadTreeRecipe();
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            panel.postToPanel(loadedMessage);
            panel.postToPanel({ command: 'updaterValues', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, objects: [{ objectApiName: 'Account', recordCount: 2, fieldApiNames: ['Legacy_Code__c'], columns: ['Id', 'Legacy_Code__c (new)'], rows: [['001A', 'x'], ['001B', 'y']], hiddenColumnCount: 3 }] });
            panel.postToPanel({ command: 'updaterValues', renderSequence: 1, treeKey: 'Not-A-Card', objects: [] });

            const accountCard = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes('OtherChildObject__c')));
            panel.openTab(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
            const updaterPanel = panel.findAll(accountCard, 'treeUpdater')[0];
            const accountObject = objectNamed(panel, updaterPanel, 'Account');
            expand(panel, accountObject);

            expect(panel.findAll(accountObject, 'updaterValuesSummary')[0].textContent).toBe('New values for 2 records, not written to the org yet. Showing 2 columns, 3 more not shown');

        });

    });

});
