import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn(), showInformationMessage: jest.fn(), showQuickPick: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import { RecipeCockpitService } from '../RecipeCockpitService';
import { RecipeCockpitModelBuild } from '../RecipeCockpitModelBuild';
import { RecipeCockpitDrawnModel } from '../RecipeCockpitDrawnModel';
import { RecipeCockpitTreecipeHost } from '../RecipeCockpitTreecipeHost';
import { RecipeCockpitFakerValueExample, RECIPE_COCKPIT_FAKER_VALUE_EXAMPLE_MAX_LENGTH } from '../RecipeCockpitFakerValueExample';
import { RecipeCockpitFakerValueGeneration } from '../RecipeCockpitFakerValueGeneration';
import { RecipeCockpitRecipeWriter } from '../../RecipeWriter/RecipeCockpitRecipeWriter';
import { SnowfakeryRecipeProcessor } from '../../FakerRecipeProcessor/SnowfakeryRecipeProcessor/SnowfakeryRecipeProcessor';
import {
    RECIPE_COCKPIT_FAKER_VALUE_EXAMPLE_PREFIX,
    RECIPE_COCKPIT_FAKER_VALUE_TEST_GLYPH,
    RECIPE_COCKPIT_FAKER_VALUE_TEST_LABEL_PREFIX
} from '../RecipeCockpitFieldRowsConstants';
import { RECIPE_COCKPIT_PANEL_STYLESHEET } from '../RecipeCockpitPanelStylesheet.generated';
import { IRecipeCockpitPanelState, IRecipeCockpitRecipeViewModel } from '../RecipeCockpitViewModel';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    #718: a "Test faker value" button at the right of a field row's faker expression runs it once,
    through the card's own backend, and shows "Example: <value>" under it. No button where there is
    no expression to run alone: a lookup, a dependent picklist, a read-only or derived field, or a
    row a fixed value takes the place of.
*/

const RUN_FOLDER_NAME = 'recipe-2026-11-24T00-00-00';
const TREE_KEY = 'Gizmo__c-ONLY';

const CURRENCY_EXPRESSION = "${{ faker.number.bigInt({min: 0n, max: 9999999999999999n}) + '.' + faker.string.numeric({length: 2, allowLeadingZeros: true}) }}";
const DATE_EXPRESSION = "${{ faker.date.between({ from: new Date('2023-01-01'), to: new Date() }).toISOString().split('T')[0] }}";
const PICKLIST_EXPRESSION = '${{ faker.helpers.arrayElement([`cle`,`eastlake`,`madison`]) }}';

const GIZMO_RECIPE = [
    '- object: Gizmo__c',
    '  nickname: Gizmo__c_NickName',
    '  count: 1',
    '  fields:',
    '    Amount__c: |',
    `            ${CURRENCY_EXPRESSION}`,
    '    Start_Date__c: |',
    `                ${DATE_EXPRESSION}`,
    `    Status__c: ${PICKLIST_EXPRESSION}`,
    '    Sub_Status__c:',
    '      if:',
    '        - choice:',
    "            when: ${{ Status__c == 'cle' }}",
    '            pick:',
    '                random_choice:',
    '                    - north',
    '                    - south',
    '    Account__c: Account_NickName',
    '    Total__c: READ ONLY -- formula',
    ''
].join('\n');

describe('RecipeCockpitService, "Test faker value" on a field row (#718)', () => {

    let workspaceRoot: string;
    let recipeFilePath: string;

    beforeEach(() => {

        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-faker-value-test-'));
        const runFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', RUN_FOLDER_NAME);
        fs.mkdirSync(path.join(runFolderPath, TREE_KEY), { recursive: true });

        const wrapperField = (fieldName: string, type: string, recipeValue: string, extra: Record<string, unknown> = {}) => ({ objectName: 'Gizmo__c', fieldName, fieldLabel: fieldName, type, recipeValue, ...extra });
        fs.writeFileSync(path.join(runFolderPath, 'treecipeObjectsWrapper-2026-11-24T00-00-00.json'), JSON.stringify({
            ObjectToObjectInfoMap: {
                Gizmo__c: {
                    Fields: [
                        wrapperField('Amount__c', 'Currency', CURRENCY_EXPRESSION, { precision: 18, scale: 2 }),
                        wrapperField('Start_Date__c', 'Date', DATE_EXPRESSION),
                        wrapperField('Status__c', 'Picklist', PICKLIST_EXPRESSION, { picklistValues: [{ fullName: 'cle' }, { fullName: 'eastlake' }, { fullName: 'madison' }] }),
                        wrapperField('Sub_Status__c', 'Picklist', '', { controllingField: 'Status__c' }),
                        wrapperField('Account__c', 'Lookup', 'Account_NickName', { referenceTo: 'Account' }),
                        wrapperField('Total__c', 'Currency', 'READ ONLY -- formula', { readOnlyReason: 'formula' })
                    ],
                    RelationshipDetail: { level: 0, parentObjectToFieldReferences: {} }
                }
            },
            RecipeFiles: [{ objects: ['Gizmo__c'] }]
        }));
        recipeFilePath = path.join(runFolderPath, TREE_KEY, `recipe--${TREE_KEY}-2026-11-24T00-00-00.yml`);
        fs.writeFileSync(recipeFilePath, GIZMO_RECIPE);

    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    const loadModel = (): IRecipeCockpitRecipeViewModel => RecipeCockpitModelBuild.buildRecipeViewModel(workspaceRoot);

    const buildDrawnPanelState = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined): IRecipeCockpitPanelState => {
        const panelState = RecipeCockpitService.buildInitialPanelState(workspaceRoot);
        const recipe = loadModel();
        recipeChanges(recipe);
        panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 4 };
        panelState.treeHistoryAllowLists = RecipeCockpitDrawnModel.collectTreeHistoryAllowLists(recipe);
        return panelState;
    };

    const route = (payload: Record<string, unknown>, panelState = buildDrawnPanelState()) =>
        RecipeCockpitService.routePanelMessage({ command: 'testFakerValue', treeKey: TREE_KEY, objectApiName: 'Gizmo__c', ...payload } as any, panelState);

    describe('the rows that get the button', () => {

        test.each([
            ['an expression on its own line', '${{ faker.number.int() }}', true],
            ['a block scalar\'s expression', '|\n${{ faker.number.int() }}', true],
            ['a double-quoted expression', '"${{ fake.Word }}"', true],
            ['a lookup\'s nickname', 'Account_NickName', false],
            ['a TODO comment', '### TODO -- REFERENCE ID REQUIRED', false],
            ['a read-only field', 'READ ONLY -- formula', false],
            ['nothing', '', false]
        ])('%s: %s', (unusedCase, recipeValue, hasButton) => {

            expect(RecipeCockpitFakerValueExample.findNoExampleReason({ objectApiName: 'Gizmo__c', fieldApiName: 'X__c', recipeValue }) === undefined).toBe(hasButton);

        });

        test('a dependent picklist and a derived field have no button, whatever their value', () => {

            expect(RecipeCockpitFakerValueExample.findNoExampleReason({ objectApiName: 'Gizmo__c', fieldApiName: 'Sub__c', recipeValue: '${{ faker.number.int() }}', controllingField: 'Status__c' }))
                .toBe('takes its value from its controlling field, so one field alone cannot be run');
            expect(RecipeCockpitFakerValueExample.findNoExampleReason({ objectApiName: 'Quote', fieldApiName: 'AccountId', recipeValue: '${{ faker.number.int() }}' }))
                .toBe('is set by Salesforce from another lookup');

        });

        test('finds an expression exactly where the writer does, on every value the golden recipes write', () => {

            const goldenFolderPath = path.join(__dirname, '..', '..', 'ExtensionCommandService', 'tests', 'golden');
            const recipeFilePaths: string[] = [];
            const walk = (folderPath: string) => fs.readdirSync(folderPath, { withFileTypes: true }).forEach(entry => {
                const entryPath = path.join(folderPath, entry.name);
                if ( entry.isDirectory() ) { walk(entryPath); } else if ( /\.ya?ml$/.test(entry.name) ) { recipeFilePaths.push(entryPath); }
            });
            walk(goldenFolderPath);

            const fieldValues = recipeFilePaths.flatMap(goldenRecipePath => fs.readFileSync(goldenRecipePath, 'utf8').split('\n').map(line => line.replace(/^\s*[A-Za-z_][A-Za-z0-9_]*:\s?/, '')));
            const hostileValues = ['"${{ broken \\q }}"', '"${{ a\\u2028b }}"', '  "${{ fake.Word }}"  ', '#${{ x }}'];

            expect(fieldValues.length).toBeGreaterThan(500);
            [...fieldValues, ...hostileValues].forEach(fieldValue => {
                expect([fieldValue, RecipeCockpitFakerValueExample.hasExpressionLine(fieldValue)]).toEqual([fieldValue, RecipeCockpitRecipeWriter.findFirstExpressionLine(fieldValue) !== undefined]);
            });

        });

        test('an example is one line of text, a value that is not a string written as JSON, cut at the limit', () => {

            expect(RecipeCockpitFakerValueExample.toExampleText('2025-09-08')).toBe('2025-09-08');
            expect(RecipeCockpitFakerValueExample.toExampleText(42.5)).toBe('42.5');
            expect(RecipeCockpitFakerValueExample.toExampleText(true)).toBe('true');
            expect(RecipeCockpitFakerValueExample.toExampleText(null)).toBe('null');
            expect(RecipeCockpitFakerValueExample.toExampleText(undefined)).toBe('undefined');
            expect(RecipeCockpitFakerValueExample.hasExpressionLine(undefined as unknown as string)).toBeFalse();
            expect(RecipeCockpitFakerValueExample.toExampleText('x'.repeat(RECIPE_COCKPIT_FAKER_VALUE_EXAMPLE_MAX_LENGTH + 10))).toBe('x'.repeat(RECIPE_COCKPIT_FAKER_VALUE_EXAMPLE_MAX_LENGTH) + '…');

        });

    });

    describe('the panel script', () => {

        const renderModel = () => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadModel(), renderSequence: 1 });
            panel.expandAllTrees();
            panel.objectElements().forEach((objectElement: any) => panel.expandObject(objectElement));
            return panel;
        };
        const gizmoRow = (panel: any, fieldApiName: string) => panel.fieldRowNamed(panel.objectElements()[0], fieldApiName);
        const testButtonOf = (panel: any, fieldApiName: string) => panel.findAll(gizmoRow(panel, fieldApiName), 'fakerValueTest')[0];
        const exampleOf = (panel: any, fieldApiName: string) => panel.findAll(gizmoRow(panel, fieldApiName), 'fakerValueExample')[0];
        const testMessages = (panel: any) => panel.postedHostMessages.filter((message: any) => message.command === 'testFakerValue');

        test('draws an icon button named for its field at the right of each expression to run, with nothing shown under it yet', () => {

            const panel = renderModel();

            ['Amount__c', 'Start_Date__c', 'Status__c'].forEach(fieldApiName => {
                const expressionRow = panel.findAll(gizmoRow(panel, fieldApiName), 'expressionRow')[0];
                const buttonElement = testButtonOf(panel, fieldApiName);
                expect(expressionRow.children[expressionRow.children.length - 1]).toBe(buttonElement);
                expect(buttonElement.tagName).toBe('button');
                expect(buttonElement.classList.contains('sdtButton-icon')).toBeTrue();
                expect(buttonElement.textContent).toBe(RECIPE_COCKPIT_FAKER_VALUE_TEST_GLYPH);
                expect(buttonElement.attributes['aria-label']).toBe(`${RECIPE_COCKPIT_FAKER_VALUE_TEST_LABEL_PREFIX}Gizmo__c.${fieldApiName}`);
                expect(panel.isHidden(exampleOf(panel, fieldApiName))).toBeTrue();
            });

        });

        test.each([['Account__c', 'a lookup'], ['Total__c', 'a read-only field'], ['Sub_Status__c', 'a dependent picklist']])('draws no button on %s (%s)', (fieldApiName) => {

            const panel = renderModel();

            expect(testButtonOf(panel, fieldApiName)).toBeUndefined();
            expect(exampleOf(panel, fieldApiName)).toBeUndefined();

        });

        test('posts the row\'s names only, and is disabled and busy until the host answers', () => {

            const panel = renderModel();
            const buttonElement = testButtonOf(panel, 'Amount__c');

            buttonElement.dispatch('click');
            buttonElement.dispatch('click');

            expect(testMessages(panel)).toEqual([{ command: 'testFakerValue', treeKey: TREE_KEY, objectApiName: 'Gizmo__c', fieldApiName: 'Amount__c' }]);
            expect(buttonElement.disabled).toBeTrue();
            expect(buttonElement.attributes['aria-busy']).toBe('true');

        });

        test('draws the answer as text under the expression, replaces it on the next answer, and frees the button', () => {

            const panel = renderModel();
            const buttonElement = testButtonOf(panel, 'Amount__c');
            const answer = (exampleText?: string) => panel.postToPanel({ command: 'fakerValueExample', renderSequence: 1, treeKey: TREE_KEY, objectApiName: 'Gizmo__c', fieldApiName: 'Amount__c', ...( exampleText !== undefined ? { exampleText } : {} ) });

            buttonElement.dispatch('click');
            answer('<b>48213.07</b>');

            expect(exampleOf(panel, 'Amount__c').textContent).toBe(`${RECIPE_COCKPIT_FAKER_VALUE_EXAMPLE_PREFIX}<b>48213.07</b>`);
            expect(exampleOf(panel, 'Amount__c').children).toEqual([]);
            expect(panel.isHidden(exampleOf(panel, 'Amount__c'))).toBeFalse();
            expect(buttonElement.disabled).toBeFalse();

            buttonElement.dispatch('click');
            answer('17.00');
            expect(exampleOf(panel, 'Amount__c').textContent).toBe(`${RECIPE_COCKPIT_FAKER_VALUE_EXAMPLE_PREFIX}17.00`);

            // A FAILED RUN FREES THE BUTTON AND KEEPS THE LAST EXAMPLE; THE NOTIFICATION SAYS WHY
            buttonElement.dispatch('click');
            answer();
            expect(buttonElement.disabled).toBeFalse();
            expect(exampleOf(panel, 'Amount__c').textContent).toBe(`${RECIPE_COCKPIT_FAKER_VALUE_EXAMPLE_PREFIX}17.00`);

        });

        test('ignores an answer for another model, and one for a row that did not ask', () => {

            const panel = renderModel();
            const buttonElement = testButtonOf(panel, 'Amount__c');

            buttonElement.dispatch('click');
            panel.postToPanel({ command: 'fakerValueExample', renderSequence: 2, treeKey: TREE_KEY, objectApiName: 'Gizmo__c', fieldApiName: 'Amount__c', exampleText: '1' });
            panel.postToPanel({ command: 'fakerValueExample', renderSequence: 1, treeKey: TREE_KEY, objectApiName: 'Gizmo__c', fieldApiName: 'Status__c', exampleText: 'cle' });

            expect(buttonElement.disabled).toBeTrue();
            expect(panel.isHidden(exampleOf(panel, 'Amount__c'))).toBeTrue();
            expect(panel.isHidden(exampleOf(panel, 'Status__c'))).toBeTrue();

        });

        test('hides the button and the last example while a fixed value takes the expression\'s place, and brings the button back when it is cleared', () => {

            const panel = renderModel();
            const buttonElement = testButtonOf(panel, 'Amount__c');
            buttonElement.dispatch('click');
            panel.postToPanel({ command: 'fakerValueExample', renderSequence: 1, treeKey: TREE_KEY, objectApiName: 'Gizmo__c', fieldApiName: 'Amount__c', exampleText: '17.00' });

            panel.postToPanel({ command: 'objectSelection', treeKey: TREE_KEY, renderSequence: 1, fixedValues: [{ objectApiName: 'Gizmo__c', fieldApiName: 'Amount__c', value: '5', kind: 'number' }] });
            expect(panel.isHidden(buttonElement)).toBeTrue();
            expect(panel.isHidden(exampleOf(panel, 'Amount__c'))).toBeTrue();
            expect(panel.isHidden(testButtonOf(panel, 'Status__c'))).toBeFalse();

            panel.postToPanel({ command: 'objectSelection', treeKey: TREE_KEY, renderSequence: 1 });
            expect(panel.isHidden(buttonElement)).toBeFalse();
            expect(panel.isHidden(exampleOf(panel, 'Amount__c'))).toBeTrue();

        });

        test('styles the example as the expression\'s text, with no colour of its own', () => {

            const [exampleRule] = RECIPE_COCKPIT_PANEL_STYLESHEET.match(/\.fakerValueExample\s*\{[^}]*\}/) ?? [];

            expect(exampleRule).toContain('white-space: pre-wrap');
            expect(exampleRule).not.toMatch(/color/);

        });

    });

    describe('routePanelMessage testFakerValue', () => {

        test('routes a drawn field with the expression its row shows, read from the model', () => {

            expect(route({ fieldApiName: 'Amount__c', expression: '${{ 1 }}' })).toEqual({
                kind: 'testFakerValue', treeKey: TREE_KEY, renderSequence: 4, objectApiName: 'Gizmo__c', fieldApiName: 'Amount__c', expression: CURRENCY_EXPRESSION
            });
            expect(route({ fieldApiName: 'Status__c' })).toMatchObject({ kind: 'testFakerValue', expression: PICKLIST_EXPRESSION });

        });

        test('routes the rules\' unconstrained expression while the reader has them unticked', () => {

            const panelState = buildDrawnPanelState(recipe => {
                const amountField = recipe.objects[0].fields.find(field => field.fieldApiName === 'Amount__c');
                amountField.validationRules = { appliedRuleNames: ['Min_Amount'], notAppliedRules: [], unconstrainedExpression: '${{ faker.number.int() }}' };
                recipe.trees[0].objects.forEach(treeObject => ( treeObject as any ).fields?.forEach((field: any) => { if ( field.fieldApiName === 'Amount__c' ) { field.validationRules = amountField.validationRules; } }));
                recipe.trees[0].validationRulesOff = [{ objectApiName: 'Gizmo__c', fieldApiName: 'Amount__c' }];
            });

            expect(route({ fieldApiName: 'Amount__c' }, panelState)).toMatchObject({ expression: '${{ faker.number.int() }}' });

        });

        test('runs only the first expression line of an unconstrained value that carries record type variant lines', () => {

            const unconstrainedDisplayValue = [
                '${{ faker.helpers.arrayElement([`cle`,`eastlake`]) }}',
                '### TODO: -- RecordType Options -- OneRecType -- Below is the faker recipe for the record type OneRecType for the field Status__c',
                '# ${{ faker.helpers.arrayElement([`cle`]) }}'
            ].join('\n');
            const panelState = buildDrawnPanelState(recipe => {
                const statusField = recipe.objects[0].fields.find(field => field.fieldApiName === 'Status__c');
                statusField.validationRules = { appliedRuleNames: ['Not_Madison'], notAppliedRules: [], unconstrainedExpression: unconstrainedDisplayValue };
                recipe.trees[0].validationRulesOff = [{ objectApiName: 'Gizmo__c', fieldApiName: 'Status__c' }];
            });

            expect(route({ fieldApiName: 'Status__c' }, panelState)).toMatchObject({ expression: '${{ faker.helpers.arrayElement([`cle`,`eastlake`]) }}' });

        });

        test('matches a fixed value and a rules-off entry to its occurrence exactly: one with no nickname is not an iteration\'s', () => {

            const panelState = buildDrawnPanelState(recipe => {
                const amountField = recipe.objects[0].fields.find(field => field.fieldApiName === 'Amount__c');
                amountField.validationRules = { appliedRuleNames: ['Min_Amount'], notAppliedRules: [], unconstrainedExpression: '${{ faker.number.int() }}' };
                recipe.trees[0].fixedValues = [{ objectApiName: 'Gizmo__c', fieldApiName: 'Amount__c', value: '5', kind: 'number' }];
                recipe.trees[0].validationRulesOff = [{ objectApiName: 'Gizmo__c', fieldApiName: 'Amount__c' }];
            });
            const drawnField = RecipeCockpitDrawnModel.findDrawnOccurrenceField(panelState.recipeDataMessage.recipe, TREE_KEY, 'Gizmo__c', undefined, 'Amount__c');
            jest.spyOn(RecipeCockpitDrawnModel, 'findDrawnOccurrenceField').mockReturnValue({ ...drawnField, occurrence: { ...drawnField.occurrence, nickname: 'Gizmo__c_NickName-1' } });

            expect(route({ fieldApiName: 'Amount__c', nickname: 'Gizmo__c_NickName-1' }, panelState)).toMatchObject({ kind: 'testFakerValue', nickname: 'Gizmo__c_NickName-1', expression: CURRENCY_EXPRESSION });

        });

        test.each([
            ['a lookup', { fieldApiName: 'Account__c' }],
            ['a read-only field', { fieldApiName: 'Total__c' }],
            ['a dependent picklist', { fieldApiName: 'Sub_Status__c' }],
            ['a field the model does not draw', { fieldApiName: 'Missing__c' }],
            ['a name that is not an api name', { fieldApiName: 'Amount__c; x' }],
            ['another card', { fieldApiName: 'Amount__c', treeKey: 'Other__c-ONLY' }],
            ['a nickname that is not a string', { fieldApiName: 'Amount__c', nickname: 7 }],
            ['a nickname no occurrence of the card has', { fieldApiName: 'Amount__c', nickname: 'Other_NickName' }]
        ])('refuses %s, and nothing runs', (unusedCase, payload) => {

            expect(route(payload as Record<string, unknown>)).toBeUndefined();

        });

        test('refuses a field a fixed value takes the place of', () => {

            const panelState = buildDrawnPanelState(recipe => {
                recipe.trees[0].fixedValues = [{ objectApiName: 'Gizmo__c', fieldApiName: 'Amount__c', value: '5', kind: 'number' }];
            });

            expect(route({ fieldApiName: 'Amount__c' }, panelState)).toBeUndefined();
            expect(route({ fieldApiName: 'Status__c' }, panelState)).toMatchObject({ kind: 'testFakerValue' });

        });

        test('refuses a field whose model holds no expression the writer can take out, so nothing runs', () => {

            jest.spyOn(RecipeCockpitDrawnModel, 'findRecipeExpression').mockReturnValue(undefined);

            expect(route({ fieldApiName: 'Amount__c' })).toBeUndefined();

        });

        test('refuses everything before a model is drawn', () => {

            const panelState = RecipeCockpitService.buildInitialPanelState(workspaceRoot);

            expect(route({ fieldApiName: 'Amount__c' }, panelState)).toBeUndefined();

        });

    });

    describe('the run', () => {

        const showWarningMessage = vscode.window.showWarningMessage as jest.Mock;

        const runTest = async (fieldApiName: string, expression: string, fakerService: 'faker-js' | 'snowfakery' | 'unknown' = 'faker-js') => {
            const panelState = buildDrawnPanelState();
            const cockpitPanel = {} as any;
            const postToPanel = jest.fn();
            const hub = { recipeCockpitPanel: cockpitPanel, recipeCockpitPanelState: panelState, readTreeFakerService: () => ( fakerService === 'unknown' ? undefined : fakerService ), postToPanel } as any;
            await RecipeCockpitTreecipeHost.executePanelAction(hub, cockpitPanel, { kind: 'testFakerValue', treeKey: TREE_KEY, renderSequence: 4, objectApiName: 'Gizmo__c', fieldApiName, expression });
            return postToPanel.mock.calls.map(call => call[1]);
        };

        beforeEach(() => showWarningMessage.mockReset());

        test('faker-js: a currency with scale 2 gives at most two decimal places, a date gives yyyy-MM-dd with no line break, a picklist one of its values', async () => {

            const recipeBefore = fs.readFileSync(recipeFilePath, 'utf8');
            const [currencyAnswer] = await runTest('Amount__c', CURRENCY_EXPRESSION);
            const [dateAnswer] = await runTest('Start_Date__c', DATE_EXPRESSION);
            const [picklistAnswer] = await runTest('Status__c', PICKLIST_EXPRESSION);

            expect(currencyAnswer).toEqual({ command: 'fakerValueExample', renderSequence: 4, treeKey: TREE_KEY, objectApiName: 'Gizmo__c', fieldApiName: 'Amount__c', exampleText: expect.stringMatching(/^\d{1,16}\.\d{2}$/) });
            expect(dateAnswer.exampleText).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(['cle', 'eastlake', 'madison']).toContain(picklistAnswer.exampleText);
            expect(showWarningMessage).not.toHaveBeenCalled();
            expect(fs.readFileSync(recipeFilePath, 'utf8')).toBe(recipeBefore);

        });

        test('snowfakery: the one-field recipe is run by the snowfakery processor, and its value is the example', async () => {

            let recipeRun = '';
            jest.spyOn(SnowfakeryRecipeProcessor.prototype, 'generateFakeDataBySelectedRecipeFile').mockImplementation(async (temporaryRecipePath: string) => {
                recipeRun = fs.readFileSync(temporaryRecipePath, 'utf8');
                return JSON.stringify([{ id: 1, _table: 'Gizmo__c', Amount__c: '1720344.51' }]);
            });

            const [answer] = await runTest('Amount__c', '${{fake.pydecimal(left_digits=16, right_digits=2, positive=True)}}', 'snowfakery');

            expect(recipeRun).toContain('Amount__c: "${{fake.pydecimal(left_digits=16, right_digits=2, positive=True)}}"');
            expect(recipeRun).toContain('count: 1');
            expect(answer.exampleText).toBe('1720344.51');

        });

        test.each([
            ['an expression that throws', 'faker-js', '${{ faker.nope() }}', 'Gizmo__c.Amount__c could not generate an example: faker-js could not generate the values of Gizmo__c'],
            ['a card whose backend cannot be told', 'unknown', CURRENCY_EXPRESSION, 'Gizmo__c.Amount__c could not generate an example: the card\'s recipe file could not be read']
        ])('%s: one notification says why, and the row is answered with no example', async (unusedCase, fakerService, expression, expectedNotification) => {

            const answers = await runTest('Amount__c', expression, fakerService as any);

            expect(showWarningMessage).toHaveBeenCalledTimes(1);
            expect(showWarningMessage.mock.calls[0][0]).toStartWith(expectedNotification);
            expect(answers).toEqual([{ command: 'fakerValueExample', renderSequence: 4, treeKey: TREE_KEY, objectApiName: 'Gizmo__c', fieldApiName: 'Amount__c' }]);

        });

        test('a one-field recipe the writer refuses to build: its refusal is the notification, and nothing runs', async () => {

            jest.spyOn(RecipeCockpitRecipeWriter, 'buildUpdaterValueRecipe').mockReturnValue({ isBuilt: false, refusal: 'No field of Gizmo__c has a value to generate.' });
            const generateSpy = jest.spyOn(RecipeCockpitFakerValueGeneration, 'generateObjectRecords');

            const answers = await runTest('Amount__c', CURRENCY_EXPRESSION);

            expect(showWarningMessage.mock.calls[0][0]).toBe('Gizmo__c.Amount__c could not generate an example: No field of Gizmo__c has a value to generate.');
            expect(generateSpy).not.toHaveBeenCalled();
            expect(answers).toHaveLength(1);

        });

        test('snowfakery not installed: the notification says how to fix it', async () => {

            jest.spyOn(SnowfakeryRecipeProcessor.prototype, 'generateFakeDataBySelectedRecipeFile').mockRejectedValue(new Error('The snowfakery CLI could not be started (ENOENT). Confirm snowfakery is installed and on PATH, then run the command again.'));

            await runTest('Amount__c', '${{fake.Word}}', 'snowfakery');

            expect(showWarningMessage.mock.calls[0][0]).toContain('Confirm snowfakery is installed and on PATH');

        });

        test('a click on a row redrawn while its field still runs starts nothing and frees that row, and a panel closed meanwhile is not posted to', async () => {

            let finishRun: (generatedJson: string) => void = () => undefined;
            jest.spyOn(SnowfakeryRecipeProcessor.prototype, 'generateFakeDataBySelectedRecipeFile').mockImplementation(() => new Promise(resolve => { finishRun = resolve; }));
            const generateSpy = jest.spyOn(RecipeCockpitFakerValueGeneration, 'generateObjectRecords');
            const panelState = buildDrawnPanelState();
            const cockpitPanel = {} as any;
            const postToPanel = jest.fn();
            const hub = { recipeCockpitPanel: cockpitPanel, recipeCockpitPanelState: panelState, readTreeFakerService: () => 'snowfakery', postToPanel } as any;
            const testAction = { kind: 'testFakerValue' as const, treeKey: TREE_KEY, renderSequence: 4, objectApiName: 'Gizmo__c', fieldApiName: 'Amount__c', expression: '${{fake.Word}}' };

            const firstRun = RecipeCockpitTreecipeHost.executePanelAction(hub, cockpitPanel, testAction);
            await RecipeCockpitTreecipeHost.executePanelAction(hub, cockpitPanel, { ...testAction, renderSequence: 5 });
            expect(generateSpy).toHaveBeenCalledTimes(1);
            expect(postToPanel.mock.calls.map(call => call[1])).toEqual([{ command: 'fakerValueExample', renderSequence: 5, treeKey: TREE_KEY, objectApiName: 'Gizmo__c', fieldApiName: 'Amount__c' }]);

            hub.recipeCockpitPanel = undefined;
            finishRun(JSON.stringify([{ id: 1, _table: 'Gizmo__c', Amount__c: 'x' }]));
            await firstRun;

            expect(postToPanel).toHaveBeenCalledTimes(1);

        });

    });

    describe('the shared generator', () => {

        test('removes its temporary folder whether the run succeeds or throws', async () => {

            const createdFolders: string[] = [];
            const mkdtempSync = fs.mkdtempSync;
            jest.spyOn(fs, 'mkdtempSync').mockImplementation((prefix: string) => { const folderPath = mkdtempSync(prefix); createdFolders.push(folderPath); return folderPath; });
            const processor = RecipeCockpitFakerValueGeneration.createRecipeProcessor('snowfakery');
            const generateSpy = jest.spyOn(processor, 'generateFakeDataBySelectedRecipeFile').mockResolvedValueOnce(JSON.stringify([{ id: 1, _table: 'Gizmo__c', Name: 'a' }]));

            await expect(RecipeCockpitFakerValueGeneration.generateObjectRecords(processor, 'snowfakery', 'Gizmo__c', 1, '- object: Gizmo__c\n', 'x.yml')).resolves.toMatchObject({ records: [{ Name: 'a' }] });
            generateSpy.mockRejectedValueOnce(new Error('boom'));
            await expect(RecipeCockpitFakerValueGeneration.generateObjectRecords(processor, 'snowfakery', 'Gizmo__c', 1, '- object: Gizmo__c\n', 'x.yml')).resolves.toEqual({ refusal: 'snowfakery could not generate the values of Gizmo__c: boom' });

            expect(createdFolders).toHaveLength(2);
            createdFolders.forEach(folderPath => {
                expect(folderPath.startsWith(os.tmpdir())).toBeTrue();
                expect(fs.existsSync(folderPath)).toBeFalse();
            });

        });

        test('refuses a run that generated another number of records than asked for', async () => {

            const processor = RecipeCockpitFakerValueGeneration.createRecipeProcessor('snowfakery');
            jest.spyOn(processor, 'generateFakeDataBySelectedRecipeFile').mockResolvedValue(JSON.stringify([]));

            await expect(RecipeCockpitFakerValueGeneration.generateObjectRecords(processor, 'snowfakery', 'Gizmo__c', 1, '- object: Gizmo__c\n', 'x.yml'))
                .resolves.toEqual({ refusal: 'snowfakery generated 0 Gizmo__c records for 1 asked for.' });

        });

    });

});
