import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn(), showQuickPick: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import { RecipeCockpitService } from '../RecipeCockpitService';
import {
    RECIPE_COCKPIT_DERIVED_FIELD_BADGE_LABEL,
    RECIPE_COCKPIT_READ_ONLY_FORMULA_CLAMP_LENGTH,
    RECIPE_COCKPIT_READ_ONLY_FORMULA_HIDE_LABEL,
    RECIPE_COCKPIT_READ_ONLY_FORMULA_MAXIMUM_LENGTH,
    RECIPE_COCKPIT_READ_ONLY_FORMULA_SHOW_LABEL,
    RECIPE_COCKPIT_READ_ONLY_REASON_PREFIX
} from '../RecipeCockpitFieldRowsConstants';
import { RecipeCockpitModelBuild } from '../RecipeCockpitModelBuild';
import { RecipeCockpitTreeSelectionStore } from '../RecipeCockpitTreeSelectionStore';
import { RECIPE_COCKPIT_PANEL_STYLESHEET } from '../RecipeCockpitPanelStylesheet.generated';
import { IRecipeCockpitRecipeViewModel } from '../RecipeCockpitViewModel';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    #685: a field Salesforce calculates or sets itself is written "READ ONLY -- <reason>". Its row on
    the Treecipe tab says read only and why, a formula field shows its formula, and its pencil is
    locked in the panel and in the host that checks it before writing.
*/

const RUN_FOLDER_NAME = 'recipe-2026-11-21T00-00-00';
const TREE_KEY = 'RelationshipTree_1';
const TOTAL_FORMULA = 'Price__c * Quantity__c';

const GIZMO_RECIPE = [
    '- object: Gizmo__c',
    '  nickname: Gizmo__c_NickName',
    '  count: 1',
    '  fields:',
    '    Total__c: READ ONLY -- formula',
    '    Line_Count__c: READ ONLY -- roll-up summary',
    '    Gizmo_Number__c: READ ONLY -- auto number',
    '    Status_Code__c: READ ONLY -- set by Salesforce',
    '    Notes__c: ${{ faker.lorem.text(40).substring(0, 40) }}',
    ''
].join('\n');

describe('RecipeCockpitService, a field Salesforce calculates or sets itself (#685)', () => {

    let workspaceRoot: string;

    const writeWorkspace = (formula: unknown) => {

        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-read-only-'));
        const runFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', RUN_FOLDER_NAME);
        fs.mkdirSync(path.join(runFolderPath, TREE_KEY), { recursive: true });

        const wrapperField = (fieldName: string, type: string, recipeValue: string, extra: Record<string, unknown> = {}) => ({ objectName: 'Gizmo__c', fieldName, fieldLabel: fieldName, type, recipeValue, ...extra });
        fs.writeFileSync(path.join(runFolderPath, 'treecipeObjectsWrapper-2026-11-21T00-00-00.json'), JSON.stringify({
            ObjectToObjectInfoMap: {
                Gizmo__c: {
                    Fields: [
                        wrapperField('Total__c', 'Currency', 'READ ONLY -- formula', { readOnlyReason: 'formula', formula }),
                        wrapperField('Line_Count__c', 'Summary', 'READ ONLY -- roll-up summary', { readOnlyReason: 'roll-up summary' }),
                        wrapperField('Gizmo_Number__c', 'AutoNumber', 'READ ONLY -- auto number', { readOnlyReason: 'auto number' }),
                        wrapperField('Status_Code__c', 'AUTO_GENERATED', 'READ ONLY -- set by Salesforce', { readOnlyReason: 'set by Salesforce' }),
                        wrapperField('Notes__c', 'Text', '${{ faker.lorem.text(40).substring(0, 40) }}', { length: 40 })
                    ],
                    RelationshipDetail: { level: 0, parentObjectToFieldReferences: {} }
                }
            },
            RecipeFiles: [{ objects: ['Gizmo__c'] }]
        }));
        fs.writeFileSync(path.join(runFolderPath, TREE_KEY, `recipe--${TREE_KEY}-2026-11-21T00-00-00.yml`), GIZMO_RECIPE);

    };

    afterEach(() => {
        if ( workspaceRoot ) { fs.rmSync(workspaceRoot, { recursive: true, force: true }); }
    });

    const loadModel = (): IRecipeCockpitRecipeViewModel => RecipeCockpitModelBuild.buildRecipeViewModel(workspaceRoot);

    const renderModel = (recipeViewModel: IRecipeCockpitRecipeViewModel) => {
        const panel = runPanelScript();
        panel.postToPanel({ command: 'recipeData', recipe: recipeViewModel, renderSequence: 1 });
        panel.expandAllTrees();
        panel.objectElements().forEach((objectElement: any) => panel.expandObject(objectElement));
        return panel;
    };

    const gizmoRow = (panel: any, fieldApiName: string) => panel.fieldRowNamed(panel.objectElements()[0], fieldApiName);
    const textsOf = (panel: any, rowElement: any, className: string) => panel.findAll(rowElement, className).map((element: any) => element.textContent);

    test.each([
        ['Total__c', `formula: ${TOTAL_FORMULA}`],
        ['Line_Count__c', 'roll-up summary'],
        ['Gizmo_Number__c', 'auto number'],
        ['Status_Code__c', 'set by Salesforce']
    ])('%s is marked read only, and says "%s"', (fieldApiName, expectedNote) => {

        writeWorkspace(TOTAL_FORMULA);
        const panel = renderModel(loadModel());
        const rowElement = gizmoRow(panel, fieldApiName);

        expect(textsOf(panel, rowElement, 'derivedFieldBadge')).toEqual([RECIPE_COCKPIT_DERIVED_FIELD_BADGE_LABEL]);
        expect(textsOf(panel, rowElement, 'readOnlyFieldNote')).toEqual([expectedNote]);

    });

    test.each([
        ['Total__c', 'formula'],
        ['Line_Count__c', 'roll-up summary'],
        ['Gizmo_Number__c', 'auto number'],
        ['Status_Code__c', 'set by Salesforce']
    ])('%s\'s pencil is locked as "read only: %s" in the panel and in the host', (fieldApiName, reason) => {

        writeWorkspace(TOTAL_FORMULA);
        const recipeViewModel = loadModel();
        const panel = renderModel(recipeViewModel);
        const [pinElement] = panel.findAll(gizmoRow(panel, fieldApiName), 'treeFieldFixedValue');
        const tree = recipeViewModel.trees[0];
        const gizmoObject = tree.objects.find(treeObject => treeObject.objectApiName === 'Gizmo__c');
        const fieldViewModel = recipeViewModel.objects.find(object => object.objectApiName === 'Gizmo__c').fields.find(field => field.fieldApiName === fieldApiName);

        expect(pinElement.disabled).toBeTrue();
        expect(pinElement.attributes.title).toBe(`Cannot be edited: ${RECIPE_COCKPIT_READ_ONLY_REASON_PREFIX}${reason}`);
        expect(RecipeCockpitTreeSelectionStore.findFixedValueLockReason(tree, gizmoObject as any, fieldViewModel)).toBe(`${RECIPE_COCKPIT_READ_ONLY_REASON_PREFIX}${reason}`);

    });

    test('an ordinary field is neither marked nor locked', () => {

        writeWorkspace(TOTAL_FORMULA);
        const panel = renderModel(loadModel());
        const notesRow = gizmoRow(panel, 'Notes__c');

        expect(panel.findAll(notesRow, 'derivedFieldBadge')).toEqual([]);
        expect(panel.findAll(notesRow, 'treeFieldFixedValue')[0].disabled).toBeFalse();

    });

    test.each([
        ['not a string', 42],
        ['longer than Salesforce allows a formula', 'x'.repeat(RECIPE_COCKPIT_READ_ONLY_FORMULA_MAXIMUM_LENGTH + 1)]
    ])('a formula from the wrapper that is %s is not posted, and the row says only "formula"', (unusedCase, formula) => {

        writeWorkspace(formula);
        const recipeViewModel = loadModel();
        const totalViewModel = recipeViewModel.objects[0].fields.find(field => field.fieldApiName === 'Total__c');
        const panel = renderModel(recipeViewModel);

        expect(totalViewModel).not.toHaveProperty('formula');
        expect(textsOf(panel, gizmoRow(panel, 'Total__c'), 'readOnlyFieldNote')).toEqual(['formula']);

    });

    describe('a long formula is clamped to two lines, with the whole formula one click away (#706)', () => {

        const LONG_FORMULA = 'IF(ISBLANK(Price__c), 0, ' + 'Price__c * Quantity__c + '.repeat(120) + '0)';
        const showFormulaButtonOf = (panel: any) => panel.findAll(gizmoRow(panel, 'Total__c'), 'readOnlyFormulaToggle')[0];
        const formulaNoteOf = (panel: any) => panel.findAll(gizmoRow(panel, 'Total__c'), 'readOnlyFieldNote')[0];

        test('a 3,000-character formula is clamped, and its whole text is still in the note', () => {

            expect(LONG_FORMULA.length).toBeGreaterThan(3000);
            writeWorkspace(LONG_FORMULA);
            const panel = renderModel(loadModel());
            const noteElement = formulaNoteOf(panel);

            expect(noteElement.classList.contains('readOnlyFormulaClamped')).toBeTrue();
            expect(noteElement.textContent).toBe(`formula: ${LONG_FORMULA}`);

        });

        test('"Show formula" is a link button that expands the note in place, and "Hide formula" clamps it again', () => {

            writeWorkspace(LONG_FORMULA);
            const panel = renderModel(loadModel());
            const showFormulaButton = showFormulaButtonOf(panel);
            const noteElement = formulaNoteOf(panel);

            // A <button> IS FOCUSABLE AND ANSWERS ENTER AND SPACE WITH A CLICK, SO A CLICK IS WHAT THE KEYBOARD SENDS TOO
            expect(showFormulaButton.tagName).toBe('button');
            expect(showFormulaButton.classList.contains('sdtButton-link')).toBeTrue();
            expect(showFormulaButton.textContent).toBe(RECIPE_COCKPIT_READ_ONLY_FORMULA_SHOW_LABEL);
            expect(showFormulaButton.attributes['aria-expanded']).toBe('false');
            expect(showFormulaButton.attributes['aria-label']).toBe(`${RECIPE_COCKPIT_READ_ONLY_FORMULA_SHOW_LABEL} of Total__c`);

            showFormulaButton.dispatch('click');
            expect(noteElement.classList.contains('readOnlyFormulaClamped')).toBeFalse();
            expect(showFormulaButton.textContent).toBe(RECIPE_COCKPIT_READ_ONLY_FORMULA_HIDE_LABEL);
            expect(showFormulaButton.attributes['aria-expanded']).toBe('true');
            expect(showFormulaButton.attributes['aria-label']).toBe(`${RECIPE_COCKPIT_READ_ONLY_FORMULA_HIDE_LABEL} of Total__c`);

            showFormulaButton.dispatch('click');
            expect(noteElement.classList.contains('readOnlyFormulaClamped')).toBeTrue();
            expect(showFormulaButton.textContent).toBe(RECIPE_COCKPIT_READ_ONLY_FORMULA_SHOW_LABEL);
            expect(showFormulaButton.attributes['aria-expanded']).toBe('false');

        });

        test.each([
            ['a short formula', TOTAL_FORMULA],
            ['a formula exactly as long as the clamp allows', 'x'.repeat(RECIPE_COCKPIT_READ_ONLY_FORMULA_CLAMP_LENGTH)]
        ])('%s looks as it did before: no clamp and no button', (unusedCase, formula) => {

            writeWorkspace(formula);
            const panel = renderModel(loadModel());
            const noteElement = formulaNoteOf(panel);

            expect(noteElement.className).toBe('treeFieldNote readOnlyFieldNote muted');
            expect(noteElement.textContent).toBe(`formula: ${formula}`);
            expect(showFormulaButtonOf(panel)).toBeUndefined();

        });

        test('a read-only row that is not a formula has no clamp and no button', () => {

            writeWorkspace(LONG_FORMULA);
            const panel = renderModel(loadModel());

            ['Line_Count__c', 'Gizmo_Number__c', 'Status_Code__c'].forEach(fieldApiName => {
                expect(panel.findAll(gizmoRow(panel, fieldApiName), 'readOnlyFormulaClamped')).toEqual([]);
                expect(panel.findAll(gizmoRow(panel, fieldApiName), 'readOnlyFormulaToggle')).toEqual([]);
            });

        });

        test('the clamp is a stylesheet rule of two lines that sets no colour', () => {

            const [clampRule] = RECIPE_COCKPIT_PANEL_STYLESHEET.match(/\.readOnlyFormulaClamped\s*\{[^}]*\}/) ?? [];

            expect(clampRule).toContain('-webkit-line-clamp: 2');
            expect(clampRule).toContain('overflow: hidden');
            expect(clampRule).not.toMatch(/color/);

        });

    });

});
