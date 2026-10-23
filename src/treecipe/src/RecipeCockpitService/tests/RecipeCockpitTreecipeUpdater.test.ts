import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as path from 'path';

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

jest.mock('child_process', () => ({ execFile: jest.fn(), exec: jest.fn() }));

import {
    RecipeCockpitService,
    RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX,
    RECIPE_COCKPIT_OPTIONAL_SEARCH_TABS,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RECIPE_COCKPIT_TREE_TABS,
    RECIPE_COCKPIT_UPDATER_INTRO,
    RECIPE_COCKPIT_UPDATER_LOOKUP_REASON,
    RECIPE_COCKPIT_UPDATER_NO_FIELDS_CHOSEN,
    RECIPE_COCKPIT_UPDATER_NO_RECORDS_LOADED_REASON,
    RECIPE_COCKPIT_UPDATER_RECIPE_ONLY_REASON,
    RECIPE_COCKPIT_UPDATER_RECORD_TYPE_REASON,
    RECIPE_COCKPIT_UPDATER_SYSTEM_VALUE_REASON,
    RECIPE_COCKPIT_UPDATER_PARENT_STEP_HEADING,
    RECIPE_COCKPIT_UPDATER_PARENT_WHERE_NONE_NOTE,
    RECIPE_COCKPIT_UPDATER_PARENT_WHERE_NOTE_PREFIX,
    RECIPE_COCKPIT_UPDATER_PARENT_WHERE_PLACEHOLDER,
    RECIPE_COCKPIT_UPDATER_RETRIEVE_METADATA_LABEL,
    RECIPE_COCKPIT_UPDATER_RETRIEVE_METADATA_PENDING_REASON,
    RECIPE_COCKPIT_UPDATER_SEARCH_PLACEHOLDER,
    RECIPE_COCKPIT_UPDATER_STRUCTURE_STEP_HEADING_PREFIX,
    RECIPE_COCKPIT_UPDATER_TAB_LABEL
} from '../RecipeCockpitService';
import { RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH } from '../RecipeCockpitTreeUpdaterQuery';
import { IPanelScriptOptions, runPanelScript } from './RecipeCockpitPanelHarness';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const TREE_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';

type Panel = ReturnType<typeof runPanelScript>;

const loadTreeRecipe = () => {
    const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
    return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, TREE_RUN_FOLDER_NAME).recipeViewModel;
};

const drawRecipe = (recipe: any, panelScriptOptions: IPanelScriptOptions = {}) => {
    const panel = runPanelScript(panelScriptOptions);
    panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
    panel.postToPanel({ command: 'rendered' });
    panel.expandAllTrees();
    return panel;
};

const accountCardOf = (panel: Panel) => panel.treeCards()
    .find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes('OtherChildObject__c')));

const updaterPanelOf = (panel: Panel, treeCard: any) => panel.findAll(treeCard, 'treeUpdater')[0];

const updaterObjectsOf = (panel: Panel, treeCard: any) => panel.findAll(updaterPanelOf(panel, treeCard), 'updaterObject');

const updaterObjectNamed = (panel: Panel, treeCard: any, objectApiName: string) => updaterObjectsOf(panel, treeCard)
    .find((objectElement: any) => panel.findAll(objectElement, 'updaterObjectName')[0].textContent === objectApiName);

const expandUpdaterObject = (panel: Panel, objectElement: any) => panel.findAll(objectElement.children[0], 'updaterObjectToggle')[0].dispatch('click');

const updaterRowNamed = (panel: Panel, objectElement: any, fieldApiName: string) => panel.findAll(objectElement, 'updaterField')
    .find((rowElement: any) => panel.findAll(rowElement, 'updaterFieldName')[0].textContent === fieldApiName);

const chooseBoxOf = (panel: Panel, rowElement: any) => panel.findAll(rowElement, 'updaterFieldChoose')[0];

const commandsOf = (panel: Panel) => panel.postedHostMessages.map((hostMessage: any) => hostMessage.command);

const openUpdater = (panelScriptOptions: IPanelScriptOptions = {}) => {
    const panel = drawRecipe(loadTreeRecipe(), panelScriptOptions);
    const accountCard = accountCardOf(panel);
    panel.openAdapterStructure(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
    return { panel, accountCard };
};

describe('RecipeCockpitService, the Treecipe Adapter tab (#415)', () => {

    describe('the tab', () => {

        it('is the last tab a saved place can name, keeping its search only when there is one', () => {

            expect(RECIPE_COCKPIT_TREE_TABS).toEqual(['treecipe', 'datasets', 'troubleshooting', 'query', 'updater']);
            expect(RECIPE_COCKPIT_OPTIONAL_SEARCH_TABS).toContain('updater');

        });

        it('is drawn after Query on a card with a folder, and builds nothing until it is opened', () => {

            const panel = drawRecipe(loadTreeRecipe());
            const accountCard = accountCardOf(panel);

            expect(panel.findAll(accountCard, 'treeTab').map((tabElement: any) => tabElement.textContent))
                .toEqual(['Treecipe', 'Previously Used Data Sets', 'Troubleshooting', 'Query', RECIPE_COCKPIT_UPDATER_TAB_LABEL]);
            expect(updaterPanelOf(panel, accountCard).children).toEqual([]);

            panel.openAdapterStructure(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);

            expect(panel.isHidden(updaterPanelOf(panel, accountCard))).toBe(false);
            expect(panel.findAll(updaterPanelOf(panel, accountCard), 'updaterIntro')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_INTRO);
            expect(panel.findAll(updaterPanelOf(panel, accountCard), 'updaterSummary')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_NO_FIELDS_CHOSEN);

        });

        it('is not drawn on a card with no folder', () => {

            const recipe = loadTreeRecipe();
            recipe.trees.forEach((tree: any) => { delete tree.folderName; });
            const panel = drawRecipe(recipe);

            panel.treeCards().forEach((treeCard: any) => {
                expect(panel.findAll(treeCard, 'treeTab').map((tabElement: any) => tabElement.textContent)).not.toContain(RECIPE_COCKPIT_UPDATER_TAB_LABEL);
            });

        });

        it('draws each object once, in insert order, with its lookups, and none of the Treecipe tab\'s controls', () => {

            const { panel, accountCard } = openUpdater();
            const updaterPanel = updaterPanelOf(panel, accountCard);

            const objectNames = updaterObjectsOf(panel, accountCard).map((objectElement: any) => panel.findAll(objectElement, 'updaterObjectName')[0].textContent);
            const treecipeObjectNames = panel.findAll(panel.findAll(accountCard, 'treeStructure')[0], 'treeObjectName')
                .map((nameElement: any) => nameElement.textContent);
            expect(objectNames).toEqual(treecipeObjectNames.filter((objectName: string, index: number) => treecipeObjectNames.indexOf(objectName) === index));
            expect(objectNames).toEqual(['Account', 'Contact', 'OtherChildObject__c']);

            const contactObject = updaterObjectNamed(panel, accountCard, 'Contact');
            expect(panel.findAll(contactObject, 'treeLookups')[0].textContent).toBe('(AccountId → Account)');

            ['treeObjectInclude', 'treeRecordCountInput', 'treeFieldInclude', 'treeFieldFixedValue', 'treeObject'].forEach(className => {
                expect(panel.findAll(updaterPanel, className)).toEqual([]);
            });

        });

        it('builds an object\'s rows on its first expand, each with its sized type and its faker expression', () => {

            const { panel, accountCard } = openUpdater();
            const accountObject = updaterObjectNamed(panel, accountCard, 'Account');

            expect(panel.findAll(accountObject, 'updaterField')).toEqual([]);

            expandUpdaterObject(panel, accountObject);

            const legacyCodeRow = updaterRowNamed(panel, accountObject, 'Legacy_Code__c');
            expect(panel.findAll(legacyCodeRow, 'fieldType')[0].textContent).toMatch(/^Text/);
            expect(panel.findAll(legacyCodeRow, 'expression')).toHaveLength(1);
            expect(panel.findAll(accountObject.children[0], 'updaterObjectToggle')[0].attributes['aria-expanded']).toBe('true');

        });

    });

    describe('choosing a field', () => {

        it('ticks and unticks a field, says what is chosen, and posts no command for it', () => {

            const { panel, accountCard } = openUpdater();
            const accountObject = updaterObjectNamed(panel, accountCard, 'Account');
            expandUpdaterObject(panel, accountObject);
            const commandsBefore = commandsOf(panel).length;

            const chooseBox = chooseBoxOf(panel, updaterRowNamed(panel, accountObject, 'Legacy_Code__c'));
            expect(chooseBox.attributes.role).toBe('checkbox');
            expect(chooseBox.attributes['aria-checked']).toBe('false');
            expect(chooseBox.className).toContain('sdtButton-check');

            chooseBox.dispatch('click');

            expect(chooseBox.attributes['aria-checked']).toBe('true');
            expect(chooseBox.textContent).toBe('✓');
            expect(panel.findAll(updaterPanelOf(panel, accountCard), 'updaterSummary')[0].textContent).toBe('1 field chosen on 1 object');
            expect(panel.findAll(accountObject.children[0], 'updaterObjectCount')[0].textContent).toMatch(/· 1 chosen$/);

            chooseBox.dispatch('click');

            expect(chooseBox.attributes['aria-checked']).toBe('false');
            expect(panel.findAll(updaterPanelOf(panel, accountCard), 'updaterSummary')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_NO_FIELDS_CHOSEN);
            expect(commandsOf(panel).slice(commandsBefore).every((command: string) => command === 'savePlace')).toBe(true);

        });

        it('counts the fields chosen across objects', () => {

            const { panel, accountCard } = openUpdater();
            const accountObject = updaterObjectNamed(panel, accountCard, 'Account');
            const otherObject = updaterObjectNamed(panel, accountCard, 'OtherChildObject__c');
            expandUpdaterObject(panel, accountObject);
            expandUpdaterObject(panel, otherObject);

            chooseBoxOf(panel, updaterRowNamed(panel, accountObject, 'Legacy_Code__c')).dispatch('click');
            chooseBoxOf(panel, updaterRowNamed(panel, accountObject, 'Annual_Budget__c')).dispatch('click');
            chooseBoxOf(panel, updaterRowNamed(panel, otherObject, 'Score__c')).dispatch('click');

            expect(panel.findAll(updaterPanelOf(panel, accountCard), 'updaterSummary')[0].textContent).toBe('3 fields chosen on 2 objects');

        });

        it('disables the box of a lookup, a dependent picklist, RecordTypeId and a field read only from the recipe file, saying why', () => {

            const { panel, accountCard } = openUpdater();
            const accountObject = updaterObjectNamed(panel, accountCard, 'Account');
            const contactObject = updaterObjectNamed(panel, accountCard, 'Contact');
            expandUpdaterObject(panel, accountObject);
            expandUpdaterObject(panel, contactObject);

            const expectLocked = (rowElement: any, reason: string) => {
                const chooseBox = chooseBoxOf(panel, rowElement);
                expect(chooseBox.disabled).toBe(true);
                expect(chooseBox.attributes.title).toBe('Cannot be chosen: ' + reason);
                expect(panel.findAll(rowElement, 'updaterFieldNote')[0].textContent).toBe(reason);
                chooseBox.dispatch('click');
                expect(chooseBox.attributes['aria-checked']).toBe('false');
            };

            expectLocked(updaterRowNamed(panel, accountObject, 'ParentId'), RECIPE_COCKPIT_UPDATER_LOOKUP_REASON);
            expectLocked(updaterRowNamed(panel, accountObject, 'OwnerId'), RECIPE_COCKPIT_UPDATER_LOOKUP_REASON);
            expectLocked(updaterRowNamed(panel, contactObject, 'AccountId'), RECIPE_COCKPIT_UPDATER_LOOKUP_REASON);
            expectLocked(updaterRowNamed(panel, accountObject, 'Sub_Rating__c'), RECIPE_COCKPIT_FIXED_VALUE_DEPENDENT_REASON_PREFIX + 'Rating__c');

            const recipe = loadTreeRecipe();
            const accountModel: any = recipe.objects.find((object: any) => object.objectApiName === 'Account');
            const recipeOnlyField = accountModel.fields.find((field: any) => field.isOnlyInRecipeFile && field.fieldApiName !== 'RecordTypeId');
            expect(recipeOnlyField).toBeDefined();
            expectLocked(updaterRowNamed(panel, accountObject, recipeOnlyField.fieldApiName), RECIPE_COCKPIT_UPDATER_RECIPE_ONLY_REASON);

            expect(panel.findAll(updaterPanelOf(panel, accountCard), 'updaterSummary')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_NO_FIELDS_CHOSEN);

        });

        it('locks an auto number and a roll-up summary, whose values Salesforce sets', () => {

            const recipe = loadTreeRecipe();
            const accountModel: any = recipe.objects.find((object: any) => object.objectApiName === 'Account');
            accountModel.fields.push({ fieldApiName: 'Account_Number__c', fieldType: 'AutoNumber', fieldLabel: 'Account Number', fieldTypeWithSize: 'AutoNumber', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false });
            accountModel.fields.push({ fieldApiName: 'Total_Score__c', fieldType: 'Summary', fieldLabel: 'Total Score', fieldTypeWithSize: 'Summary', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false });

            const panel = drawRecipe(recipe);
            const accountCard = accountCardOf(panel);
            panel.openAdapterStructure(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
            const accountObject = updaterObjectNamed(panel, accountCard, 'Account');
            expandUpdaterObject(panel, accountObject);

            ['Account_Number__c', 'Total_Score__c'].forEach(fieldApiName => {
                const rowElement = updaterRowNamed(panel, accountObject, fieldApiName);
                expect(chooseBoxOf(panel, rowElement).disabled).toBe(true);
                expect(panel.findAll(rowElement, 'updaterFieldNote')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_SYSTEM_VALUE_REASON);
            });

        });

        it('draws a field\'s label beside its name when the two differ', () => {

            const recipe = loadTreeRecipe();
            const accountModel: any = recipe.objects.find((object: any) => object.objectApiName === 'Account');
            accountModel.fields.push({ fieldApiName: 'Region_Code__c', fieldType: 'Text', fieldLabel: 'Region code', fieldTypeWithSize: 'Text(10)', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false });
            accountModel.fields.push({ fieldApiName: 'Same', fieldType: 'Text', fieldLabel: 'Same', fieldTypeWithSize: 'Text', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false });

            const panel = drawRecipe(recipe);
            const accountCard = accountCardOf(panel);
            panel.openAdapterStructure(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
            const accountObject = updaterObjectNamed(panel, accountCard, 'Account');
            expandUpdaterObject(panel, accountObject);

            expect(panel.findAll(updaterRowNamed(panel, accountObject, 'Region_Code__c'), 'updaterFieldLabel').map((labelElement: any) => labelElement.textContent)).toEqual(['Region code']);
            expect(panel.findAll(updaterRowNamed(panel, accountObject, 'Same'), 'updaterFieldLabel')).toEqual([]);

            panel.typeIntoTabSearch(accountCard, 'treeUpdater', 'region code');
            expect(panel.isHidden(updaterRowNamed(panel, accountObject, 'Region_Code__c'))).toBe(false);

        });

        it('locks RecordTypeId as the record type, even where the wrapper lists it', () => {

            const recipe = loadTreeRecipe();
            const accountModel: any = recipe.objects.find((object: any) => object.objectApiName === 'Account');
            accountModel.fields.push({ fieldApiName: 'RecordTypeId', fieldType: 'Text', lineNumber: 1 });

            const panel = drawRecipe(recipe);
            const accountCard = accountCardOf(panel);
            panel.openAdapterStructure(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
            const accountObject = updaterObjectNamed(panel, accountCard, 'Account');
            expandUpdaterObject(panel, accountObject);

            const recordTypeRows = panel.findAll(accountObject, 'updaterField')
                .filter((rowElement: any) => panel.findAll(rowElement, 'updaterFieldName')[0].textContent === 'RecordTypeId');
            const wrapperRecordTypeRow = recordTypeRows[recordTypeRows.length - 1];
            expect(chooseBoxOf(panel, wrapperRecordTypeRow).disabled).toBe(true);
            expect(panel.findAll(wrapperRecordTypeRow, 'updaterFieldNote')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_RECORD_TYPE_REASON);

        });

        it('writes a field name from the model as text, never as markup', () => {

            const recipe = loadTreeRecipe();
            const accountModel: any = recipe.objects.find((object: any) => object.objectApiName === 'Account');
            accountModel.fields.push({ fieldApiName: '<img src=x onerror=alert(1)>', fieldType: 'Text', recipeValue: '<script>x</script>' });

            const panel = drawRecipe(recipe);
            const accountCard = accountCardOf(panel);
            panel.openAdapterStructure(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
            const accountObject = updaterObjectNamed(panel, accountCard, 'Account');
            expandUpdaterObject(panel, accountObject);

            const hostileRow = updaterRowNamed(panel, accountObject, '<img src=x onerror=alert(1)>');
            expect(panel.findAll(hostileRow, 'expression')[0].textContent).toBe('<script>x</script>');
            expect(panel.findAll(hostileRow, 'img')).toEqual([]);

        });

    });

    describe('names from a hand-edited wrapper or a saved place', () => {

        it('keeps an object or field named __proto__ or constructor an ordinary name, chosen, saved and restored', () => {

            const recipe = loadTreeRecipe();
            const accountModel: any = recipe.objects.find((object: any) => object.objectApiName === 'Account');
            accountModel.fields.push({ fieldApiName: '__proto__', fieldType: 'Text', fieldLabel: '', fieldTypeWithSize: 'Text', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false });
            accountModel.fields.push({ fieldApiName: 'constructor', fieldType: 'Text', fieldLabel: '', fieldTypeWithSize: 'Text', recipeValue: '', controllingField: '', isOnlyInRecipeFile: false });

            const panel = drawRecipe(recipe);
            const accountCard = accountCardOf(panel);
            panel.openAdapterStructure(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
            const accountObject = updaterObjectNamed(panel, accountCard, 'Account');
            expandUpdaterObject(panel, accountObject);

            ['__proto__', 'constructor'].forEach(fieldApiName => {
                const chooseBox = chooseBoxOf(panel, updaterRowNamed(panel, accountObject, fieldApiName));
                expect(chooseBox.attributes['aria-checked']).toBe('false');
                chooseBox.dispatch('click');
                expect(chooseBox.attributes['aria-checked']).toBe('true');
            });
            expect(({} as any).polluted).toBeUndefined();
            expect(panel.findAll(updaterPanelOf(panel, accountCard), 'updaterSummary')[0].textContent).toBe('2 fields chosen on 1 object');

            const savedPlace = panel.savedState();
            const savedTree = savedPlace.trees.find((treePlace: any) => treePlace.treeKey === ACCOUNT_TREE_KEY);
            expect(savedTree.updaterChosenFieldKeys).toEqual(['Account\n__proto__', 'Account\nconstructor']);
            savedTree.updaterExpandedObjectKeys = ['__proto__', 'constructor', 'Account'];

            const restoredPanel = drawRecipe(recipe, { savedState: savedPlace });
            const restoredCard = accountCardOf(restoredPanel);
            const restoredAccount = updaterObjectNamed(restoredPanel, restoredCard, 'Account');
            expect(restoredPanel.isHidden(restoredAccount.children[1])).toBe(false);
            expect(chooseBoxOf(restoredPanel, updaterRowNamed(restoredPanel, restoredAccount, '__proto__')).attributes['aria-checked']).toBe('true');
            expect(updaterObjectsOf(restoredPanel, restoredCard)).toHaveLength(3);

        });

    });

    describe('its search', () => {

        it('narrows rows by field name, label or type, never hides an object, and counts what matches', () => {

            const { panel, accountCard } = openUpdater();
            const updaterPanel = updaterPanelOf(panel, accountCard);

            panel.typeIntoTabSearch(accountCard, 'treeUpdater', 'score');

            expect(updaterObjectsOf(panel, accountCard)).toHaveLength(3);
            const otherObject = updaterObjectNamed(panel, accountCard, 'OtherChildObject__c');
            const accountObject = updaterObjectNamed(panel, accountCard, 'Account');
            expect(panel.isHidden(otherObject.children[1])).toBe(false);
            expect(panel.isHidden(updaterRowNamed(panel, otherObject, 'Score__c'))).toBe(false);
            expect(panel.isHidden(updaterRowNamed(panel, otherObject, 'Ratio__c'))).toBe(true);
            expect(panel.findAll(accountObject.children[0], 'updaterObjectCount')[0].textContent).toBe('no matching fields');
            expect(panel.findAll(updaterPanel, 'tabMatchCount')[0].textContent).toMatch(/^1 of \d+ fields$/);

            panel.typeIntoTabSearch(accountCard, 'treeUpdater', 'percent');
            expect(panel.isHidden(updaterRowNamed(panel, otherObject, 'Ratio__c'))).toBe(false);

            panel.typeIntoTabSearch(accountCard, 'treeUpdater', '');
            expect(panel.isHidden(otherObject.children[1])).toBe(true);

        });

        it('opens and closes nothing when a box is ticked during a search, so a row the reader closed stays closed', () => {

            const { panel, accountCard } = openUpdater();

            panel.typeIntoTabSearch(accountCard, 'treeUpdater', 'e');
            const accountObject = updaterObjectNamed(panel, accountCard, 'Account');
            const otherObject = updaterObjectNamed(panel, accountCard, 'OtherChildObject__c');
            expect(panel.isHidden(accountObject.children[1])).toBe(false);
            expect(panel.isHidden(otherObject.children[1])).toBe(false);

            expandUpdaterObject(panel, otherObject);
            expect(panel.isHidden(otherObject.children[1])).toBe(true);

            chooseBoxOf(panel, updaterRowNamed(panel, accountObject, 'Legacy_Code__c')).dispatch('click');

            expect(panel.isHidden(otherObject.children[1])).toBe(true);
            expect(panel.findAll(accountObject.children[0], 'updaterObjectCount')[0].textContent).toMatch(/ · 1 chosen$/);
            expect(panel.findAll(updaterPanelOf(panel, accountCard), 'updaterSummary')[0].textContent).toBe('1 field chosen on 1 object');

        });

        it('matches the faker expression the row draws', () => {

            const recipe = loadTreeRecipe();
            const accountModel: any = recipe.objects.find((object: any) => object.objectApiName === 'Account');
            accountModel.fields.push({ fieldApiName: 'Motto__c', fieldType: 'Text', fieldLabel: 'Motto', fieldTypeWithSize: 'Text', recipeValue: '${{ faker.company.catchPhrase() }}', controllingField: '', isOnlyInRecipeFile: false });

            const panel = drawRecipe(recipe);
            const accountCard = accountCardOf(panel);
            panel.openAdapterStructure(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);

            panel.typeIntoTabSearch(accountCard, 'treeUpdater', 'catchphrase');

            const accountObject = updaterObjectNamed(panel, accountCard, 'Account');
            expect(panel.isHidden(updaterRowNamed(panel, accountObject, 'Motto__c'))).toBe(false);
            expect(panel.isHidden(updaterRowNamed(panel, accountObject, 'Legacy_Code__c'))).toBe(true);

        });

        it('leaves the Treecipe tab\'s search alone', () => {

            const { panel, accountCard } = openUpdater();

            panel.typeIntoTabSearch(accountCard, 'treeUpdater', 'score');

            expect(panel.findAll(panel.findAll(accountCard, 'treeStructure')[0], 'tabSearchInput')[0].value).toBe('');

        });

    });

    describe('the place', () => {

        it('saves the tab, its search, the chosen fields and the opened objects, and restores them in the next document', () => {

            const { panel, accountCard } = openUpdater();
            const accountObject = updaterObjectNamed(panel, accountCard, 'Account');
            expandUpdaterObject(panel, accountObject);
            chooseBoxOf(panel, updaterRowNamed(panel, accountObject, 'Legacy_Code__c')).dispatch('click');
            panel.typeIntoTabSearch(accountCard, 'treeUpdater', 'legacy');

            const savedPlace = panel.savedState();
            const savedTree = savedPlace.trees.find((treePlace: any) => treePlace.treeKey === ACCOUNT_TREE_KEY);
            expect(savedTree).toMatchObject({
                selectedTab: 'updater',
                updaterChosenFieldKeys: ['Account\nLegacy_Code__c'],
                updaterExpandedObjectKeys: ['Account']
            });
            expect(savedTree.searchQueries.updater).toBe('legacy');

            const restoredPanel = drawRecipe(loadTreeRecipe(), { savedState: savedPlace });
            const restoredCard = accountCardOf(restoredPanel);
            const restoredAccount = updaterObjectNamed(restoredPanel, restoredCard, 'Account');

            expect(restoredPanel.isHidden(updaterPanelOf(restoredPanel, restoredCard))).toBe(false);
            expect(chooseBoxOf(restoredPanel, updaterRowNamed(restoredPanel, restoredAccount, 'Legacy_Code__c')).attributes['aria-checked']).toBe('true');
            expect(restoredPanel.findAll(updaterPanelOf(restoredPanel, restoredCard), 'tabSearchInput')[0].value).toBe('legacy');
            expect(restoredPanel.findAll(updaterPanelOf(restoredPanel, restoredCard), 'updaterSummary')[0].textContent).toBe('1 field chosen on 1 object');

        });

        it('drops a saved choice of a field whose box is locked, or that the tree no longer has, and an opened object the tree no longer has', () => {

            const { panel } = openUpdater();
            const savedPlace = panel.savedState();
            const savedTree = savedPlace.trees.find((treePlace: any) => treePlace.treeKey === ACCOUNT_TREE_KEY);
            savedTree.updaterChosenFieldKeys = ['Account\nParentId', 'Account\nGone__c', 'Contact\nLastName'];
            savedTree.updaterExpandedObjectKeys = ['Gone__c'];

            const restoredPanel = drawRecipe(loadTreeRecipe(), { savedState: savedPlace });
            const restoredCard = accountCardOf(restoredPanel);

            expect(restoredPanel.findAll(updaterPanelOf(restoredPanel, restoredCard), 'updaterSummary')[0].textContent).toBe('1 field chosen on 1 object');
            const restoredAccount = updaterObjectNamed(restoredPanel, restoredCard, 'Account');
            const restoredContact = updaterObjectNamed(restoredPanel, restoredCard, 'Contact');
            expandUpdaterObject(restoredPanel, restoredAccount);
            expandUpdaterObject(restoredPanel, restoredContact);
            expect(chooseBoxOf(restoredPanel, updaterRowNamed(restoredPanel, restoredAccount, 'ParentId')).attributes['aria-checked']).toBe('false');
            expect(chooseBoxOf(restoredPanel, updaterRowNamed(restoredPanel, restoredContact, 'LastName')).attributes['aria-checked']).toBe('true');
            const restoredTree = restoredPanel.savedState().trees.find((treePlace: any) => treePlace.treeKey === ACCOUNT_TREE_KEY);
            expect(restoredTree.updaterChosenFieldKeys).toEqual(['Contact\nLastName']);
            expect(restoredTree.updaterExpandedObjectKeys).toEqual(['Account', 'Contact']);

        });

        it('keeps the Updater\'s fields on the host only when each is a list with a name, and the place version did not change', () => {

            const treePlace = (extraFields: Record<string, unknown>) => ({
                version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
                runFolderName: TREE_RUN_FOLDER_NAME,
                scrollY: 0,
                trees: [{ treeKey: ACCOUNT_TREE_KEY, isExpanded: true, selectedTab: 'updater', searchQueries: { treecipe: '', datasets: '', updater: 'score' }, expandedObjectKeys: [], openPicklistKeys: [], ...extraFields }]
            });

            const normalizedTree = RecipeCockpitService.normalizePanelPlace(treePlace({
                updaterChosenFieldKeys: ['Account\nLegacy_Code__c', 7, ''],
                updaterExpandedObjectKeys: ['Account']
            }))?.trees[0];
            expect(normalizedTree).toMatchObject({
                selectedTab: 'updater',
                searchQueries: { updater: 'score' },
                updaterChosenFieldKeys: ['Account\nLegacy_Code__c'],
                updaterExpandedObjectKeys: ['Account']
            });

            const olderTree = RecipeCockpitService.normalizePanelPlace(treePlace({ updaterChosenFieldKeys: 'Account\nLegacy_Code__c', updaterExpandedObjectKeys: [] }))?.trees[0];
            expect(olderTree).not.toHaveProperty('updaterChosenFieldKeys');
            expect(olderTree).not.toHaveProperty('updaterExpandedObjectKeys');

            const withoutSearch = RecipeCockpitService.normalizePanelPlace(treePlace({}));
            expect(withoutSearch?.version).toBe(RECIPE_COCKPIT_PANEL_PLACE_VERSION);
            const noUpdaterSearch = { ...treePlace({}), trees: [{ ...treePlace({}).trees[0], searchQueries: { treecipe: '', datasets: '' } }] };
            expect(RecipeCockpitService.normalizePanelPlace(noUpdaterSearch)?.trees[0].searchQueries).not.toHaveProperty('updater');

        });

    });

    describe('the two steps (#443)', () => {

        const parentStepOf = (panel: Panel, treeCard: any) => panel.findAll(updaterPanelOf(panel, treeCard), 'updaterParentStep')[0];
        const structureStepOf = (panel: Panel, treeCard: any) => panel.findAll(updaterPanelOf(panel, treeCard), 'updaterStructureStep')[0];
        const parentSelectOf = (panel: Panel, treeCard: any) => panel.findAll(parentStepOf(panel, treeCard), 'updaterParentSelect')[0];
        const parentWhereOf = (panel: Panel, treeCard: any) => panel.findAll(parentStepOf(panel, treeCard), 'updaterParentWhereInput')[0];
        const optionLabelsOf = (selectElement: any) => selectElement.children.map((optionElement: any) => optionElement.textContent);
        const drawnObjectNamesOf = (panel: Panel, treeCard: any) => updaterObjectsOf(panel, treeCard)
            .map((objectElement: any) => panel.findAll(objectElement, 'updaterObjectName')[0].textContent);

        const openParentStep = (panelScriptOptions: IPanelScriptOptions = {}) => {
            const panel = drawRecipe(loadTreeRecipe(), panelScriptOptions);
            const accountCard = accountCardOf(panel);
            panel.openTab(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);
            return { panel, accountCard };
        };

        const chooseParent = (panel: Panel, treeCard: any, objectApiName: string, whereText?: string) => {
            const selectElement = parentSelectOf(panel, treeCard);
            selectElement.value = String(optionLabelsOf(selectElement).indexOf(objectApiName));
            if (whereText !== undefined) {
                const whereElement = parentWhereOf(panel, treeCard);
                whereElement.value = whereText;
                whereElement.dispatch('input');
            }
            panel.findAll(parentStepOf(panel, treeCard), 'updaterNext')[0].dispatch('click');
        };

        it('opens on step 1, listing the card\'s objects once each in insert order and starting on the root, and draws no object yet', () => {

            const { panel, accountCard } = openParentStep();
            const parentStep = parentStepOf(panel, accountCard);

            expect(panel.isHidden(parentStep)).toBe(false);
            expect(panel.isHidden(structureStepOf(panel, accountCard))).toBe(true);
            expect(panel.findAll(parentStep, 'updaterStepHeading')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_PARENT_STEP_HEADING);
            expect(optionLabelsOf(parentSelectOf(panel, accountCard))).toEqual(['Account', 'Contact', 'OtherChildObject__c']);
            expect(parentSelectOf(panel, accountCard).value).toBe('0');
            expect(parentWhereOf(panel, accountCard).attributes.placeholder).toBe(RECIPE_COCKPIT_UPDATER_PARENT_WHERE_PLACEHOLDER);
            expect(panel.findAll(parentStep, 'updaterNext')[0].className).toBe('sdtButton sdtButton-primary updaterNext');
            expect(updaterObjectsOf(panel, accountCard)).toEqual([]);

        });

        it('draws the root and every descendant on Next, posting nothing', () => {

            const { panel, accountCard } = openParentStep();
            const commandsBefore = commandsOf(panel).filter((command: string) => command !== 'savePlace').length;

            chooseParent(panel, accountCard, 'Account');

            expect(panel.isHidden(parentStepOf(panel, accountCard))).toBe(true);
            expect(panel.isHidden(structureStepOf(panel, accountCard))).toBe(false);
            expect(drawnObjectNamesOf(panel, accountCard)).toEqual(['Account', 'Contact', 'OtherChildObject__c']);
            expect(panel.findAll(structureStepOf(panel, accountCard), 'updaterStepHeading')[0].textContent)
                .toBe(RECIPE_COCKPIT_UPDATER_STRUCTURE_STEP_HEADING_PREFIX + 'Account');
            expect(commandsOf(panel).filter((command: string) => command !== 'savePlace')).toHaveLength(commandsBefore);

        });

        it('roots the tree at a child, drawing it and its descendants only, and a leaf alone', () => {

            const { panel, accountCard } = openParentStep();

            chooseParent(panel, accountCard, 'Contact');
            expect(drawnObjectNamesOf(panel, accountCard)).toEqual(['Contact', 'OtherChildObject__c']);

            panel.findAll(structureStepOf(panel, accountCard), 'updaterChangeParent')[0].dispatch('click');
            chooseParent(panel, accountCard, 'OtherChildObject__c');
            expect(drawnObjectNamesOf(panel, accountCard)).toEqual(['OtherChildObject__c']);

        });

        it('never follows a self-lookup, so a child pointing only at itself is not under another parent', () => {

            const recipe = loadTreeRecipe();
            const accountCardModel: any = recipe.trees.find((tree: any) => tree.treeKey === ACCOUNT_TREE_KEY);
            const contactTreeObject = accountCardModel.objects.find((treeObject: any) => treeObject.objectApiName === 'Contact');
            contactTreeObject.parentLookups = [{ fieldApiName: 'ReportsToId', parentObjectApiName: 'Contact' }];
            const otherTreeObject = accountCardModel.objects.find((treeObject: any) => treeObject.objectApiName === 'OtherChildObject__c');
            otherTreeObject.parentLookups = [{ fieldApiName: 'Contact__c', parentObjectApiName: 'Contact' }];

            const panel = drawRecipe(recipe);
            const accountCard = accountCardOf(panel);
            panel.openAdapterStructure(accountCard, RECIPE_COCKPIT_UPDATER_TAB_LABEL);

            expect(drawnObjectNamesOf(panel, accountCard)).toEqual(['Account']);

        });

        it('goes back to step 1 with Change parent, keeping the parent and the WHERE typed, and keeps a choice on an object step 2 no longer draws', () => {

            const { panel, accountCard } = openParentStep();
            chooseParent(panel, accountCard, 'Account', 'Name LIKE \'Acme%\'');
            const contactObject = updaterObjectNamed(panel, accountCard, 'Contact');
            expandUpdaterObject(panel, contactObject);
            chooseBoxOf(panel, updaterRowNamed(panel, contactObject, 'LastName')).dispatch('click');

            panel.findAll(structureStepOf(panel, accountCard), 'updaterChangeParent')[0].dispatch('click');

            expect(panel.isHidden(parentStepOf(panel, accountCard))).toBe(false);
            expect(parentSelectOf(panel, accountCard).value).toBe('0');
            expect(parentWhereOf(panel, accountCard).value).toBe('Name LIKE \'Acme%\'');

            chooseParent(panel, accountCard, 'OtherChildObject__c');
            expect(panel.findAll(updaterPanelOf(panel, accountCard), 'updaterSummary')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_NO_FIELDS_CHOSEN);

            panel.findAll(structureStepOf(panel, accountCard), 'updaterChangeParent')[0].dispatch('click');
            chooseParent(panel, accountCard, 'Account');
            expect(panel.findAll(updaterPanelOf(panel, accountCard), 'updaterSummary')[0].textContent).toBe('1 field chosen on 1 object');

        });

        it('draws the filter with the retrieve button beside it, disabled until it is wired, and says the parent records the WHERE asks for', () => {

            const { panel, accountCard } = openParentStep();
            chooseParent(panel, accountCard, 'Account');
            const structureStep = structureStepOf(panel, accountCard);
            const filterRow = panel.findAll(structureStep, 'updaterFilterRow')[0];

            expect(panel.findAll(filterRow, 'tabSearchInput')[0].attributes.placeholder).toBe(RECIPE_COCKPIT_UPDATER_SEARCH_PLACEHOLDER);
            const retrieveButton = panel.findAll(filterRow, 'updaterRetrieveMetadata')[0];
            expect(retrieveButton.textContent).toBe(RECIPE_COCKPIT_UPDATER_RETRIEVE_METADATA_LABEL);
            expect(retrieveButton.disabled).toBe(true);
            expect(retrieveButton.attributes.title).toBe(RECIPE_COCKPIT_UPDATER_RETRIEVE_METADATA_PENDING_REASON);
            expect(retrieveButton.className).toBe('sdtButton sdtButton-secondary updaterRetrieveMetadata');
            expect(panel.findAll(structureStep, 'updaterParentWhereNote')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_PARENT_WHERE_NONE_NOTE);

            panel.findAll(structureStep, 'updaterChangeParent')[0].dispatch('click');
            chooseParent(panel, accountCard, 'Account', ' Name = \'Acme\' ');

            expect(panel.findAll(structureStep, 'updaterParentWhereNote')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_PARENT_WHERE_NOTE_PREFIX + 'Name = \'Acme\'');

        });

        it('loads only the objects step 2 draws, the parent with step 1\'s WHERE and no WHERE box of its own', () => {

            const { panel, accountCard } = openParentStep();
            chooseParent(panel, accountCard, 'Contact', 'LastName = \'Smith\'');
            const contactObject = updaterObjectNamed(panel, accountCard, 'Contact');
            const otherObject = updaterObjectNamed(panel, accountCard, 'OtherChildObject__c');
            expandUpdaterObject(panel, contactObject);
            expandUpdaterObject(panel, otherObject);

            expect(panel.findAll(contactObject, 'updaterWhereInput')).toEqual([]);
            const otherWhere = panel.findAll(otherObject, 'updaterWhereInput')[0];
            otherWhere.value = 'Name != null';
            otherWhere.dispatch('input');

            panel.findAll(updaterPanelOf(panel, accountCard), 'updaterLoad')[0].dispatch('click');

            const loadMessage = panel.postedHostMessages.find((hostMessage: any) => hostMessage.command === 'loadUpdaterRecords');
            expect(loadMessage.parentObjectApiName).toBe('Contact');
            expect(loadMessage.objects.map((object: any) => [object.objectApiName, object.whereClause]))
                .toEqual([['Contact', 'LastName = \'Smith\''], ['OtherChildObject__c', 'Name != null']]);

        });

        it('disables Generate values and Update records with the reason when the last load read 0 records (#444)', () => {

            const { panel, accountCard } = openParentStep();
            chooseParent(panel, accountCard, 'Account', 'Name = \'Nobody\'');
            panel.postToPanel({
                command: 'updaterRecords', renderSequence: 1, treeKey: ACCOUNT_TREE_KEY, orgLabel: 'qa',
                objects: ['Account', 'Contact', 'OtherChildObject__c'].map(objectApiName => ({ objectApiName, totalSize: 0, recordCount: 0, isTruncated: false, columns: [], rows: [], hiddenColumnCount: 0 }))
            });

            ['updaterGenerate', 'updaterUpdate'].forEach(cardClassName => {
                const cardElement = panel.findAll(updaterPanelOf(panel, accountCard), cardClassName)[0];
                expect(cardElement.disabled).toBe(true);
                expect(panel.findAll(cardElement, 'actionCardReason')[0].textContent).toBe(RECIPE_COCKPIT_UPDATER_NO_RECORDS_LOADED_REASON);
            });

        });

        it('keeps the step, the parent and its WHERE in the place, and restores them in the next document', () => {

            const { panel, accountCard } = openParentStep();
            chooseParent(panel, accountCard, 'Contact', 'LastName = \'Smith\'');

            const savedPlace = panel.savedState();
            const savedTree = savedPlace.trees.find((treePlace: any) => treePlace.treeKey === ACCOUNT_TREE_KEY);
            expect(savedTree).toMatchObject({ selectedTab: 'updater', updaterStep: 'structure', updaterParentObjectApiName: 'Contact', updaterParentWhereText: 'LastName = \'Smith\'' });
            expect(savedPlace.version).toBe(RECIPE_COCKPIT_PANEL_PLACE_VERSION);

            const restoredPanel = drawRecipe(loadTreeRecipe(), { savedState: savedPlace });
            const restoredCard = accountCardOf(restoredPanel);

            expect(restoredPanel.isHidden(structureStepOf(restoredPanel, restoredCard))).toBe(false);
            expect(drawnObjectNamesOf(restoredPanel, restoredCard)).toEqual(['Contact', 'OtherChildObject__c']);
            expect(parentWhereOf(restoredPanel, restoredCard).value).toBe('LastName = \'Smith\'');
            expect(parentSelectOf(restoredPanel, restoredCard).value).toBe('1');

        });

        it('keeps step 1 and the WHERE typed in the place before Next', () => {

            const { panel, accountCard } = openParentStep();
            const whereElement = parentWhereOf(panel, accountCard);
            whereElement.value = 'Industry = \'Energy\'';
            whereElement.dispatch('input');

            const restoredPanel = drawRecipe(loadTreeRecipe(), { savedState: panel.savedState() });
            const restoredCard = accountCardOf(restoredPanel);

            expect(restoredPanel.isHidden(parentStepOf(restoredPanel, restoredCard))).toBe(false);
            expect(parentWhereOf(restoredPanel, restoredCard).value).toBe('Industry = \'Energy\'');

        });

        it('opens a place saved before the steps, or naming a parent the card no longer lists, on step 1 at the root', () => {

            const { panel } = openParentStep();
            const olderPlace = panel.savedState();

            const olderPanel = drawRecipe(loadTreeRecipe(), { savedState: olderPlace });
            const olderCard = accountCardOf(olderPanel);
            expect(olderPanel.isHidden(updaterPanelOf(olderPanel, olderCard))).toBe(false);
            expect(olderPanel.isHidden(parentStepOf(olderPanel, olderCard))).toBe(false);

            const stalePlace = panel.savedState();
            const staleTree = stalePlace.trees.find((treePlace: any) => treePlace.treeKey === ACCOUNT_TREE_KEY);
            staleTree.updaterStep = 'structure';
            staleTree.updaterParentObjectApiName = 'Gone__c';

            const stalePanel = drawRecipe(loadTreeRecipe(), { savedState: stalePlace });
            const staleCard = accountCardOf(stalePanel);
            expect(stalePanel.isHidden(parentStepOf(stalePanel, staleCard))).toBe(false);
            expect(parentSelectOf(stalePanel, staleCard).value).toBe('0');
            expect(updaterObjectsOf(stalePanel, staleCard)).toEqual([]);

        });

        it('keeps a place\'s parent only when it is an api name, its WHERE only within the WHERE limit, and the step only with a parent', () => {

            const normalizedTree = (treePlace: any) => RecipeCockpitService.normalizePanelPlace({
                version: RECIPE_COCKPIT_PANEL_PLACE_VERSION, runFolderName: TREE_RUN_FOLDER_NAME, scrollY: 0,
                trees: [{ treeKey: ACCOUNT_TREE_KEY, selectedTab: 'updater', ...treePlace }]
            })!.trees[0];

            expect(normalizedTree({ updaterStep: 'structure', updaterParentObjectApiName: 'Contact', updaterParentWhereText: 'Name = \'A\'' }))
                .toMatchObject({ updaterStep: 'structure', updaterParentObjectApiName: 'Contact', updaterParentWhereText: 'Name = \'A\'' });
            expect(normalizedTree({ updaterStep: 'structure', updaterParentObjectApiName: 'Contact\n- object: x' })).not.toHaveProperty('updaterParentObjectApiName');
            expect(normalizedTree({ updaterStep: 'structure' })).not.toHaveProperty('updaterStep');
            expect(normalizedTree({ updaterStep: 'parent', updaterParentObjectApiName: 'Contact' })).not.toHaveProperty('updaterStep');
            expect(normalizedTree({ updaterParentWhereText: 'x'.repeat(RECIPE_COCKPIT_UPDATER_WHERE_MAX_LENGTH + 1) })).not.toHaveProperty('updaterParentWhereText');
            expect(normalizedTree({ updaterParentWhereText: 42 })).not.toHaveProperty('updaterParentWhereText');
            expect(normalizedTree({ updaterParentWhereText: '' })).not.toHaveProperty('updaterParentWhereText');

        });

    });

});
