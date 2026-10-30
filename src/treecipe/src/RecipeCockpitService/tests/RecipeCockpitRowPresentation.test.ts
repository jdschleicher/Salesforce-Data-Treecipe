import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

import {
    IRecipeCockpitDatasetJourneyMessage,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTroubleshootingHistoryMessage,
    RecipeCockpitService
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    #558: the cockpit's row presentation standard. A column table is built ONLY by buildRowTable and
    styled ONLY by sdtRowTable, and a Previously Used Data Sets row is a two-line sdtRowHeader: what a
    reader decides on first (☆, ✎, name, status, actions), then when and how it was made, led by
    the ▸. These tests fail on a table made any other way, a table rule that draws its own cell
    borders, and a data set row that goes back to one line.
*/
const HISTORY_FIXTURE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const LEAD_TREE_KEY = 'Lead-ONLY';
const DATASETS_TAB_LABEL = 'Previously Used Data Sets';

type Panel = ReturnType<typeof runPanelScript>;

const shellHtml = () => RecipeCockpitService.buildWebviewShellHtml('testNonce');
const styleSheetOf = (html: string) => html.substring(html.indexOf('<style nonce="testNonce">'), html.indexOf('</style>'));
const panelScriptOf = (html: string) => html.substring(html.lastIndexOf('<script nonce="testNonce">'), html.lastIndexOf('</script>'));

const functionBodyOf = (scriptText: string, functionName: string) => {
    const start = scriptText.indexOf(`function ${functionName}(`);
    const end = scriptText.indexOf('\n    }\n', start);
    return scriptText.substring(start, end);
};

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(path.join(HISTORY_FIXTURE_ROOT, 'treecipe', 'GeneratedRecipes')),
    HISTORY_FIXTURE_ROOT,
    CURRENT_RUN_FOLDER_NAME
).recipeViewModel;

const journeyMessage = (datasetFolderName: string): IRecipeCockpitDatasetJourneyMessage => ({
    command: 'datasetJourney',
    renderSequence: 3,
    datasetFolderName: datasetFolderName,
    journeySequence: 1,
    attemptCount: 1,
    entries: [{ kind: 'insert', kindLabel: 'Insert', status: 'succeeded', timeLabel: '2026-10-26 10:20:00', summaryText: '4 records saved', files: [] }],
    hiddenEntryCount: 0,
    otherOrgStepCount: 0,
    untrackedStepCount: 0
});

const historyMessage = (treeKey: string): IRecipeCockpitTroubleshootingHistoryMessage => ({
    command: 'troubleshootingHistory',
    renderSequence: 3,
    treeKey: treeKey,
    historySequence: 1,
    rows: [{ step: 'field-deploy', stepLabel: 'Deploy fields & dependencies', status: 'succeeded', timeMs: 1, timeLabel: '2026-10-28 10:00:00', runFolderName: CURRENT_RUN_FOLDER_NAME, files: [] }],
    hiddenRowCount: 0
});

const drawLeadDatasets = (): { panel: Panel; rows: any[] } => {
    const panel = runPanelScript({});
    const recipe = loadRecipe();
    recipe.trees.find(tree => tree.treeKey === LEAD_TREE_KEY)!.history!.datasets[0].lastInsert = { status: 'succeeded', attemptedAtLabel: '2026-10-26 10:20:00 UTC' };
    panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
    panel.postToPanel({ command: 'rendered' });
    const leadCard = panel.treeCards()[1];
    panel.chooseTreeCard(leadCard);
    panel.openTab(leadCard, DATASETS_TAB_LABEL);
    return { panel, rows: panel.findAll(panel.tabPanelOf(leadCard, 'treeDatasets'), 'treeDataset') };
};

describe('RecipeCockpitService, row presentation (#558)', () => {

    describe('the column table', () => {

        it('is made only by buildRowTable: the panel script creates a table, a thead and a th nowhere else', () => {

            const scriptText = panelScriptOf(shellHtml());
            const builderBody = functionBodyOf(scriptText, 'buildRowTable');

            ['table', 'thead', 'th'].forEach(tagName => {
                const pattern = new RegExp(`createElement\\('${tagName}'`, 'g');
                expect({ tagName, count: (scriptText.match(pattern) || []).length }).toEqual({ tagName, count: 1 });
                expect({ tagName, count: (builderBody.match(pattern) || []).length }).toEqual({ tagName, count: 1 });
            });

        });

        it('draws its cell borders, padding and alignment from the sdtRowTable rules alone', () => {

            const ruleSelectors = styleSheetOf(shellHtml())
                .split('}')
                .map(ruleText => ruleText.split('{'))
                .filter(ruleParts => ruleParts.length === 2 && /\bborder\s*:/.test(ruleParts[1]))
                .map(ruleParts => ruleParts[0].trim())
                .filter(selector => /(^|[\s,>])(th|td)\b/.test(selector));

            expect(ruleSelectors).toEqual(['.sdtRowTable th, .sdtRowTable td']);

        });

        it('carries sdtRowTable on the History sub-tab\'s table and on a data set\'s insert journey', () => {

            const { panel, rows } = drawLeadDatasets();
            panel.findAll(rows[0], 'treeDatasetJourneyToggle')[0].dispatch('click');
            panel.postToPanel(journeyMessage(panel.findAll(rows[0], 'treeDatasetFolder')[0].textContent));

            const accountCard = panel.treeCards()[0];
            panel.chooseTreeCard(accountCard);
            panel.openTab(accountCard, 'Troubleshooting');
            panel.findAll(accountCard, 'troubleshootingSubTab').find((tabElement: any) => tabElement.textContent === 'History').dispatch('click');
            panel.postToPanel(historyMessage(loadRecipe().trees[0].treeKey));

            const journeyTables = panel.findAll(rows[0], 'sdtRowTable');
            const historyTables = panel.findAll(accountCard, 'sdtRowTable');
            expect(journeyTables.map((tableElement: any) => tableElement.className)).toEqual(['sdtRowTable treeDatasetJourneyTable']);
            expect(historyTables.map((tableElement: any) => tableElement.className)).toEqual(['sdtRowTable historyTable']);
            [...journeyTables, ...historyTables].forEach((tableElement: any) => {
                expect(tableElement.parentNode.className.split(' ')).toContain('sdtRowTableWrap');
            });

        });

        it('scrolls a wide table inside its wrapper rather than widening the page', () => {

            expect(styleSheetOf(shellHtml())).toContain('.sdtRowTableWrap { overflow: auto; max-width: 100%;');

        });

    });

    describe('a Previously Used Data Sets row', () => {

        it('is two lines: ☆, ✎, the name and the actions first, then the ▸ with when and how it was made', () => {

            const { panel, rows } = drawLeadDatasets();

            expect(rows.length).toBeGreaterThan(0);
            rows.forEach((rowElement: any) => {
                const [header] = panel.findAll(rowElement, 'treeDatasetHeader');
                expect(header.className.split(' ')).toContain('sdtRowHeader');
                expect(header.children.map((lineElement: any) => lineElement.className)).toEqual(['sdtRowHeaderPrimary', 'sdtRowHeaderDetail']);

                const [primaryLine, detailLine] = header.children;
                const hasClass = (element: any, className: string) => element.className.split(' ').includes(className);
                expect(hasClass(primaryLine.children[0], 'treeDatasetFavorite')).toBe(true);
                ['treeDatasetRename', 'treeDatasetName', 'treeDatasetOpen', 'treeDatasetInsert'].forEach(className => {
                    expect({ className, count: panel.findAll(primaryLine, className).length }).toEqual({ className, count: 1 });
                });
                expect(hasClass(detailLine.children[0], 'treeDatasetJourneyToggle')).toBe(true);
                ['treeDatasetDate', 'treeDatasetBackend', 'treeDatasetFolder'].forEach(className => {
                    expect({ className, count: panel.findAll(detailLine, className).length }).toEqual({ className, count: 1 });
                });
                expect(panel.findAll(detailLine, 'treeDatasetInsert')).toEqual([]);
                expect(panel.findAll(primaryLine, 'treeDatasetDate')).toEqual([]);
            });

        });

        it('starts both lines at the same inset, so the ▸ sits under ☆', () => {

            const styleSheet = styleSheetOf(shellHtml());

            expect(styleSheet).toContain('.sdtRowHeaderPrimary, .sdtRowHeaderDetail { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; }');
            expect(styleSheet).not.toMatch(/\.sdtRowHeader(Primary|Detail)\s*\{[^}]*(padding|margin)/);

        });

    });

});
