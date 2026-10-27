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
    IRecipeCockpitTreeViewModel,
    RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON,
    RECIPE_COCKPIT_HIDE_UNSELECTED_FIELDS_LABEL,
    RECIPE_COCKPIT_INSERT_LEFT_OUT_SECTION_TITLE,
    RECIPE_COCKPIT_NO_UNSELECTED_FIELDS_NOTE,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    #483: beside an object's "All fields" and "Standard fields" boxes, "Hide unselected" hides that
    object's unticked field rows. It is the panel's alone and kept in the place. In the history
    workspace Account writes Name, ParentId, OwnerId and five custom fields, three of its rows carry
    a TODO; Contact writes LastName and AccountId; Lead writes Company and Status.
*/

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT,
    CURRENT_RUN_FOLDER_NAME
).recipeViewModel;

const treeOf = (recipe: IRecipeCockpitRecipeViewModel, treeKey: string) => recipe.trees.find(tree => tree.treeKey === treeKey) as IRecipeCockpitTreeViewModel;

const untick = (recipe: IRecipeCockpitRecipeViewModel, fieldsByObject: Record<string, string[]>, excludedObjectApiNames: string[] = []) => RecipeCockpitService.applyObjectSelections(
    recipe,
    new Map(excludedObjectApiNames.length > 0 ? [[ACCOUNT_TREE_KEY, new Set(excludedObjectApiNames)]] : []),
    new Map([[ACCOUNT_TREE_KEY, new Map(Object.entries(fieldsByObject).map(([objectApiName, fieldApiNames]) => [objectApiName, new Set(fieldApiNames)]))]])
);

describe('RecipeCockpitService, an object\'s own "Hide unselected" (#483)', () => {

    describe('the panel script', () => {

        type Panel = ReturnType<typeof runPanelScript>;

        const drawRecipe = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined, savedState?: any): Panel => {
            const panel = runPanelScript(savedState ? { savedState } : {});
            const recipe = loadRecipe();
            recipeChanges(recipe);
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
            panel.postToPanel({ command: 'loadPhase', message: '' });
            panel.expandAllTrees();
            return panel;
        };

        const objectNamed = (panel: Panel, objectApiName: string) => panel.objectElements().find((objectElement: any) => panel.objectNameOf(objectElement) === objectApiName);
        const expanded = (panel: Panel, objectApiName: string) => {
            const objectElement = objectNamed(panel, objectApiName);
            panel.expandObject(objectElement);
            return objectElement;
        };
        const rowOf = (panel: Panel, objectElement: any) => panel.findAll(panel.objectBodyOf(objectElement), 'treeFieldSelectAllRow')[0];
        const hideOf = (panel: Panel, objectElement: any) => panel.findAll(panel.objectBodyOf(objectElement), 'treeHideUnselectedToggle')[0];
        const countOf = (panel: Panel, objectElement: any) => panel.findAll(objectElement, 'treeObjectCount')[0]?.textContent;
        const postedOtherThanPlace = (panel: Panel) => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command !== 'savePlace');
        const savedTreeOf = (panel: Panel) => panel.savedState().trees.find((savedTree: any) => savedTree.treeKey === ACCOUNT_TREE_KEY);
        const answerSelection = (panel: Panel, fieldSelectionObjects: any[]) => panel.postToPanel({
            command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, fieldSelection: { objects: fieldSelectionObjects }
        });

        it('draws an unticked, labelled check after "Standard fields" and before "TODOs only", off by default', () => {

            const panel = drawRecipe(recipe => untick(recipe, { Account: ['Legacy_Code__c'] }));
            const account = expanded(panel, 'Account');
            const hideElement = hideOf(panel, account);
            const rowChildren = rowOf(panel, account).children;

            expect(panel.findAll(rowChildren[2], 'treeHideUnselectedToggle')).toEqual([hideElement]);
            expect(panel.findAll(rowChildren[3], 'treeObjectTodosToggle')).toHaveLength(1);
            expect(hideElement.tagName).toBe('button');
            expect(hideElement.classList.contains('sdtButton-check')).toBeTrue();
            expect(hideElement.attributes.role).toBe('checkbox');
            expect(hideElement.attributes['aria-checked']).toBe('false');
            expect(hideElement.disabled).toBeFalse();
            expect(hideElement.attributes.title).toBe('Hide the 1 unticked field of Account');
            expect(panel.findAll(rowChildren[2], 'treeHideUnselectedLabel')[0].textContent).toBe(RECIPE_COCKPIT_HIDE_UNSELECTED_FIELDS_LABEL);
            expect(panel.visibleFieldNamesOf(account)).toHaveLength(8);

        });

        it('hides only its own object\'s unticked rows, posts nothing but the place, and gives them back', () => {

            const panel = drawRecipe(recipe => untick(recipe, { Account: ['Legacy_Code__c', 'Name'], Contact: ['LastName'] }));
            const account = expanded(panel, 'Account');
            const contact = expanded(panel, 'Contact');
            const postedBefore = postedOtherThanPlace(panel).length;

            hideOf(panel, account).dispatch('click');

            expect(hideOf(panel, account).attributes['aria-checked']).toBe('true');
            expect(panel.visibleFieldNamesOf(account)).toHaveLength(6);
            expect(panel.visibleFieldNamesOf(account)).not.toIncludeAnyMembers(['Legacy_Code__c', 'Name']);
            expect(panel.visibleFieldNamesOf(contact)).toEqual(['LastName', 'AccountId']);
            expect(countOf(panel, account)).toBe('6 of 8 fields');
            expect(postedOtherThanPlace(panel)).toHaveLength(postedBefore);

            panel.findAll(rowOf(panel, account), 'treeHideUnselectedLabel')[0].dispatch('click');
            expect(panel.visibleFieldNamesOf(account)).toHaveLength(8);

        });

        it('counts a field an excluded parent cut as unselected', () => {

            const panel = drawRecipe(recipe => {
                treeOf(recipe, ACCOUNT_TREE_KEY).fieldSelection = { objects: [{ objectApiName: 'Contact', excludedFieldApiNames: [], lockedFields: [{ fieldApiName: 'AccountId', reason: RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON }] }] };
            });
            const contact = expanded(panel, 'Contact');

            hideOf(panel, contact).dispatch('click');

            expect(panel.visibleFieldNamesOf(contact)).toEqual(['LastName']);

        });

        it('keeps the object drawn, with a note, when every field is hidden', () => {

            const panel = drawRecipe(recipe => untick(recipe, { Contact: ['LastName', 'AccountId'] }));
            const contact = expanded(panel, 'Contact');

            hideOf(panel, contact).dispatch('click');

            expect(panel.visibleFieldNamesOf(contact)).toEqual([]);
            expect(panel.isHidden(contact)).toBeFalse();
            expect(panel.isHidden(panel.objectBodyOf(contact))).toBeFalse();
            expect(countOf(panel, contact)).toBe('no selected fields');

        });

        it('combines with the Treecipe search and the object\'s own "TODOs only"', () => {

            const panel = drawRecipe(recipe => untick(recipe, { Account: ['ParentId'] }));
            const account = expanded(panel, 'Account');
            hideOf(panel, account).dispatch('click');

            panel.findAll(panel.objectBodyOf(account), 'treeObjectTodosToggle')[0].dispatch('click');
            expect(panel.visibleFieldNamesOf(account)).toEqual(['Regions__c', 'OwnerId']);

            panel.typeIntoFilter('owner');
            expect(panel.visibleFieldNamesOf(account)).toEqual(['OwnerId']);

        });

        it('is disabled with a reason while nothing is unticked or the object is excluded', () => {

            const panel = drawRecipe();
            const lead = expanded(panel, 'Lead');
            expect(hideOf(panel, lead).disabled).toBeTrue();
            expect(hideOf(panel, lead).attributes.title).toBe(RECIPE_COCKPIT_NO_UNSELECTED_FIELDS_NOTE);
            hideOf(panel, lead).dispatch('click');
            expect(hideOf(panel, lead).attributes['aria-checked']).toBe('false');

            const excludedPanel = drawRecipe(recipe => untick(recipe, { Contact: ['LastName'] }, ['Contact']));
            const contact = expanded(excludedPanel, 'Contact');
            expect(hideOf(excludedPanel, contact).disabled).toBeTrue();
            expect(hideOf(excludedPanel, contact).attributes.title).toBe('Contact is excluded, so its fields are read-only');

        });

        it('hides a row the host\'s answer unticks, and turns off once nothing is unticked', () => {

            const panel = drawRecipe(recipe => untick(recipe, { Contact: ['LastName'] }));
            const contact = expanded(panel, 'Contact');
            hideOf(panel, contact).dispatch('click');
            expect(panel.visibleFieldNamesOf(contact)).toEqual(['AccountId']);

            answerSelection(panel, [{ objectApiName: 'Contact', excludedFieldApiNames: ['LastName', 'AccountId'], lockedFields: [] }]);
            expect(panel.visibleFieldNamesOf(contact)).toEqual([]);

            // "All fields" TICKED AGAIN: NOTHING LEFT TO HIDE, SO THE CHECK TURNS OFF AND THE NEXT UNTICK STAYS SHOWN
            answerSelection(panel, [{ objectApiName: 'Contact', excludedFieldApiNames: [], lockedFields: [] }]);
            expect(panel.visibleFieldNamesOf(contact)).toEqual(['LastName', 'AccountId']);
            expect(hideOf(panel, contact).attributes['aria-checked']).toBe('false');
            expect(hideOf(panel, contact).disabled).toBeTrue();

            answerSelection(panel, [{ objectApiName: 'Contact', excludedFieldApiNames: ['LastName'], lockedFields: [] }]);
            expect(panel.visibleFieldNamesOf(contact)).toEqual(['LastName', 'AccountId']);
            expect(hideOf(panel, contact).disabled).toBeFalse();

        });

        it('counts the tab\'s rows while only it narrows them, and again after the host\'s answer', () => {

            const panel = drawRecipe(recipe => untick(recipe, { Contact: ['LastName'] }));
            const contact = expanded(panel, 'Contact');
            const matchCount = () => panel.findAll(panel.treeCards()[0], 'tabMatchCount')[0].textContent;
            const totalBefore = matchCount();
            const total = Number(/^(\d+) fields$/.exec(totalBefore)?.[1]);

            hideOf(panel, contact).dispatch('click');
            expect(matchCount()).toBe(`${total - 1} of ${totalBefore}`);

            answerSelection(panel, [{ objectApiName: 'Contact', excludedFieldApiNames: ['LastName', 'AccountId'], lockedFields: [] }]);
            expect(matchCount()).toBe(`${total - 2} of ${totalBefore}`);

        });

        // FROM THE REVIEW OF #484: A FILTER THAT TURNS ITSELF OFF IS SAVED OFF, OR THE NEXT RESTORE TURNS IT BACK ON
        it('saves the place when it turns itself off', () => {

            const panel = drawRecipe(recipe => untick(recipe, { Contact: ['LastName'] }));
            const contact = expanded(panel, 'Contact');
            hideOf(panel, contact).dispatch('click');
            expect(savedTreeOf(panel).hideUnselectedObjectKeys).toEqual(['Contact\n']);

            answerSelection(panel, [{ objectApiName: 'Contact', excludedFieldApiNames: [], lockedFields: [] }]);

            expect(savedTreeOf(panel) ?? {}).not.toHaveProperty('hideUnselectedObjectKeys');

        });

        it('is saved in the place by object key and restored in the next document', () => {

            const firstPanel = drawRecipe(recipe => untick(recipe, { Account: ['Legacy_Code__c'] }));
            hideOf(firstPanel, expanded(firstPanel, 'Account')).dispatch('click');
            expect(savedTreeOf(firstPanel).hideUnselectedObjectKeys).toEqual(['Account\n']);

            const panel = drawRecipe(recipe => untick(recipe, { Account: ['Legacy_Code__c'] }), firstPanel.savedState());
            const account = objectNamed(panel, 'Account');

            expect(hideOf(panel, account).attributes['aria-checked']).toBe('true');
            expect(panel.visibleFieldNamesOf(account)).not.toContain('Legacy_Code__c');
            expect(panel.visibleFieldNamesOf(account)).toHaveLength(7);

            hideOf(panel, account).dispatch('click');
            expect(savedTreeOf(panel) ?? {}).not.toHaveProperty('hideUnselectedObjectKeys');

        });

        it('drops a saved key naming an object that is gone or now has nothing unticked', () => {

            const firstPanel = drawRecipe(recipe => untick(recipe, { Account: ['Legacy_Code__c'] }));
            hideOf(firstPanel, expanded(firstPanel, 'Account')).dispatch('click');
            const savedState = firstPanel.savedState();
            savedState.trees.find((savedTree: any) => savedTree.treeKey === ACCOUNT_TREE_KEY).hideUnselectedObjectKeys.push('Gone__c\n');

            const panel = drawRecipe(undefined, savedState);
            const account = expanded(panel, 'Account');

            expect(hideOf(panel, account).attributes['aria-checked']).toBe('false');
            expect(hideOf(panel, account).disabled).toBeTrue();
            expect(panel.visibleFieldNamesOf(account)).toHaveLength(8);
            expect(savedTreeOf(panel) ?? {}).not.toHaveProperty('hideUnselectedObjectKeys');

        });

    });

    describe('normalizePanelPlace', () => {

        it('keeps the keys only when there are any', () => {

            const savedPlaceWith = (treePlace: Record<string, unknown>) => ({
                version: RECIPE_COCKPIT_PANEL_PLACE_VERSION,
                runFolderName: CURRENT_RUN_FOLDER_NAME,
                isOrgPickerInUse: false,
                isFavoritesOnly: false,
                scrollY: 0,
                trees: [{ treeKey: ACCOUNT_TREE_KEY, isExpanded: true, selectedTab: 'treecipe', searchQueries: { treecipe: '', datasets: '' }, expandedObjectKeys: [], openPicklistKeys: [], ...treePlace }]
            });
            const normalizedTree = (hideUnselectedObjectKeys: unknown) => RecipeCockpitService.normalizePanelPlace(savedPlaceWith({ hideUnselectedObjectKeys }))?.trees[0];

            expect(normalizedTree(['Account\n'])?.hideUnselectedObjectKeys).toEqual(['Account\n']);
            [[], 'Account', 1, null, undefined].forEach(candidateValue => expect(normalizedTree(candidateValue)).not.toHaveProperty('hideUnselectedObjectKeys'));

        });

    });

    describe('the insert confirmation\'s "Left out, per object" section', () => {

        const buildContent = (recipe: IRecipeCockpitRecipeViewModel) => RecipeCockpitService.buildInsertConfirmationContent('qa', { isSandbox: true, organizationType: 'Enterprise Edition' } as any,
            treeOf(recipe, ACCOUNT_TREE_KEY), recipe, new Map([['Account', 1], ['Contact', 2]]), [], 'faker-js', 'recipe.yml');
        const leftOutOf = (recipe: IRecipeCockpitRecipeViewModel) => buildContent(recipe).sections.find(section => section.title === RECIPE_COCKPIT_INSERT_LEFT_OUT_SECTION_TITLE);

        it('is dropped when the card leaves nothing out', () => {

            const recipe = loadRecipe();

            expect(leftOutOf(recipe)?.lines ?? []).toEqual([]);
            expect(RecipeCockpitService.flattenConfirmContent(buildContent(recipe))).not.toContain(RECIPE_COCKPIT_INSERT_LEFT_OUT_SECTION_TITLE);

        });

        it('lists each object with its unticked fields under it, in insert order', () => {

            const recipe = loadRecipe();
            untick(recipe, { Contact: ['LastName'], Account: ['Legacy_Code__c', 'Name'] });

            expect(leftOutOf(recipe)).toEqual({
                title: RECIPE_COCKPIT_INSERT_LEFT_OUT_SECTION_TITLE,
                count: 2,
                lines: [
                    'Account, 2 fields left out, not sent:',
                    '  Name',
                    '  Legacy_Code__c',
                    'Contact, 1 field left out, not sent:',
                    '  LastName'
                ]
            });

        });

        it('names each excluded object first, and leaves its unticked fields out', () => {

            const recipe = loadRecipe();
            untick(recipe, { Account: ['Name'], Contact: ['LastName'] }, ['Contact']);
            const section = leftOutOf(recipe);

            expect(section?.lines[0]).toBe('Contact: not generated, excluded');
            expect(section?.lines).toContain('Account, 1 field left out, not sent:');
            expect(section?.lines).not.toContain('  LastName');
            expect(section?.count).toBe(section?.lines.filter(line => !line.startsWith('  ')).length);

        });

        // FROM THE REVIEW OF #484: THE SECTION LISTS THE SAME ROWS "Hide unselected" HIDES, A LOOKUP AN EXCLUDED PARENT CUT INCLUDED
        it('lists a lookup an excluded parent cut under its object, once, naming the parent', () => {

            const recipe = loadRecipe();
            const tree = treeOf(recipe, ACCOUNT_TREE_KEY);
            tree.objectSelection = {
                exclusions: [{ objectApiName: 'Account', kind: 'excluded' }],
                disabledLookups: [{ objectApiName: 'OtherChildObject__c', fieldApiName: 'Account__c', parentObjectApiName: 'Account' }],
                includedObjectCount: 2,
                objectCount: 3
            };
            tree.fieldSelection = { objects: [
                { objectApiName: 'OtherChildObject__c', excludedFieldApiNames: ['Notes__c'], lockedFields: [{ fieldApiName: 'Account__c', reason: RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON }] },
                { objectApiName: 'Contact', excludedFieldApiNames: [], lockedFields: [{ fieldApiName: 'AccountId', reason: RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON }] },
                { objectApiName: 'Lead', excludedFieldApiNames: [], lockedFields: [{ fieldApiName: 'RecordTypeId', reason: 'record-type sections depend on it' }] }
            ] };

            expect(leftOutOf(recipe)?.lines).toEqual([
                'Account: not generated, excluded',
                'Contact, 1 field left out, not sent:',
                '  AccountId, cut: parent object excluded',
                'OtherChildObject__c, 2 fields left out, not sent:',
                '  Notes__c',
                '  Account__c, cut: parent Account excluded'
            ]);
            expect(leftOutOf(recipe)?.count).toBe(3);

        });

        it('says "with its parent" when an auto-exclusion names no parent', () => {

            const recipe = loadRecipe();
            treeOf(recipe, ACCOUNT_TREE_KEY).objectSelection = { exclusions: [{ objectApiName: 'Contact', kind: 'autoExcluded' }], disabledLookups: [], includedObjectCount: 2, objectCount: 3 };

            expect(leftOutOf(recipe)?.lines).toEqual(['Contact: not generated, auto-excluded with its parent']);

        });

    });

});
