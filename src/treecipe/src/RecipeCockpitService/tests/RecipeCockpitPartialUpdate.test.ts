import * as path from 'path';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), showWarningMessage: jest.fn(), showInformationMessage: jest.fn() },
    commands: { executeCommand: jest.fn() },
    workspace: { workspaceFolders: undefined },
    ViewColumn: { One: 1 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import { RecipeCockpitService, RECIPE_COCKPIT_ORG_CONNECTION_CHECK_INSERT_REASON } from '../RecipeCockpitService';
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
                HISTORY_GENERATED_RECIPES_PATH, HISTORY_FAKE_DATA_SETS_PATH, HISTORY_WORKSPACE_ROOT, HISTORY_CURRENT_RUN, HISTORY_TREES
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

        const loadHistoryRecipe = () => {
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH);
            return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, HISTORY_WORKSPACE_ROOT, HISTORY_CURRENT_RUN).recipeViewModel;
        };

        // EVERY TAB OF EVERY CARD BUILT AND AN ORG SELECTED: THE MOST A datasetAdded COULD DISTURB
        const renderEverythingOpen = (recipe = loadHistoryRecipe()) => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
            panel.expandAllTrees();
            panel.treeCards().forEach((treeCard: any) => {
                panel.openTab(treeCard, 'Previously Used Data Sets');
            });
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Sandbox', isSandbox: true, failureMessage: '', requestSequence: 3, renderSequence: 1 });
            panel.postToPanel({
                command: 'dataOrgReadiness',
                objects: ['Account', 'Contact', 'OtherChildObject__c', 'Lead'].map(objectApiName => ({ objectApiName, disabledReason: '', requiredLookups: [] })),
                createTargets: [],
                requestSequence: 3,
                renderSequence: 1
            });
            panel.postedHostMessages.length = 0;

            return panel;

        };

        const cardNamed = (panel: any, treeKey: string) => panel.treeCards()[treeKey === ACCOUNT_TREE_KEY ? 0 : 1];
        const descendantsOf = (element: any): any[] => [element, ...element.children.flatMap(descendantsOf)];
        const datasetFolderNamesIn = (panel: any, element: any) => panel.findAll(element, 'treeDatasetFolder').map((folderElement: any) => folderElement.textContent);
        const postDatasetAdded = (panel: any, overrides: Record<string, unknown> = {}) => panel.postToPanel({
            command: 'datasetAdded',
            treeKeys: [LEAD_TREE_KEY],
            dataset: ADDED_DATASET,
            renderSequence: 1,
            updateSequence: 7,
            ...overrides
        });

        it('replaces no node of any other card, and none of this card outside its new rows', () => {

            const panel = renderEverythingOpen();
            const accountCardNodesBefore = descendantsOf(cardNamed(panel, ACCOUNT_TREE_KEY));
            const leadCardNodesBefore = descendantsOf(cardNamed(panel, LEAD_TREE_KEY));
            const bodyChildrenBefore = panel.cockpitBodyElement.children.slice();

            postDatasetAdded(panel);

            expect(panel.cockpitBodyElement.children).toEqual(bodyChildrenBefore);
            panel.cockpitBodyElement.children.forEach((childElement: any, childIndex: number) => expect(childElement).toBe(bodyChildrenBefore[childIndex]));

            const accountCardNodesAfter = descendantsOf(cardNamed(panel, ACCOUNT_TREE_KEY));
            expect(accountCardNodesAfter).toHaveLength(accountCardNodesBefore.length);
            accountCardNodesAfter.forEach((nodeAfter, nodeIndex) => expect(nodeAfter).toBe(accountCardNodesBefore[nodeIndex]));

            // EVERY NODE THE LEAD CARD HAD IS STILL THERE; ONLY THE NEW ROW IS NEW
            const leadCardNodesAfter = descendantsOf(cardNamed(panel, LEAD_TREE_KEY));
            leadCardNodesBefore.forEach(nodeBefore => expect(leadCardNodesAfter).toContain(nodeBefore));
            const addedNodes = leadCardNodesAfter.filter(nodeAfter => !leadCardNodesBefore.includes(nodeAfter));
            expect(addedNodes.filter(addedNode => addedNode.classList.contains('treeDataset'))).toHaveLength(1);
            addedNodes.forEach(addedNode => expect(addedNodes.some(candidateRow => candidateRow.classList.contains('treeDataset') && descendantsOf(candidateRow).includes(addedNode))).toBe(true));

        });

        // WHAT A NODE SHOWS: ITS OWN TEXT, CLASSES, ATTRIBUTES AND WHETHER IT IS DISABLED
        const stateOf = (element: any) => JSON.stringify([element.ownTextContent, element.className, element.attributes, element.disabled, element.value]);
        const isInside = (element: any, ancestorElements: any[]) => ancestorElements.some(ancestorElement => descendantsOf(ancestorElement).includes(element));

        /*
            #226's criteria name what a partial update must leave alone: the org picker, a
            scratch org run in flight, and a card's Structure exclusions (#219) -- the card the data set
            joins included. Each is drawn here before the message arrives. (Every card's comparison was
            on that list too, until #266 removed the Compare tab.)
        */
        it('leaves the org picker, a running scratch org and the card\'s exclusions exactly as they were', () => {

            const recipe = loadHistoryRecipe();
            recipe.trees.find((tree: any) => tree.treeKey === LEAD_TREE_KEY).objectSelection = {
                exclusions: [{ objectApiName: 'Lead', kind: 'excluded' }],
                disabledLookups: [],
                includedObjectCount: 0,
                objectCount: 1
            };
            const panel = renderEverythingOpen(recipe);
            panel.postToPanel({ command: 'scratchOrgState', isRunning: true });
            const leadCard = cardNamed(panel, LEAD_TREE_KEY);
            const historyPanels = [panel.tabPanelOf(leadCard, 'treeDatasets')];
            const nodesBefore = descendantsOf(panel.cockpitBodyElement);
            const statesBefore = nodesBefore.map(stateOf);
            expect(panel.findAll(leadCard, 'treeObjectInclude')[0].attributes['aria-pressed']).toBe('false');

            postDatasetAdded(panel);

            // EVERY NODE IS STILL THE SAME OBJECT, AND SHOWS WHAT IT SHOWED -- BUT FOR THE NEW ROW'S TAB
            const nodesAfter = descendantsOf(panel.cockpitBodyElement);
            nodesBefore.forEach((nodeBefore, nodeIndex) => {
                expect(nodesAfter).toContain(nodeBefore);
                if ( !isInside(nodeBefore, historyPanels) ) {
                    expect(stateOf(nodeBefore)).toBe(statesBefore[nodeIndex]);
                }
            });
            expect(panel.findAll(leadCard, 'treeObjectInclude')[0].attributes['aria-pressed']).toBe('false');

        });

        it('lists the data set first in Previously Used Data Sets, and draws no insert result on its card (#301)', () => {

            const panel = renderEverythingOpen();
            const leadCard = cardNamed(panel, LEAD_TREE_KEY);
            const datasetFolderNamesBefore = datasetFolderNamesIn(panel, panel.tabPanelOf(leadCard, 'treeDatasets'));

            postDatasetAdded(panel);

            expect(datasetFolderNamesIn(panel, panel.tabPanelOf(leadCard, 'treeDatasets'))).toEqual([ADDED_DATASET.datasetFolderName, ...datasetFolderNamesBefore]);
            expect(panel.findAll(panel.tabPanelOf(leadCard, 'treeDatasets'), 'tabMatchCount')[0].textContent).toBe(`${datasetFolderNamesBefore.length + 1} data sets`);
            expect(panel.findAll(leadCard, 'treeInsertResult')).toEqual([]);

            // ITS Open AND Insert… NAME THE FOLDER, AND THE ROW SAYS WHICH VERSION IT CAME FROM
            const addedRow = panel.findAll(panel.tabPanelOf(leadCard, 'treeDatasets'), 'treeDataset')[0];
            panel.findAll(addedRow, 'treeDatasetInsert')[0].dispatch('click');
            // THE TARGET ORG MANAGER'S SELECTION, BY INDEX (#541)
            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'insertDataset', datasetFolderName: ADDED_DATASET.datasetFolderName, treeKey: LEAD_TREE_KEY, tab: 'datasets', orgIndex: 0 });
            expect(panel.findAll(addedRow, 'treeDatasetVersion')[0].textContent).toBe('current version');

        });

        describe('a data set row\'s Insert… (#541)', () => {

            const datasetInsertButtons = (panel: any) => panel.findAll(panel.tabPanelOf(cardNamed(panel, LEAD_TREE_KEY), 'treeDatasets'), 'treeDatasetInsert');

            it('posts no org index when no org is selected, and says the org will be asked for', () => {

                const panel = runPanelScript();
                panel.postToPanel({ command: 'recipeData', recipe: loadHistoryRecipe(), renderSequence: 1 });
                panel.expandAllTrees();
                panel.treeCards().forEach((treeCard: any) => panel.openTab(treeCard, 'Previously Used Data Sets'));
                // THE ORG CHECK THE TREECIPE TAB STARTED ANSWERS WITH NO ORG SELECTED
                panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: null, noOrgsMessage: '', renderSequence: 1 });
                panel.postedHostMessages.length = 0;

                const insertButton = datasetInsertButtons(panel)[0];
                expect(insertButton.attributes.title).toBe('Choose the org to insert this data set into');
                insertButton.dispatch('click');

                expect(panel.postedHostMessages.at(-1)).not.toHaveProperty('orgIndex');
                expect(panel.postedHostMessages.at(-1).command).toBe('insertDataset');

            });

            it('names the selected org in its tooltip', () => {

                const panel = renderEverythingOpen();

                expect(datasetInsertButtons(panel)[0].attributes.title).toBe('Insert this data set into qa, the org selected in the Target Org Manager');

            });

            it('says Inserting… on the row being inserted, disables every Insert… and the tree inserts while it runs, and gives them back', () => {

                const panel = renderEverythingOpen();
                const runningFolderName = datasetFolderNamesIn(panel, panel.tabPanelOf(cardNamed(panel, LEAD_TREE_KEY), 'treeDatasets'))[0];

                panel.postToPanel({ command: 'insertState', isRunning: true, treeKey: '', datasetFolderName: runningFolderName });

                const buttons = datasetInsertButtons(panel);
                expect(buttons.map((button: any) => button.disabled)).toEqual(buttons.map(() => true));
                expect(buttons[0].textContent).toBe('Inserting…');
                expect(buttons.slice(1).map((button: any) => button.textContent)).toEqual(buttons.slice(1).map(() => 'Insert…'));
                const treeInsertButton = panel.findAll(cardNamed(panel, LEAD_TREE_KEY), 'treeInsert')[0];
                expect(treeInsertButton.disabled).toBe(true);
                expect(panel.findAll(cardNamed(panel, LEAD_TREE_KEY), 'treeInsertReason')[0].textContent).toContain('A data set is being inserted.');

                panel.postToPanel({ command: 'insertState', isRunning: false, treeKey: '', datasetFolderName: runningFolderName });

                expect(datasetInsertButtons(panel).map((button: any) => [button.disabled, button.textContent])).toEqual(buttons.map(() => [false, 'Insert…']));
                expect(treeInsertButton.disabled).toBe(false);

            });

            it('is disabled while the org connections are checked, saying so, and given back when the list arrives', () => {

                const panel = renderEverythingOpen();
                panel.findAll(panel.cockpitBodyElement, 'dataOrgRefresh')[0].dispatch('click');

                expect(datasetInsertButtons(panel).every((button: any) => button.disabled)).toBe(true);
                expect(datasetInsertButtons(panel)[0].attributes.title).toBe(RECIPE_COCKPIT_ORG_CONNECTION_CHECK_INSERT_REASON);

                panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 1 });

                expect(datasetInsertButtons(panel).every((button: any) => !button.disabled)).toBe(true);

            });

            it('names a data set insert, not a tree insert, as what holds the Troubleshooting actions', () => {

                const panel = renderEverythingOpen();
                panel.openTab(cardNamed(panel, LEAD_TREE_KEY), 'Troubleshooting');
                panel.postToPanel({ command: 'insertState', isRunning: true, treeKey: '', datasetFolderName: ADDED_DATASET.datasetFolderName });

                const reasons = panel.findAll(cardNamed(panel, LEAD_TREE_KEY), 'actionCardReason').map((reasonElement: any) => reasonElement.textContent);
                expect(reasons).toContain('A data set is being inserted.');
                expect(reasons).not.toContain('A tree is being inserted.');

            });

            it('is disabled while a tree inserts', () => {

                const panel = renderEverythingOpen();

                panel.postToPanel({ command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY });

                expect(datasetInsertButtons(panel).every((button: any) => button.disabled)).toBe(true);

            });

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

        it('adds the first data set to a tab built empty, with a search box', () => {

            const recipe = loadHistoryRecipe();
            recipe.trees.find((tree: any) => tree.treeKey === LEAD_TREE_KEY).history.datasets = [];
            const panel = renderEverythingOpen(recipe);
            const leadCard = cardNamed(panel, LEAD_TREE_KEY);
            expect(panel.findAll(panel.tabPanelOf(leadCard, 'treeDatasets'), 'tabSearchInput')).toEqual([]);

            postDatasetAdded(panel);

            expect(datasetFolderNamesIn(panel, panel.tabPanelOf(leadCard, 'treeDatasets'))).toEqual([ADDED_DATASET.datasetFolderName]);
            expect(panel.findAll(panel.tabPanelOf(leadCard, 'treeDatasets'), 'tabSearchInput')).toHaveLength(1);
            // THE REBUILT BOX CARRIES ITS MAGNIFIER (#373)
            expect(panel.findAll(panel.tabPanelOf(leadCard, 'treeDatasets'), 'tabSearchField')[0].children[0].attributes.class).toBe('tabSearchIcon');
            expect(panel.findAll(panel.tabPanelOf(leadCard, 'treeDatasets'), 'treeEmpty')).toEqual([]);

        });

        it('lists the data set in a data sets tab first opened after it arrived', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadHistoryRecipe(), renderSequence: 1 });
            panel.expandAllTrees();

            postDatasetAdded(panel);

            const leadCard = cardNamed(panel, LEAD_TREE_KEY);
            panel.openTab(leadCard, 'Previously Used Data Sets');
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
