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
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_TREE_OBJECT_HEADER_PADDING_REM,
    RECIPE_COCKPIT_TREE_OBJECT_INCLUDE_WIDTH_REM,
    RECIPE_COCKPIT_TREE_HEADER_GAP_REM,
    RECIPE_COCKPIT_TREE_OBJECT_TOGGLE_OFFSET_REM,
    RECIPE_COCKPIT_TREE_FIELD_BOX_PADDING_REM,
    RECIPE_COCKPIT_TREE_FIELD_ROW_INSET_REM,
    RECIPE_COCKPIT_TREE_FIELD_BOX_MARGIN_LEFT
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    #494: an expanded object's controls row and its field rows are each a bordered, padded box, and
    the checkboxes in both start under the object's ▸. The history workspace's Account tree is used:
    Account writes eight fields, three of its rows carry a TODO.
*/

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT,
    CURRENT_RUN_FOLDER_NAME
).recipeViewModel;

const shellHtml = () => RecipeCockpitService.buildWebviewShellHtml('testNonce');

// EVERY RULE WRITTEN FOR EXACTLY THIS SELECTOR, JOINED
const ruleBody = (selector: string): string => {
    const html = shellHtml();
    const bodies: string[] = [];
    let start = html.indexOf('\n    ' + selector + ' {');
    while (start > -1) {
        const open = html.indexOf('{', start);
        bodies.push(html.slice(open + 1, html.indexOf('}', open)));
        start = html.indexOf('\n    ' + selector + ' {', open);
    }
    expect(bodies.length).toBeGreaterThan(0);
    return bodies.join('\n');
};

describe('RecipeCockpitService, an object\'s fields and controls in bordered boxes (#494)', () => {

    describe('the panel script', () => {

        type Panel = ReturnType<typeof runPanelScript>;

        const drawRecipe = (): Panel => {
            const panel = runPanelScript({});
            panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 3 });
            panel.postToPanel({ command: 'loadPhase', message: '' });
            panel.expandAllTrees();
            return panel;
        };

        const objectNamed = (panel: Panel, objectApiName: string) => panel.objectElements().find((objectElement: any) => panel.objectNameOf(objectElement) === objectApiName);

        it('puts every field row of an expanded object in one fields box, after the controls row', () => {

            const panel = drawRecipe();
            const account = objectNamed(panel, 'Account');
            panel.expandObject(account);

            const bodyChildren = panel.objectBodyOf(account).children;
            const controlsIndex = bodyChildren.findIndex((childElement: any) => childElement.classList.contains('treeFieldSelectAllRow'));
            const fieldsBoxes = bodyChildren.filter((childElement: any) => childElement.classList.contains('treeFieldsBox'));

            expect(controlsIndex).toBeGreaterThan(-1);
            expect(fieldsBoxes).toHaveLength(1);
            expect(bodyChildren.indexOf(fieldsBoxes[0])).toBe(controlsIndex + 1);
            expect(fieldsBoxes[0].children.length).toBeGreaterThan(0);
            expect(fieldsBoxes[0].children.every((childElement: any) => childElement.classList.contains('treeField'))).toBeTrue();
            expect(panel.findAll(panel.objectBodyOf(account), 'treeField')).toEqual(fieldsBoxes[0].children);

        });

        it('builds neither box for an object that was never expanded', () => {

            const panel = drawRecipe();
            const account = objectNamed(panel, 'Account');

            expect(panel.findAll(panel.objectBodyOf(account), 'treeFieldsBox')).toEqual([]);
            expect(panel.findAll(panel.objectBodyOf(account), 'treeFieldSelectAllRow')).toEqual([]);

        });

    });

    describe('the stylesheet', () => {

        it('lines a field checkbox up with the object header\'s ▸', () => {

            expect(RECIPE_COCKPIT_TREE_OBJECT_TOGGLE_OFFSET_REM).toBeCloseTo(RECIPE_COCKPIT_TREE_OBJECT_HEADER_PADDING_REM + RECIPE_COCKPIT_TREE_OBJECT_INCLUDE_WIDTH_REM + RECIPE_COCKPIT_TREE_HEADER_GAP_REM, 6);

            expect(ruleBody('.treeObjectHeader')).toContain(`padding: 0.35rem ${RECIPE_COCKPIT_TREE_OBJECT_HEADER_PADDING_REM}rem;`);
            expect(ruleBody('.treeObjectHeader, .treeFieldHeader')).toContain(`gap: ${RECIPE_COCKPIT_TREE_HEADER_GAP_REM}rem;`);
            expect(ruleBody('.treeObjectInclude, .treeObjectIncludeSpacer')).toContain(`width: ${RECIPE_COCKPIT_TREE_OBJECT_INCLUDE_WIDTH_REM}rem;`);

            // MARGIN + 1px BORDER + BOX PADDING + ROW INSET LANDS ON THE ▸
            const marginMatch = /^calc\(([0-9.]+)rem - 1px\)$/.exec(RECIPE_COCKPIT_TREE_FIELD_BOX_MARGIN_LEFT);
            expect(marginMatch).not.toBeNull();
            const marginRem = Number((marginMatch as RegExpExecArray)[1]);
            expect(marginRem + RECIPE_COCKPIT_TREE_FIELD_BOX_PADDING_REM + RECIPE_COCKPIT_TREE_FIELD_ROW_INSET_REM).toBeCloseTo(RECIPE_COCKPIT_TREE_OBJECT_TOGGLE_OFFSET_REM, 6);

            const boxRule = ruleBody('.treeFieldSelectAllRow, .treeFieldsBox');
            expect(boxRule).toContain(`margin: 0.35rem ${RECIPE_COCKPIT_TREE_OBJECT_HEADER_PADDING_REM}rem 0.35rem ${RECIPE_COCKPIT_TREE_FIELD_BOX_MARGIN_LEFT};`);
            expect(boxRule).toContain('border: 1px solid var(--sdt-border);');
            expect(boxRule).toContain('box-sizing: border-box;');

            expect(ruleBody('.treeFieldsBox')).toContain(`padding: ${RECIPE_COCKPIT_TREE_FIELD_BOX_PADDING_REM}rem;`);
            expect(ruleBody('.treeField.fieldExcluded::after')).toContain('border-radius: inherit;');
            expect(ruleBody('.treeField')).toContain(`padding: 0.25rem 0.35rem 0.25rem ${RECIPE_COCKPIT_TREE_FIELD_ROW_INSET_REM}rem;`);
            expect(ruleBody('.treeFieldSelectAllRow')).toContain(`padding: ${RECIPE_COCKPIT_TREE_FIELD_BOX_PADDING_REM + RECIPE_COCKPIT_TREE_FIELD_ROW_INSET_REM}rem;`);

        });

        it('pads both boxes on every side and draws no box with nothing visible in it', () => {

            expect(RECIPE_COCKPIT_TREE_FIELD_BOX_PADDING_REM).toBeGreaterThan(0);
            expect(RECIPE_COCKPIT_TREE_FIELD_ROW_INSET_REM).toBeGreaterThan(0);
            expect(shellHtml()).toContain('.treeFieldSelectAllRow:not(:has(> :not(.hidden))), .treeFieldsBox:not(:has(> .treeField:not(.hidden))) { display: none; }');

        });

    });

});
