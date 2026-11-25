import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as path from 'path';

jest.mock('vscode', () => ({
    workspace: { workspaceFolders: undefined, getConfiguration: jest.fn().mockReturnValue({ get: jest.fn(), update: jest.fn(), inspect: jest.fn() }), fs: { readDirectory: jest.fn(), readFile: jest.fn() } },
    window: {},
    commands: { registerCommand: jest.fn(), executeCommand: jest.fn() },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RECIPE_COCKPIT_UPDATER_CUT_CELL_PLACEHOLDER,
    RECIPE_COCKPIT_UPDATER_EDIT_HEADING,
    RECIPE_COCKPIT_UPDATER_NO_CELL_CHANGED_REASON,
    RECIPE_COCKPIT_UPDATER_NO_ROW_MARKED_REASON,
    RECIPE_COCKPIT_UPDATER_NO_ROWS_MARKED
} from '../RecipeCockpitAdapterConstants';
import { RECIPE_COCKPIT_UPDATER_TAB_LABEL } from '../RecipeCockpitShellConstants';
import { RecipeCockpitModelBuild } from '../RecipeCockpitModelBuild';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    "Edit existing records" (#721), the panel half: the table an object's loaded records are drawn
    as. The host half -- what an edit does to the records it holds -- is RecipeCockpitAdapterEdits.test.ts.
*/

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LOOKUP_LOCK_REASON = 'it is a lookup: its value is a record Id';

const loadTreeRecipe = () => {
    const recipeRuns = RecipeCockpitModelBuild.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
    return RecipeCockpitModelBuild.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, 'recipe-2026-09-20T10-00-00').recipeViewModel;
};

const NO_EDITS = { markedRowIndexes: [], changedCells: [], editSummary: { markedRecordCount: 0, updatableRecordCount: 0, changedFieldApiNames: [], hasUnmarkedChanges: false } };

// Id, A FIELD WITH AN EXPRESSION, ONE WITH NONE, AND A LOOKUP
const accountRecords = (edits: Record<string, unknown> = NO_EDITS) => ({
    objectApiName: 'Account', totalSize: 2, recordCount: 2, isTruncated: false, hiddenColumnCount: 0,
    columns: ['Id', 'Name', 'Hologram__c', 'ParentId'],
    columnEdits: [{ lockReason: 'Salesforce sets it', canGenerate: false }, { canGenerate: true }, { canGenerate: false }, { lockReason: LOOKUP_LOCK_REASON, canGenerate: false }],
    rows: [['001A', '<b>Acme</b>', '', '001Z'], ['001B', 'Globex', '', '']],
    ...edits
});

const openLoadedTable = (edits?: Record<string, unknown>) => {
    const panel = runPanelScript();
    panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 });
    panel.postToPanel({ command: 'rendered' });
    panel.expandAllTrees();
    const accountCard = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes('OtherChildObject__c')));
    panel.openAdapterStructure(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
    const updaterPanel = panel.findAll(accountCard, 'treeUpdater')[0];
    panel.postToPanel({ command: 'updaterRecords', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, orgLabel: 'qa', objects: [accountRecords(edits)] });
    const accountObject = panel.findAll(updaterPanel, 'updaterObject').find((objectElement: any) => panel.findAll(objectElement, 'updaterObjectName')[0].textContent === 'Account');
    return { panel, updaterPanel, accountObject };
};

const postPage = (panel: any, edits: Record<string, unknown>, rows: unknown[][] = accountRecords().rows) =>
    panel.postToPanel({ command: 'updaterRecordsPage', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', pageIndex: 0, rows: rows, ...edits });

const editsPosted = (panel: any) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'editUpdaterRecords');
const labelsOf = (panel: any, containerElement: any, className: string) => panel.findAll(containerElement, className).map((element: any) => element.attributes['aria-label']);
const tableRows = (panel: any, accountObject: any) => panel.findAll(accountObject, 'treeQueryRow');
const ONE_MARKED = { markedRowIndexes: [0], changedCells: [], editSummary: { markedRecordCount: 1, updatableRecordCount: 0, changedFieldApiNames: [], hasUnmarkedChanges: false } };
const ONE_CHANGED = { markedRowIndexes: [0], changedCells: [[0, 1]], editSummary: { markedRecordCount: 1, updatableRecordCount: 1, changedFieldApiNames: ['Name'], hasUnmarkedChanges: false } };

describe('the Treecipe Adapter\'s record table to edit, in the panel (#721)', () => {

    it('opens the object a load read records of, and draws them under the heading with a ✎ per row and nothing marked', () => {

        const { panel, updaterPanel, accountObject } = openLoadedTable();

        expect(panel.isHidden(panel.findAll(accountObject, 'updaterObjectBody')[0])).toBe(false);
        expect(panel.findAll(accountObject, 'updaterRecordEditHeading')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_EDIT_HEADING);
        expect(panel.findAll(accountObject, 'updaterRecordEditSummary')[0].textContent).toBe('No row marked. Mark the rows to change with ✎.');
        expect(labelsOf(panel, accountObject, 'updaterRowMark')).toEqual(['Mark to update Account 001A', 'Mark to update Account 001B']);
        expect(panel.findAll(accountObject, 'updaterRowMark').map((markButton: any) => markButton.attributes['aria-pressed'])).toEqual(['false', 'false']);
        expect(panel.findAll(accountObject, 'updaterMarkedRow')).toEqual([]);
        // A VALUE FROM THE ORG IS TEXT, NEVER MARKUP
        expect(panel.findAll(accountObject, 'b')).toEqual([]);
        // NO ROW MARKED: NO CELL OFFERS 🎲, AND THE COLUMN'S WAITS
        expect(panel.findAll(accountObject, 'updaterCellGenerate')).toEqual([]);
        expect(panel.findAll(accountObject, 'updaterColumnGenerate').map((generateButton: any) => generateButton.disabled)).toEqual([true]);
        expect(panel.findAll(accountObject, 'updaterResetAll')[0].disabled).toBe(true);
        expect(panel.findAll(updaterPanel, 'updaterSummary')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_NO_ROWS_MARKED);
        expect(panel.findAll(updaterPanel, 'updaterUpdate')[0].attributes.title).toBe(RECIPE_COCKPIT_UPDATER_NO_ROW_MARKED_REASON);

    });

    it('heads a locked column with its reason and no button, a column with no expression with ↺ only, and one with an expression with 🎲 and ↺', () => {

        const { panel, accountObject } = openLoadedTable();

        expect(labelsOf(panel, accountObject, 'updaterColumnLock')).toEqual(['Id cannot be changed: Salesforce sets it', `ParentId cannot be changed: ${LOOKUP_LOCK_REASON}`]);
        expect(labelsOf(panel, accountObject, 'updaterColumnGenerate')).toEqual(['Generate Name for every marked Account row']);
        expect(labelsOf(panel, accountObject, 'updaterColumnReset')).toEqual(['Put back the loaded Name of every Account row', 'Put back the loaded Hologram__c of every Account row']);

    });

    it('posts a mark, a 🎲 and a ↺ as the object, the page and a position, never a value or an Id', () => {

        const { panel, accountObject } = openLoadedTable();
        const position = { command: 'editUpdaterRecords', treeKey: ACCOUNT_TREE_KEY, renderSequence: 1, objectApiName: 'Account', pageIndex: 0 };

        panel.findAll(accountObject, 'updaterRowMark')[1].dispatch('click');
        expect(editsPosted(panel)).toEqual([{ ...position, editKind: 'markRow', rowIndex: 1 }]);

        postPage(panel, ONE_CHANGED);
        expect(labelsOf(panel, accountObject, 'updaterRowMark')[0]).toBe('Marked to update — click to leave Account 001A');
        panel.findAll(accountObject, 'updaterRowMark')[0].dispatch('click');
        panel.findAll(accountObject, 'updaterCellGenerate')[0].dispatch('click');
        panel.findAll(accountObject, 'updaterCellReset')[0].dispatch('click');
        panel.findAll(accountObject, 'updaterColumnGenerate')[0].dispatch('click');
        panel.findAll(accountObject, 'updaterColumnReset')[0].dispatch('click');
        panel.findAll(accountObject, 'updaterResetAll')[0].dispatch('click');

        expect(editsPosted(panel).slice(1)).toEqual([
            { ...position, editKind: 'unmarkRow', rowIndex: 0 },
            { ...position, editKind: 'generateCell', rowIndex: 0, columnIndex: 1 },
            { ...position, editKind: 'resetCell', rowIndex: 0, columnIndex: 1 },
            { ...position, editKind: 'generateColumn', columnIndex: 1 },
            { ...position, editKind: 'resetColumn', columnIndex: 1 },
            { ...position, editKind: 'resetObject' }
        ]);

    });

    it('draws the host\'s answer: the marked row, 🎲 on its changeable cells only, the changed cell highlighted with ↺, and the counts on the section and the card', () => {

        const { panel, updaterPanel, accountObject } = openLoadedTable();

        postPage(panel, ONE_MARKED);
        expect(tableRows(panel, accountObject).map((rowElement: any) => rowElement.className.includes('updaterMarkedRow'))).toEqual([true, false]);
        expect(labelsOf(panel, accountObject, 'updaterCellGenerate')).toEqual(['Generate a value for Name of Account 001A']);
        expect(panel.findAll(accountObject, 'updaterRecordEditSummary')[0].textContent).toBe('1 row marked, none changed yet. Change a cell with 🎲.');
        expect(panel.findAll(updaterPanel, 'updaterUpdate')[0].attributes.title).toBe(RECIPE_COCKPIT_UPDATER_NO_CELL_CHANGED_REASON);

        postPage(panel, ONE_CHANGED, [['001A', 'Initech', '', '001Z'], ['001B', 'Globex', '', '']]);
        const changedCells = panel.findAll(accountObject, 'updaterChangedCell');
        expect(changedCells.map((cellElement: any) => panel.findAll(cellElement, 'updaterCellValue')[0].textContent)).toEqual(['Initech']);
        expect(labelsOf(panel, accountObject, 'updaterCellReset')).toEqual(['Put back the loaded Name of Account 001A']);
        expect(panel.findAll(accountObject, 'updaterRecordEditSummary')[0].textContent).toBe('1 row marked · 1 record to update: Name');
        expect(panel.findAll(updaterPanel, 'updaterSummary')[0].textContent).toBe('1 row marked · 1 record to update');
        expect(panel.cardTitleOf(panel.findAll(updaterPanel, 'updaterUpdate')[0])).toBe('Update 1 record in qa');
        expect(panel.findAll(accountObject, 'updaterResetAll')[0].disabled).toBe(false);

    });

    it('says the changes on rows that are not marked are not written', () => {

        const { panel, accountObject } = openLoadedTable({ markedRowIndexes: [], changedCells: [[1, 1]], editSummary: { markedRecordCount: 0, updatableRecordCount: 0, changedFieldApiNames: [], hasUnmarkedChanges: true } });

        expect(panel.findAll(accountObject, 'updaterRecordEditSummary')[0].textContent).toBe('No row marked. Mark the rows to change with ✎. The changes on rows that are not marked are not written.');
        // THE CHANGE CAN STILL BE PUT BACK, THOUGH ITS ROW OFFERS NO 🎲
        expect(labelsOf(panel, accountObject, 'updaterCellReset')).toEqual(['Put back the loaded Name of Account 001B']);
        expect(panel.findAll(accountObject, 'updaterCellGenerate')).toEqual([]);
        expect(panel.findAll(accountObject, 'updaterResetAll')[0].disabled).toBe(false);

    });

    it('holds every edit button while a run holds the records, and posts nothing', () => {

        const { panel, accountObject } = openLoadedTable(ONE_CHANGED);
        const editButtons = () => ['updaterRowMark', 'updaterCellType', 'updaterCellGenerate', 'updaterCellReset', 'updaterColumnGenerate', 'updaterColumnReset', 'updaterResetAll']
            .flatMap(className => panel.findAll(accountObject, className));

        panel.postToPanel({ command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' });
        expect(editButtons().every((editButton: any) => editButton.disabled)).toBe(true);
        panel.findAll(accountObject, 'updaterRowMark')[0].dispatch('click');
        expect(editsPosted(panel)).toEqual([]);

        panel.postToPanel({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });
        expect(editButtons().filter((editButton: any) => editButton.disabled).map((editButton: any) => editButton.attributes['aria-label'])).toEqual(['Put back the loaded Hologram__c of every Account row']);

    });

    it('keeps the keyboard\'s place on the button pressed when the answer redraws the table, and on the cell\'s 🎲 when ↺ took its own button away', () => {

        const { panel, accountObject } = openLoadedTable(ONE_CHANGED);

        panel.findAll(accountObject, 'updaterRowMark')[1].dispatch('click');
        postPage(panel, { ...ONE_CHANGED, markedRowIndexes: [0, 1], editSummary: { ...ONE_CHANGED.editSummary, markedRecordCount: 2 } });
        expect(panel.activeElement()).toBe(panel.findAll(accountObject, 'updaterRowMark')[1]);

        panel.findAll(accountObject, 'updaterCellReset')[0].dispatch('click');
        postPage(panel, ONE_MARKED);
        expect(panel.activeElement()).toBe(panel.findAll(accountObject, 'updaterCellGenerate')[0]);

    });

    it('moves to the first button that can be pressed when Reset all leaves itself nothing to do', () => {

        const { panel, accountObject } = openLoadedTable(ONE_CHANGED);

        panel.findAll(accountObject, 'updaterResetAll')[0].dispatch('click');
        postPage(panel, ONE_MARKED);

        expect(panel.findAll(accountObject, 'updaterResetAll')[0].disabled).toBe(true);
        expect(panel.activeElement()).toBe(panel.findAll(accountObject, 'updaterColumnGenerate')[0]);

    });

    it('holds the pager while a run holds the records, so a page turned meanwhile is not pulled back by the run\'s answer', () => {

        const { panel, accountObject } = openLoadedTable({ ...ONE_MARKED, pageCount: 3 });
        const pagerButtons = () => [panel.findAll(accountObject, 'updaterRecordsPrevious')[0], panel.findAll(accountObject, 'updaterRecordsNext')[0]];
        expect(pagerButtons().map((pagerButton: any) => pagerButton.disabled)).toEqual([true, false]);

        panel.postToPanel({ command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'generate' });
        expect(pagerButtons().map((pagerButton: any) => pagerButton.disabled)).toEqual([true, true]);

        panel.postToPanel({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });
        expect(pagerButtons().map((pagerButton: any) => pagerButton.disabled)).toEqual([true, false]);

    });

    describe('⌨, a value typed into a cell (part 2)', () => {

        const position = { command: 'editUpdaterRecords', treeKey: ACCOUNT_TREE_KEY, renderSequence: 1, objectApiName: 'Account', pageIndex: 0 };
        const openEditor = (panel: any, accountObject: any, typeIndex: number) => {
            panel.findAll(accountObject, 'updaterCellType')[typeIndex].dispatch('click');
            const editorElement = panel.findAll(accountObject, 'updaterCellEditor')[0];
            return { editorElement, inputElement: panel.findAll(editorElement, 'fieldEditorInput')[0] };
        };

        it('offers ⌨ in every cell of a marked row that can be changed, with or without a 🎲, and in no other', () => {

            const { panel, accountObject } = openLoadedTable(ONE_MARKED);

            expect(labelsOf(panel, accountObject, 'updaterCellType')).toEqual(['Type a value for Name of Account 001A', 'Type a value for Hologram__c of Account 001A']);

        });

        it('opens an input in the cell on the value it holds, and posts the value typed with the cell\'s position on Save', () => {

            const { panel, accountObject } = openLoadedTable(ONE_MARKED);
            const { editorElement, inputElement } = openEditor(panel, accountObject, 0);

            expect(editorElement.attributes['aria-label']).toBe('New value for Name of Account 001A');
            expect(inputElement.value).toBe('<b>Acme</b>');
            expect(inputElement.attributes['aria-label']).toBe('New value for Name of Account 001A');
            expect(panel.activeElement()).toBe(inputElement);

            inputElement.value = 'Initech';
            panel.findAll(editorElement, 'updaterCellSave')[0].dispatch('click');

            expect(editsPosted(panel)).toEqual([{ ...position, editKind: 'typeCell', rowIndex: 0, columnIndex: 1, value: 'Initech' }]);
            expect(panel.findAll(accountObject, 'updaterCellEditor')).toEqual([]);

            // THE ANSWER REDRAWS THE TABLE, AND THE KEYBOARD'S PLACE IS THE ⌨ PRESSED
            postPage(panel, ONE_CHANGED, [['001A', 'Initech', '', '001Z'], ['001B', 'Globex', '', '']]);
            expect(panel.activeElement()).toBe(panel.findAll(accountObject, 'updaterCellType')[0]);

        });

        it('starts empty, saying what saving does, in a cell the host says shows only part of its value', () => {

            const { panel, accountObject } = openLoadedTable({ ...ONE_MARKED, cutCells: [[0, 1]] });
            const { editorElement, inputElement } = openEditor(panel, accountObject, 0);

            expect(inputElement.value).toBe('');
            expect(inputElement.attributes.placeholder).toBe(RECIPE_COCKPIT_UPDATER_CUT_CELL_PLACEHOLDER);
            // SAVED UNTOUCHED, IT POSTS NOTHING: THE RECORD'S WHOLE VALUE IS NEVER REPLACED BY THE PART ON SCREEN
            panel.findAll(editorElement, 'updaterCellSave')[0].dispatch('click');
            expect(editsPosted(panel)).toEqual([]);

        });

        it('keeps the editor and its text when Save is pressed while a run holds the records', () => {

            const { panel, accountObject } = openLoadedTable(ONE_MARKED);
            const { editorElement, inputElement } = openEditor(panel, accountObject, 0);
            inputElement.value = 'Initech';

            panel.postToPanel({ command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'update' });
            panel.findAll(editorElement, 'updaterCellSave')[0].dispatch('click');

            expect(editsPosted(panel)).toEqual([]);
            expect(panel.findAll(accountObject, 'updaterCellEditor')).toHaveLength(1);
            expect(inputElement.value).toBe('Initech');

        });

        it('saves on Enter, and posts nothing on Escape, Cancel, an empty input or the value the cell already holds', () => {

            const { panel, accountObject } = openLoadedTable(ONE_MARKED);

            let editor = openEditor(panel, accountObject, 1);
            editor.inputElement.value = 'Shimmer';
            editor.inputElement.dispatch('keydown', { key: 'Enter', preventDefault: () => undefined });
            expect(editsPosted(panel)).toEqual([{ ...position, editKind: 'typeCell', rowIndex: 0, columnIndex: 2, value: 'Shimmer' }]);

            editor = openEditor(panel, accountObject, 0);
            editor.inputElement.value = 'Initech';
            editor.inputElement.dispatch('keydown', { key: 'Escape', preventDefault: () => undefined });
            expect(panel.findAll(accountObject, 'updaterCellEditor')).toEqual([]);
            expect(panel.activeElement()).toBe(panel.findAll(accountObject, 'updaterCellType')[0]);

            editor = openEditor(panel, accountObject, 0);
            panel.findAll(editor.editorElement, 'updaterCellCancel')[0].dispatch('click');

            editor = openEditor(panel, accountObject, 0);
            editor.inputElement.value = '';
            panel.findAll(editor.editorElement, 'updaterCellSave')[0].dispatch('click');

            editor = openEditor(panel, accountObject, 0);
            panel.findAll(editor.editorElement, 'updaterCellSave')[0].dispatch('click');

            expect(editsPosted(panel)).toHaveLength(1);
            // THE CELL IS AS IT WAS: ITS VALUE AND BUTTONS ARE SHOWN AGAIN
            expect(panel.findAll(accountObject, 'updaterCellValue').every((valueElement: any) => !panel.isHidden(valueElement))).toBe(true);

        });

    });

    it('draws a table whose message says nothing of a column as text only, with no button to change it', () => {

        const { panel, accountObject } = openLoadedTable({ ...ONE_MARKED, columnEdits: 'not a list' });

        expect(panel.findAll(accountObject, 'updaterCellGenerate')).toEqual([]);
        expect(panel.findAll(accountObject, 'updaterColumnGenerate')).toEqual([]);
        expect(panel.findAll(accountObject, 'updaterColumnReset')).toEqual([]);
        expect(panel.findAll(accountObject, 'updaterColumnLock')).toEqual([]);

    });

});
