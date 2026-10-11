import * as path from 'path';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), showWarningMessage: jest.fn(), showInformationMessage: jest.fn() },
    commands: { executeCommand: jest.fn() },
    workspace: { workspaceFolders: undefined },
    ViewColumn: { One: 1 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import { RecipeCockpitService } from '../RecipeCockpitService';
import { RecipeCockpitTreeHistory } from '../RecipeCockpitTreeHistory';
import { runPanelScript } from './RecipeCockpitPanelHarness';

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const HISTORY_FAKE_DATA_SETS_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'FakeDataSets');
const HISTORY_CURRENT_RUN = 'recipe-2026-09-20T10-00-00';
const HISTORY_TREES = [
    { treeKey: 'Account-thru-OtherChildObject__c', folderName: 'Account-thru-OtherChildObject__c' },
    { treeKey: 'Lead-ONLY', folderName: 'Lead-ONLY' }
];

describe('Recipe Cockpit partial updates (#226)', () => {

    describe('RecipeCockpitTreeHistory.buildAddedDataset', () => {

        const buildAddedDatasetFor = (datasetFolderName: string, trees = HISTORY_TREES, workspaceRoot = HISTORY_WORKSPACE_ROOT) => RecipeCockpitTreeHistory.buildAddedDataset(
            path.join(HISTORY_FAKE_DATA_SETS_PATH, datasetFolderName),
            HISTORY_GENERATED_RECIPES_PATH,
            workspaceRoot,
            HISTORY_CURRENT_RUN,
            trees
        );

        it('lists a data set exactly as a reload of the run would, on the card of its tree only', () => {

            const addedDataset = buildAddedDatasetFor('dataset-2026-09-21T00-00-00');
            const reloadedHistories = RecipeCockpitTreeHistory.buildTreeHistories(
                HISTORY_GENERATED_RECIPES_PATH, HISTORY_FAKE_DATA_SETS_PATH, HISTORY_WORKSPACE_ROOT, HISTORY_CURRENT_RUN, HISTORY_TREES, new Map()
            ).historiesByTreeKey;

            expect(addedDataset.treeKeys).toEqual(['Lead-ONLY']);
            expect(addedDataset.datasetFolderPath).toBe(path.join(HISTORY_FAKE_DATA_SETS_PATH, 'dataset-2026-09-21T00-00-00'));
            expect(addedDataset.dataset).toEqual(
                reloadedHistories.get('Lead-ONLY').datasets.find(dataset => dataset.datasetFolderName === 'dataset-2026-09-21T00-00-00')
            );
            expect(addedDataset.dataset).toEqual({
                datasetFolderName: 'dataset-2026-09-21T00-00-00',
                generatedAtLabel: '2026-09-21 00:00:00 UTC',
                fakerService: 'snowfakery',
                runFolderName: HISTORY_CURRENT_RUN,
                recordCounts: [{ objectApiName: 'Lead', recordCount: 5 }]
            });

        });

        it('names every card that shows the same tree folder', () => {

            const addedDataset = buildAddedDatasetFor('dataset-2026-09-21T00-00-00', [...HISTORY_TREES, { treeKey: 'Lead-ONLY#2', folderName: 'Lead-ONLY' }]);

            expect(addedDataset.treeKeys).toEqual(['Lead-ONLY', 'Lead-ONLY#2']);

        });

        it('leaves out a card whose tree folder is not in the run on screen, which a reload gives no history', () => {

            const addedDataset = buildAddedDatasetFor('dataset-2026-09-21T00-00-00', [...HISTORY_TREES, { treeKey: 'Account-thru-Contact', folderName: 'Account-thru-Contact' }]);

            expect(addedDataset.treeKeys).toEqual(['Lead-ONLY']);

        });

        it('places a data set whose run is gone on its tree with its version unknown, as a reload does', () => {

            const addedDataset = buildAddedDatasetFor('dataset-2026-09-15T00-00-00');

            expect(addedDataset.treeKeys).toEqual(['Lead-ONLY']);
            expect(addedDataset.dataset.runFolderName).toBeNull();

        });

        it.each([
            ['a recipe outside any tree', 'dataset-2026-09-16T00-00-00'],
            ['an unreadable datasetSource.json', 'dataset-2026-09-17T00-00-00'],
            ['a folder that does not exist', 'dataset-2026-09-30T00-00-00'],
            ['a name that is not a data set folder', 'BaseArtifactFiles']
        ])('answers undefined for %s, so the caller reloads', (_description, datasetFolderName) => {

            expect(buildAddedDatasetFor(datasetFolderName)).toBeUndefined();

        });

        it('answers undefined for a data set no card on screen shows', () => {

            expect(buildAddedDatasetFor('dataset-2026-09-21T00-00-00', [HISTORY_TREES[0]])).toBeUndefined();

        });

        it('answers undefined for a folder outside the workspace', () => {

            expect(buildAddedDatasetFor('dataset-2026-09-21T00-00-00', HISTORY_TREES, path.join(__dirname, 'mocks', 'treeWorkspace'))).toBeUndefined();

        });

    });

    describe('the panel script, datasetAdded', () => {

        const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
        const LEAD_TREE_KEY = 'Lead-ONLY';
        const ADDED_DATASET = {
            datasetFolderName: 'dataset-2026-10-07T12-00-00',
            generatedAtLabel: '2026-10-07 12:00:00 UTC',
            fakerService: 'snowfakery',
            runFolderName: HISTORY_CURRENT_RUN,
            recordCounts: [{ objectApiName: 'Lead', recordCount: 2 }]
        };
        const LEAD_CREATE_RESULT = { treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', createdCount: 2, failedCount: 0, message: '' };

        const loadHistoryRecipe = () => {
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH);
            return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, HISTORY_WORKSPACE_ROOT, HISTORY_CURRENT_RUN).recipeViewModel;
        };

        // EVERY TAB OF EVERY CARD BUILT, AN ORG SELECTED AND THE CURRENT VERSION OPEN: THE MOST A datasetAdded COULD DISTURB
        const renderEverythingOpen = (recipe = loadHistoryRecipe()) => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
            panel.expandAllTrees();
            panel.treeCards().forEach((treeCard: any) => {
                panel.openTab(treeCard, 'Data-by-Org');
                panel.openTab(treeCard, 'Previous Versions');
                panel.findAll(treeCard, 'treeVersionToggle')[0].dispatch('click');
                panel.openTab(treeCard, 'Previous Fake Sets');
            });
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Sandbox', isSandbox: true, failureMessage: '', requestSequence: 3, renderSequence: 1 });
            panel.postToPanel({
                command: 'dataOrgReadiness',
                objects: ['Account', 'Contact', 'OtherChildObject__c', 'Lead'].map(objectApiName => ({ objectApiName, disabledReason: '', requiredLookups: [] })),
                createResults: [],
                requestSequence: 3,
                renderSequence: 1
            });
            panel.postedHostMessages.length = 0;

            return panel;

        };

        const cardNamed = (panel: any, treeKey: string) => panel.treeCards()[treeKey === ACCOUNT_TREE_KEY ? 0 : 1];
        const descendantsOf = (element: any): any[] => [element, ...element.children.flatMap(descendantsOf)];
        const datasetFolderNamesIn = (panel: any, element: any) => panel.findAll(element, 'treeDatasetFolder').map((folderElement: any) => folderElement.textContent);
        const leadDataRow = (panel: any) => panel.findAll(cardNamed(panel, LEAD_TREE_KEY), 'dataObject')[0];
        const postDatasetAdded = (panel: any, overrides: Record<string, unknown> = {}) => panel.postToPanel({
            command: 'datasetAdded',
            treeKeys: [LEAD_TREE_KEY],
            dataset: ADDED_DATASET,
            createResult: LEAD_CREATE_RESULT,
            renderSequence: 1,
            updateSequence: 7,
            ...overrides
        });

        it('replaces no node of any other card, and none of this card outside its new rows', () => {

            const panel = renderEverythingOpen();
            const accountCardNodesBefore = descendantsOf(cardNamed(panel, ACCOUNT_TREE_KEY));
            const leadCardNodesBefore = descendantsOf(cardNamed(panel, LEAD_TREE_KEY));
            const toolbarAndCardsBefore = panel.cockpitBodyElement.children.slice();

            postDatasetAdded(panel);

            expect(panel.cockpitBodyElement.children).toEqual(toolbarAndCardsBefore);
            panel.cockpitBodyElement.children.forEach((childElement: any, childIndex: number) => expect(childElement).toBe(toolbarAndCardsBefore[childIndex]));

            const accountCardNodesAfter = descendantsOf(cardNamed(panel, ACCOUNT_TREE_KEY));
            expect(accountCardNodesAfter).toHaveLength(accountCardNodesBefore.length);
            accountCardNodesAfter.forEach((nodeAfter, nodeIndex) => expect(nodeAfter).toBe(accountCardNodesBefore[nodeIndex]));

            // EVERY NODE THE LEAD CARD HAD IS STILL THERE; ONLY THE TWO NEW ROWS ARE NEW
            const leadCardNodesAfter = descendantsOf(cardNamed(panel, LEAD_TREE_KEY));
            leadCardNodesBefore.forEach(nodeBefore => expect(leadCardNodesAfter).toContain(nodeBefore));
            const addedNodes = leadCardNodesAfter.filter(nodeAfter => !leadCardNodesBefore.includes(nodeAfter));
            expect(addedNodes.filter(addedNode => addedNode.classList.contains('treeDataset'))).toHaveLength(2);
            addedNodes.forEach(addedNode => expect(addedNodes.some(candidateRow => candidateRow.classList.contains('treeDataset') && descendantsOf(candidateRow).includes(addedNode))).toBe(true));

        });

        it('lists the data set first in Previous Fake Sets and under its version, and shows the Create result on its row', () => {

            const panel = renderEverythingOpen();
            const leadCard = cardNamed(panel, LEAD_TREE_KEY);
            const datasetFolderNamesBefore = datasetFolderNamesIn(panel, panel.tabPanelOf(leadCard, 'treeDatasets'));

            postDatasetAdded(panel);

            expect(datasetFolderNamesIn(panel, panel.tabPanelOf(leadCard, 'treeDatasets'))).toEqual([ADDED_DATASET.datasetFolderName, ...datasetFolderNamesBefore]);
            expect(panel.findAll(panel.tabPanelOf(leadCard, 'treeDatasets'), 'tabMatchCount')[0].textContent).toBe(`${datasetFolderNamesBefore.length + 1} data sets`);
            const currentVersionBody = panel.findAll(leadCard, 'treeVersionBody')[0];
            expect(datasetFolderNamesIn(panel, currentVersionBody)).toEqual([ADDED_DATASET.datasetFolderName, 'dataset-2026-09-21T00-00-00']);
            expect(panel.findAll(leadDataRow(panel), 'dataCreateResult')[0].textContent).toBe('✓ 2 created');

            // ITS Open AND Insert… NAME THE FOLDER, AND THE ROW SAYS WHICH VERSION IT CAME FROM
            const addedRow = panel.findAll(panel.tabPanelOf(leadCard, 'treeDatasets'), 'treeDataset')[0];
            panel.findAll(addedRow, 'treeDatasetInsert')[0].dispatch('click');
            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'insertDataset', datasetFolderName: ADDED_DATASET.datasetFolderName, treeKey: LEAD_TREE_KEY, tab: 'datasets' });
            expect(panel.findAll(addedRow, 'treeDatasetVersion')[0].textContent).toBe('current version');

        });

        it('acknowledges with its own updateSequence once drawn', () => {

            const panel = renderEverythingOpen();

            postDatasetAdded(panel);

            expect(panel.postedHostMessages).toEqual([{ command: 'partialRendered', renderSequence: 1, updateSequence: 7 }]);

        });

        it('drops a datasetAdded for another model, drawing nothing and acknowledging nothing', () => {

            const panel = renderEverythingOpen();
            const leadCardNodesBefore = descendantsOf(cardNamed(panel, LEAD_TREE_KEY));

            postDatasetAdded(panel, { renderSequence: 2 });

            expect(descendantsOf(cardNamed(panel, LEAD_TREE_KEY))).toEqual(leadCardNodesBefore);
            expect(panel.findAll(leadDataRow(panel), 'dataCreateResult')[0].textContent).toBe('');
            expect(panel.postedHostMessages).toEqual([]);

        });

        it('keeps the tab\'s search applied, hiding a new row it does not match', () => {

            const panel = renderEverythingOpen();
            const leadCard = cardNamed(panel, LEAD_TREE_KEY);
            panel.typeIntoTabSearch(leadCard, 'treeDatasets', '09-21');

            postDatasetAdded(panel);

            const [addedRow] = panel.findAll(panel.tabPanelOf(leadCard, 'treeDatasets'), 'treeDataset');
            expect(panel.isHidden(addedRow)).toBe(true);
            expect(panel.findAll(panel.tabPanelOf(leadCard, 'treeDatasets'), 'tabMatchCount')[0].textContent).toBe('1 of 4 data sets');

        });

        it('adds the first data set to a tab built empty, with a search box, and a version body that had none', () => {

            const recipe = loadHistoryRecipe();
            recipe.trees.find((tree: any) => tree.treeKey === LEAD_TREE_KEY).history.datasets = [];
            const panel = renderEverythingOpen(recipe);
            const leadCard = cardNamed(panel, LEAD_TREE_KEY);
            expect(panel.findAll(panel.tabPanelOf(leadCard, 'treeDatasets'), 'tabSearchInput')).toEqual([]);

            postDatasetAdded(panel);

            expect(datasetFolderNamesIn(panel, panel.tabPanelOf(leadCard, 'treeDatasets'))).toEqual([ADDED_DATASET.datasetFolderName]);
            expect(panel.findAll(panel.tabPanelOf(leadCard, 'treeDatasets'), 'tabSearchInput')).toHaveLength(1);
            expect(panel.findAll(panel.tabPanelOf(leadCard, 'treeDatasets'), 'treeEmpty')).toEqual([]);
            const currentVersionBody = panel.findAll(leadCard, 'treeVersionBody')[0];
            expect(datasetFolderNamesIn(panel, currentVersionBody)).toEqual([ADDED_DATASET.datasetFolderName]);
            expect(panel.findAll(currentVersionBody, 'treeEmpty')).toEqual([]);

        });

        it('lists the data set in a history tab first opened after it arrived', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadHistoryRecipe(), renderSequence: 1 });
            panel.expandAllTrees();

            postDatasetAdded(panel, { createResult: undefined });

            const leadCard = cardNamed(panel, LEAD_TREE_KEY);
            panel.openTab(leadCard, 'Previous Fake Sets');
            expect(datasetFolderNamesIn(panel, panel.tabPanelOf(leadCard, 'treeDatasets'))[0]).toBe(ADDED_DATASET.datasetFolderName);

        });

        it('draws a data set the card already lists only once', () => {

            const panel = renderEverythingOpen();
            const leadCard = cardNamed(panel, LEAD_TREE_KEY);

            postDatasetAdded(panel);
            postDatasetAdded(panel, { updateSequence: 8 });

            expect(datasetFolderNamesIn(panel, panel.tabPanelOf(leadCard, 'treeDatasets')).filter((folderName: string) => folderName === ADDED_DATASET.datasetFolderName)).toHaveLength(1);

        });

    });


    // THE PANEL ADDS A ROW ABOVE THE ROWS ALREADY THERE; THE FAKE DOM HAS TO DO THAT AS THE REAL ONE DOES
    describe('the panel harness, insertBefore', () => {

        it('inserts before the reference, appends for a null reference, and throws for an element that is not a child', () => {

            // EACH RUN OF THE SCRIPT HANDS BACK A FRESH FAKE ELEMENT AS ITS BODY
            const [containerElement, firstElement, secondElement, thirdElement, strayElement] = Array.from({ length: 5 }, () => runPanelScript().cockpitBodyElement);
            containerElement.textContent = '';
            expect(containerElement.firstChild).toBeNull();
            containerElement.appendChild(secondElement);

            containerElement.insertBefore(firstElement, secondElement);
            containerElement.insertBefore(thirdElement, null);

            expect(containerElement.children).toEqual([firstElement, secondElement, thirdElement]);
            expect(containerElement.firstChild).toBe(firstElement);
            expect(firstElement.parentNode).toBe(containerElement);
            expect(() => containerElement.insertBefore(firstElement, strayElement)).toThrow('not a child');

        });

    });

});
