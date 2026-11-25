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
    RECIPE_COCKPIT_UPDATER_EDIT_HEADING,
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_GENERATE_LABEL,
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_GENERATING_LABEL,
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NOT_LOADED_REASON,
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NOT_READ_REASON,
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NO_PARENTS_REASON,
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_TAB_LABEL,
    RECIPE_COCKPIT_UPDATER_NEW_RECORDS_UNREAD_FIELD_REASON
} from '../RecipeCockpitAdapterConstants';
import { RECIPE_COCKPIT_UPDATER_TAB_LABEL } from '../RecipeCockpitShellConstants';
import { RecipeCockpitModelBuild } from '../RecipeCockpitModelBuild';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    "Generate new records" (#722), the panel half: the two tabs of an object below the chosen
    parent and what the second one posts and draws. The host half -- what a request generates and
    holds -- is RecipeCockpitAdapterNewRecords.test.ts.
*/

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const NO_EDITS = { columnEdits: [], markedRowIndexes: [], changedCells: [], cutCells: [], editSummary: { markedRecordCount: 0, updatableRecordCount: 0, changedFieldApiNames: [], hasUnmarkedChanges: false } };

const loadTreeRecipe = () => {
    const recipeRuns = RecipeCockpitModelBuild.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
    return RecipeCockpitModelBuild.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, 'recipe-2026-09-20T10-00-00').recipeViewModel;
};

const openAdapter = () => {
    const panel = runPanelScript();
    panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 });
    panel.postToPanel({ command: 'rendered' });
    panel.expandAllTrees();
    const accountCard = panel.treeCards().find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes('OtherChildObject__c')));
    panel.openAdapterStructure(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
    const updaterPanel = panel.findAll(accountCard, 'treeUpdater')[0];
    const objectNamed = (objectApiName: string) => panel.findAll(updaterPanel, 'updaterObject').find((objectElement: any) => panel.findAll(objectElement, 'updaterObjectName')[0].textContent === objectApiName);
    const open = (objectApiName: string) => { panel.findAll(objectNamed(objectApiName).children[0], 'updaterObjectToggle')[0].dispatch('click'); return objectNamed(objectApiName); };
    return { panel, updaterPanel, objectNamed, open };
};

const loadedMessage = (contactOverrides: Record<string, unknown> = {}) => ({
    command: 'updaterRecords', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, orgLabel: 'qa',
    objects: [
        { objectApiName: 'Account', totalSize: 3, recordCount: 3, isTruncated: false, hiddenColumnCount: 0, columns: ['Id'], rows: [['001A'], ['001B'], ['001C']], ...NO_EDITS },
        { objectApiName: 'Contact', totalSize: 1, recordCount: 1, isTruncated: false, hiddenColumnCount: 0, columns: ['Id', 'AccountId'], rows: [['003A', '001A']], ...NO_EDITS,
            newRecordsParent: { parentObjectApiName: 'Account', lookupFieldApiName: 'AccountId', parentRecordCount: 3 }, ...contactOverrides }
    ]
});

const newRecordsMessage = (overrides: Record<string, unknown> = {}) => ({
    command: 'updaterNewRecords', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', parentObjectApiName: 'Account', countPerParent: 2, recordCount: 6, pageCount: 1,
    columns: ['AccountId', 'LastName'], rows: [['001A', '<b>Okafor</b>'], ['001A', 'Lindqvist']], ...overrides
});

const posted = (panel: any, command: string) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === command);
const tabsOf = (panel: any, objectElement: any) => panel.findAll(objectElement, 'updaterRecordTab');
const newPanelOf = (panel: any, objectElement: any) => panel.findAll(objectElement, 'updaterRecordTabPanel-new')[0];
const generateOf = (panel: any, objectElement: any) => panel.findAll(objectElement, 'updaterNewRecordsGenerate')[0];

describe('the Treecipe Adapter\'s Generate new records tab, in the panel (#722)', () => {

    it('gives every object below the chosen parent two tabs, opened on Edit existing records, and the parent none', () => {

        const { panel, open } = openAdapter();
        const accountObject = open('Account');
        const contactObject = open('Contact');

        expect(tabsOf(panel, accountObject)).toEqual([]);
        expect(tabsOf(panel, contactObject).map((tabElement: any) => [tabElement.textContent, tabElement.attributes.role, tabElement.attributes['aria-selected']]))
            .toEqual([[RECIPE_COCKPIT_UPDATER_EDIT_HEADING, 'tab', 'true'], [RECIPE_COCKPIT_UPDATER_NEW_RECORDS_TAB_LABEL, 'tab', 'false']]);
        expect(panel.findAll(contactObject, 'updaterRecordTabStrip')[0].attributes).toMatchObject({ role: 'tablist', 'aria-label': 'Contact records' });
        expect(panel.isHidden(newPanelOf(panel, contactObject))).toBe(true);
        expect(newPanelOf(panel, contactObject).attributes).toMatchObject({ role: 'tabpanel', 'aria-label': `${RECIPE_COCKPIT_UPDATER_NEW_RECORDS_TAB_LABEL} of Contact` });

    });

    it('switches tabs by click and by the arrow keys, keeping the loaded table in the first and what was set in the second', () => {

        const { panel, open } = openAdapter();
        const contactObject = open('Contact');
        panel.postToPanel(loadedMessage());
        const [editTab, newTab] = tabsOf(panel, contactObject);

        newTab.dispatch('click');
        expect([editTab.attributes['aria-selected'], newTab.attributes['aria-selected']]).toEqual(['false', 'true']);
        expect(panel.isHidden(panel.findAll(contactObject, 'updaterRecordTabPanel-edit')[0])).toBe(true);
        expect(panel.isHidden(newPanelOf(panel, contactObject))).toBe(false);

        const countInput = panel.findAll(contactObject, 'updaterNewRecordsCountInput')[0];
        countInput.value = '4';
        newTab.dispatch('keydown', { key: 'ArrowLeft', preventDefault: () => undefined });
        expect(editTab.attributes['aria-selected']).toBe('true');
        expect(panel.activeElement()).toBe(editTab);
        // THE TABLE IS STILL THERE, AND SO IS THE COUNT TYPED
        expect(panel.findAll(panel.findAll(contactObject, 'updaterRecordTabPanel-edit')[0], 'treeQueryRow')).toHaveLength(1);
        editTab.dispatch('keydown', { key: 'ArrowRight', preventDefault: () => undefined });
        expect(countInput.value).toBe('4');

    });

    it('says why Generate records cannot run: before a load, for an object the load did not read, and when no parent was loaded', () => {

        const { panel, open } = openAdapter();
        const contactObject = open('Contact');
        const reasonOf = () => [generateOf(panel, contactObject).disabled, panel.findAll(contactObject, 'updaterNewRecordsReason')[0].textContent];

        expect(reasonOf()).toEqual([true, RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NOT_LOADED_REASON]);

        panel.postToPanel(loadedMessage({ newRecordsParent: undefined }));
        expect(reasonOf()).toEqual([true, RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NOT_READ_REASON]);

        panel.postToPanel(loadedMessage({ newRecordsParent: { parentObjectApiName: 'Account', lookupFieldApiName: 'AccountId', parentRecordCount: 0 } }));
        expect(reasonOf()).toEqual([true, RECIPE_COCKPIT_UPDATER_NEW_RECORDS_NO_PARENTS_REASON]);

        panel.postToPanel(loadedMessage());
        expect(reasonOf()).toEqual([false, '']);
        expect(panel.findAll(contactObject, 'updaterNewRecordsHeading')[0].textContent).toBe('Add new Contact records under the 3 Account records loaded.');
        expect(panel.findAll(contactObject, 'updaterNewRecordsCountInput')[0].attributes['aria-label']).toBe('Contact records per loaded Account record');

    });

    it('lists the object\'s fields with a box each, a field with an expression ticked, and locks the lookup to the parent', () => {

        const { panel, open } = openAdapter();
        const contactObject = open('Contact');
        const rows = panel.findAll(newPanelOf(panel, contactObject), 'updaterNewRecordsField');
        const rowNamed = (fieldApiName: string) => rows.find((rowElement: any) => panel.findAll(rowElement, 'updaterFieldName')[0].textContent === fieldApiName);

        expect(rows.length).toBeGreaterThan(1);
        expect(panel.findAll(rowNamed('LastName'), 'updaterFieldChoose')[0]).toMatchObject({ disabled: false });
        expect(panel.findAll(rowNamed('LastName'), 'updaterFieldChoose')[0].attributes['aria-checked']).toBe('true');
        expect(panel.findAll(rowNamed('AccountId'), 'updaterFieldChoose')[0].disabled).toBe(true);
        // THE SECTION'S OWN ROWS, WHICH DESCRIBE THE FIELDS, ARE NOT THESE: THE FILTER AND ITS COUNTS READ THOSE ONCE
        expect(panel.findAll(newPanelOf(panel, contactObject), 'updaterField')).toEqual([]);

    });

    it('locks and unticks a field the last load did not read, saying why, and leaves it out of what is posted', () => {

        const { panel, open } = openAdapter();
        const contactObject = open('Contact');
        const rowNamed = (fieldApiName: string) => panel.findAll(newPanelOf(panel, contactObject), 'updaterNewRecordsField').find((rowElement: any) => panel.findAll(rowElement, 'updaterFieldName')[0].textContent === fieldApiName);
        const lastNameBox = () => panel.findAll(rowNamed('LastName'), 'updaterFieldChoose')[0];
        expect([lastNameBox().disabled, lastNameBox().attributes['aria-checked']]).toEqual([false, 'true']);

        panel.postToPanel(loadedMessage({ unreadFieldApiNames: ['LastName'] }));

        expect([lastNameBox().disabled, lastNameBox().attributes['aria-checked']]).toEqual([true, 'false']);
        expect(lastNameBox().attributes.title).toBe(`Cannot be chosen: ${RECIPE_COCKPIT_UPDATER_NEW_RECORDS_UNREAD_FIELD_REASON}`);
        generateOf(panel, contactObject).dispatch('click');
        expect(posted(panel, 'generateUpdaterNewRecords')[0].fields.map((field: any) => field.fieldApiName)).not.toContain('LastName');

        // A LOAD THAT READS IT AGAIN GIVES THE BOX BACK, UNTICKED: THE READER CHOOSES
        panel.postToPanel({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'generateNew' });
        panel.postToPanel(loadedMessage());
        expect([lastNameBox().disabled, lastNameBox().attributes['aria-checked']]).toEqual([false, 'false']);

    });

    it('says which object\'s button is generating to a panel reopened while the run is in flight', () => {

        const { panel, open } = openAdapter();
        const contactObject = open('Contact');
        panel.postToPanel(loadedMessage());

        panel.postToPanel({ command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, runKind: 'generateNew', objectApiName: 'Contact' });

        expect([generateOf(panel, contactObject).disabled, generateOf(panel, contactObject).textContent]).toEqual([true, RECIPE_COCKPIT_UPDATER_NEW_RECORDS_GENERATING_LABEL]);

    });

    it('posts the object, the count and the ticked fields, each with any value typed for it, and holds the button while the run is in flight', () => {

        const { panel, open } = openAdapter();
        const contactObject = open('Contact');
        panel.postToPanel(loadedMessage());
        const tabPanel = newPanelOf(panel, contactObject);
        const rowNamed = (fieldApiName: string) => panel.findAll(tabPanel, 'updaterNewRecordsField').find((rowElement: any) => panel.findAll(rowElement, 'updaterFieldName')[0].textContent === fieldApiName);

        panel.findAll(rowNamed('LastName'), 'updaterFieldEdit')[0].dispatch('click');
        panel.findAll(rowNamed('LastName'), 'fieldEditorInput')[0].value = 'Okafor';
        panel.findAll(rowNamed('LastName'), 'fieldEditorSave')[0].dispatch('click');
        panel.findAll(contactObject, 'updaterNewRecordsCountInput')[0].value = '2';
        generateOf(panel, contactObject).dispatch('click');

        const [generateMessage] = posted(panel, 'generateUpdaterNewRecords');
        expect(generateMessage).toMatchObject({ treeKey: ACCOUNT_TREE_KEY, renderSequence: 1, objectApiName: 'Contact', countPerParent: 2 });
        expect(generateMessage.fields).toContainEqual({ fieldApiName: 'LastName', value: 'Okafor' });
        expect(generateMessage.fields.map((field: any) => field.fieldApiName)).not.toContain('AccountId');
        expect(generateOf(panel, contactObject).disabled).toBe(true);
        expect(generateOf(panel, contactObject).textContent).toBe(RECIPE_COCKPIT_UPDATER_NEW_RECORDS_GENERATING_LABEL);

        // A SECOND PRESS WHILE IT RUNS POSTS NOTHING
        generateOf(panel, contactObject).dispatch('click');
        expect(posted(panel, 'generateUpdaterNewRecords')).toHaveLength(1);

        panel.postToPanel({ command: 'updaterLoadState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, runKind: 'generateNew' });
        expect([generateOf(panel, contactObject).disabled, generateOf(panel, contactObject).textContent]).toEqual([false, RECIPE_COCKPIT_UPDATER_NEW_RECORDS_GENERATE_LABEL]);

    });

    it.each(['0', '2.5', 'many', ''])('posts nothing for a count of "%s", and says what a count is', (countText) => {

        const { panel, open } = openAdapter();
        const contactObject = open('Contact');
        panel.postToPanel(loadedMessage());
        panel.findAll(contactObject, 'updaterNewRecordsCountInput')[0].value = countText;
        generateOf(panel, contactObject).dispatch('click');

        expect(posted(panel, 'generateUpdaterNewRecords')).toEqual([]);
        const refusalElement = panel.findAll(contactObject, 'updaterNewRecordsRefusal')[0];
        expect([panel.isHidden(refusalElement), refusalElement.textContent, refusalElement.attributes.role]).toEqual([false, 'The count per loaded record must be a whole number of one or more.', 'alert']);

    });

    it('draws the preview as text with its counts, on a tab built before or after it arrived, and only on its own model', () => {

        const { panel, open } = openAdapter();
        panel.postToPanel(loadedMessage());
        panel.postToPanel(newRecordsMessage({ renderSequence: 2 }));
        panel.postToPanel(newRecordsMessage());
        const contactObject = open('Contact');
        const previewElement = panel.findAll(contactObject, 'updaterNewRecordsPreview')[0];

        expect(panel.isHidden(previewElement)).toBe(false);
        expect(panel.findAll(previewElement, 'updaterNewRecordsSummary')[0].textContent).toBe('6 new Contact records, 2 per Account record');
        expect(panel.findAll(previewElement, 'treeQueryRow')).toHaveLength(2);
        expect(panel.findAll(previewElement, 'b')).toEqual([]);
        expect(panel.findAll(previewElement, 'updaterRecordsPageLabel')[0].textContent).toBe('Page 1 of 1');
        expect(panel.findAll(previewElement, 'updaterNewRecordsNext')).toEqual([]);

    });

    it('asks the host for a page by the object\'s name and an index, and draws the page answered', () => {

        const { panel, open } = openAdapter();
        const contactObject = open('Contact');
        panel.postToPanel(loadedMessage());
        panel.postToPanel(newRecordsMessage({ recordCount: 120, pageCount: 3 }));
        const previewElement = panel.findAll(contactObject, 'updaterNewRecordsPreview')[0];
        const pagerButtons = () => [panel.findAll(previewElement, 'updaterNewRecordsPrevious')[0], panel.findAll(previewElement, 'updaterNewRecordsNext')[0]];

        expect(pagerButtons().map((pagerButton: any) => [pagerButton.attributes['aria-label'], pagerButton.disabled])).toEqual([['Previous page of new Contact records', true], ['Next page of new Contact records', false]]);
        pagerButtons()[1].dispatch('click');
        expect(posted(panel, 'loadUpdaterNewRecordsPage')).toEqual([{ command: 'loadUpdaterNewRecordsPage', treeKey: ACCOUNT_TREE_KEY, renderSequence: 1, objectApiName: 'Contact', pageIndex: 1 }]);
        // HELD UNTIL THE PAGE ARRIVES
        expect(pagerButtons().map((pagerButton: any) => pagerButton.disabled)).toEqual([true, true]);

        panel.postToPanel({ command: 'updaterNewRecordsPage', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', pageIndex: 1, rows: [['001B', 'Page two']] });
        expect(panel.findAll(previewElement, 'updaterRecordsPageLabel')[0].textContent).toBe('Page 2 of 3');
        expect(panel.findAll(previewElement, 'treeQueryRow')).toHaveLength(1);
        expect(pagerButtons().map((pagerButton: any) => pagerButton.disabled)).toEqual([false, false]);
        expect(panel.activeElement()).toBe(pagerButtons()[1]);

    });

    it('lets the preview go when a new load starts, since the host let its records go', () => {

        const { panel, open } = openAdapter();
        const contactObject = open('Contact');
        panel.postToPanel(loadedMessage());
        panel.postToPanel(newRecordsMessage());
        expect(panel.isHidden(panel.findAll(contactObject, 'updaterNewRecordsPreview')[0])).toBe(false);

        panel.postToPanel({ command: 'updaterLoadState', isRunning: true, treeKey: ACCOUNT_TREE_KEY });

        expect(panel.isHidden(panel.findAll(contactObject, 'updaterNewRecordsPreview')[0])).toBe(true);

    });

});
