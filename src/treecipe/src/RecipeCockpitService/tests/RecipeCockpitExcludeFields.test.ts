import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn(), showInputBox: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitObjectViewModel,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel,
    RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_COUNTS,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIELDS,
    RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON,
    RECIPE_COCKPIT_FIELD_RECORD_TYPE_REASON,
    RECIPE_COCKPIT_EVERY_FIELD_UNTICKED_WARNING,
    RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL,
    RECIPE_COCKPIT_RUN_FAKER_COMMAND,
    RECIPE_COCKPIT_UNGROUPED_TREE_TITLE
} from '../RecipeCockpitService';
import { RecipeCockpitRecordCreation, ICreateObjectDescribe } from '../RecipeCockpitRecordCreation';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';

/*
    #220: a checkbox on each Treecipe-tab field row leaves that field out of generation. The HOST keeps
    the unticked fields beside #219's excluded objects, decides which fields may not be unticked and
    why, and the generate button and the whole-tree insert (#255) both leave the unticked fields out.
*/

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LEAD_TREE_KEY = 'Lead-ONLY';
const ACCOUNT_RECIPE_FILE_PATH = path.join(HISTORY_GENERATED_RECIPES_PATH, CURRENT_RUN_FOLDER_NAME, ACCOUNT_TREE_KEY, `recipe--${ACCOUNT_TREE_KEY}-2026-09-20T10-00-00.yml`);

const loadRecipeRun = () => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT,
    CURRENT_RUN_FOLDER_NAME
);

const loadRecipe = (): IRecipeCockpitRecipeViewModel => loadRecipeRun().recipeViewModel;

const buildWorkspaceState = (initialValues: Record<string, unknown> = {}) => {
    const storedValues = new Map<string, unknown>(Object.entries(initialValues));
    return {
        storedValues,
        get: jest.fn((key: string) => storedValues.get(key)) as jest.Mock,
        update: jest.fn((key: string, value: unknown) => {
            if ( value === undefined ) { storedValues.delete(key); } else { storedValues.set(key, JSON.parse(JSON.stringify(value))); }
            return Promise.resolve();
        }) as jest.Mock
    };
};

const storedSelections = (excludedObjectApiNamesByFolderName: Record<string, unknown>, excludedFieldApiNamesByFolderName: Record<string, unknown> = {}) => ({
    version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    excludedObjectApiNamesByFolderName: excludedObjectApiNamesByFolderName,
    excludedFieldApiNamesByFolderName: excludedFieldApiNamesByFolderName,
    objectCountsByFolderName: {},
    validationRulesOffByFolderName: {}
});

const treeOf = (recipe: IRecipeCockpitRecipeViewModel, treeKey: string) => recipe.trees.find(tree => tree.treeKey === treeKey) as IRecipeCockpitTreeViewModel;
const objectOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string) => recipe.objects.find(objectViewModel => objectViewModel.objectApiName === objectApiName) as IRecipeCockpitObjectViewModel;
const fieldSelectionOf = (tree: IRecipeCockpitTreeViewModel, objectApiName: string) => tree.fieldSelection?.objects.find(objectFieldSelection => objectFieldSelection.objectApiName === objectApiName);

const untick = (recipe: IRecipeCockpitRecipeViewModel, fieldsByObject: Record<string, string[]>, excludedObjectApiNames: string[] = []) => RecipeCockpitService.applyObjectSelections(
    recipe,
    new Map(excludedObjectApiNames.length > 0 ? [[ACCOUNT_TREE_KEY, new Set(excludedObjectApiNames)]] : []),
    new Map([[ACCOUNT_TREE_KEY, new Map(Object.entries(fieldsByObject).map(([objectApiName, fieldApiNames]) => [objectApiName, new Set(fieldApiNames)]))]])
);

const buildObject = (fields: Array<{ fieldApiName: string; controllingField?: string; lineNumber?: number }>, hasRecordTypeSections = false): IRecipeCockpitObjectViewModel => ({
    objectApiName: 'Thing__c',
    recipeFilePath: '/workspace/recipe.yml',
    fields: fields.map((field, fieldIndex) => ({
        fieldApiName: field.fieldApiName,
        fieldLabel: '',
        fieldType: '',
        fieldTypeWithSize: '',
        recipeValue: '',
        controllingField: field.controllingField ?? '',
        isOnlyInRecipeFile: false,
        lineNumber: 'lineNumber' in field ? field.lineNumber : fieldIndex + 5
    })),
    ...( hasRecordTypeSections ? { hasRecordTypeSections: true as const } : {} )
});

answerInPanelConfirmationsThroughWarningMock();

// AN ORG SELECTED HERE HAS NO LOCAL AUTHORIZATION READ FOR ITS LABEL (#458, #499); RecipeCockpitDataByOrg.test.ts COVERS THE LABEL
beforeEach(() => {
    jest.spyOn(SalesforceOrgService, 'readScratchOrgDetail').mockResolvedValue(undefined);
});

describe('RecipeCockpitService, unticking fields in the Treecipe tab (#220)', () => {

    describe('buildObjectFieldSelection', () => {

        it('says nothing about an object with nothing unticked and nothing locked', () => {
            expect(RecipeCockpitService.buildObjectFieldSelection(buildObject([{ fieldApiName: 'Name' }, { fieldApiName: 'Phone' }]), undefined, new Set())).toBeUndefined();
        });

        it('leaves out the unticked fields that have a line in the recipe, and never one that has none', () => {

            const objectFieldSelection = RecipeCockpitService.buildObjectFieldSelection(
                buildObject([{ fieldApiName: 'Name' }, { fieldApiName: 'Phone' }, { fieldApiName: 'NotInRecipe__c', lineNumber: undefined }]),
                new Set(['Phone', 'NotInRecipe__c', 'Gone__c']),
                new Set()
            );

            expect(objectFieldSelection).toEqual({ objectApiName: 'Thing__c', excludedFieldApiNames: ['Phone'], lockedFields: [] });

        });

        it('holds RecordTypeId ticked while a record-type section depends on it, and frees it when none does', () => {

            const fields = [{ fieldApiName: 'RecordTypeId' }, { fieldApiName: 'Name' }];

            expect(RecipeCockpitService.buildObjectFieldSelection(buildObject(fields, true), new Set(['RecordTypeId']), new Set())).toEqual({
                objectApiName: 'Thing__c',
                excludedFieldApiNames: [],
                lockedFields: [{ fieldApiName: 'RecordTypeId', reason: RECIPE_COCKPIT_FIELD_RECORD_TYPE_REASON }]
            });
            expect(RecipeCockpitService.buildObjectFieldSelection(buildObject(fields, false), new Set(['RecordTypeId']), new Set())?.excludedFieldApiNames).toEqual(['RecordTypeId']);

        });

        it('holds a controlling field ticked while a dependent is ticked, through a chain, and frees it once every dependent is unticked', () => {

            const object = buildObject([
                { fieldApiName: 'Country__c' },
                { fieldApiName: 'State__c', controllingField: 'Country__c' },
                { fieldApiName: 'City__c', controllingField: 'State__c' }
            ]);

            const cityTicked = RecipeCockpitService.buildObjectFieldSelection(object, new Set(['Country__c', 'State__c']), new Set());
            expect(cityTicked?.excludedFieldApiNames).toEqual([]);
            expect(cityTicked?.lockedFields).toEqual([
                { fieldApiName: 'Country__c', reason: 'controls State__c' },
                { fieldApiName: 'State__c', reason: 'controls City__c' }
            ]);

            expect(RecipeCockpitService.buildObjectFieldSelection(object, new Set(['Country__c', 'State__c', 'City__c']), new Set())?.excludedFieldApiNames)
                .toEqual(['Country__c', 'State__c', 'City__c']);

        });

        it('names every ticked dependent of a controlling field', () => {

            const object = buildObject([
                { fieldApiName: 'Country__c' },
                { fieldApiName: 'State__c', controllingField: 'Country__c' },
                { fieldApiName: 'Region__c', controllingField: 'Country__c' }
            ]);

            expect(RecipeCockpitService.buildObjectFieldSelection(object, new Set(['Country__c', 'Region__c']), new Set())?.lockedFields)
                .toEqual([{ fieldApiName: 'Country__c', reason: 'controls State__c' }]);
            expect(RecipeCockpitService.buildObjectFieldSelection(object, new Set(['Country__c']), new Set())?.lockedFields)
                .toEqual([{ fieldApiName: 'Country__c', reason: 'controls State__c, Region__c' }]);

        });

        it('locks a lookup whose parent is excluded as "parent excluded", never as unticked', () => {

            const objectFieldSelection = RecipeCockpitService.buildObjectFieldSelection(buildObject([{ fieldApiName: 'AccountId' }, { fieldApiName: 'Name' }]), new Set(['AccountId']), new Set(['AccountId']));

            expect(objectFieldSelection).toEqual({
                objectApiName: 'Thing__c',
                excludedFieldApiNames: [],
                lockedFields: [{ fieldApiName: 'AccountId', reason: RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON }]
            });

        });

        it('says when every field is unticked, a parent-excluded lookup counted as left out', () => {

            expect(RecipeCockpitService.buildObjectFieldSelection(buildObject([{ fieldApiName: 'AccountId' }, { fieldApiName: 'Name' }]), new Set(['Name']), new Set(['AccountId']))?.isEveryFieldExcluded).toBeTrue();
            expect(RecipeCockpitService.buildObjectFieldSelection(buildObject([{ fieldApiName: 'AccountId' }, { fieldApiName: 'Name' }]), new Set(['Name']), new Set())?.isEveryFieldExcluded).toBeUndefined();

        });

    });

    describe('applyObjectSelections with fields', () => {

        it('puts each card\'s unticked fields and locks on the card, and leaves the other card alone', () => {

            const recipe = loadRecipe();
            untick(recipe, { Account: ['Legacy_Code__c', 'Rating__c'], Contact: ['LastName'] });

            const accountTree = treeOf(recipe, ACCOUNT_TREE_KEY);
            // Rating__c CONTROLS THE TICKED Sub_Rating__c, SO IT STAYS TICKED
            expect(fieldSelectionOf(accountTree, 'Account')).toEqual({
                objectApiName: 'Account',
                excludedFieldApiNames: ['Legacy_Code__c'],
                lockedFields: [{ fieldApiName: 'Rating__c', reason: 'controls Sub_Rating__c' }]
            });
            expect(fieldSelectionOf(accountTree, 'Contact')).toEqual({ objectApiName: 'Contact', excludedFieldApiNames: ['LastName'], lockedFields: [] });
            expect(accountTree.objectSelection).toBeUndefined();
            expect(treeOf(recipe, LEAD_TREE_KEY).fieldSelection).toBeUndefined();

        });

        it('lists every unticked field by object for generation, and none of an excluded object', () => {

            const recipe = loadRecipe();
            untick(recipe, { Account: ['Legacy_Code__c'], OtherChildObject__c: ['Score__c'] }, ['Contact']);

            expect([...RecipeCockpitService.listExcludedFieldApiNamesByObject(treeOf(recipe, ACCOUNT_TREE_KEY))]).toEqual([['Account', ['Legacy_Code__c']]]);

        });

        it('locks a kept object\'s lookups to an excluded parent, from the object cascade', () => {

            const recipe = loadRecipe();
            // OtherChildObject__c GIVEN A SECOND PARENT, SO EXCLUDING Contact KEEPS IT AND DISABLES BOTH LOOKUPS TO Contact
            treeOf(recipe, ACCOUNT_TREE_KEY).objects.find(treeObject => treeObject.objectApiName === 'OtherChildObject__c')!.parentLookups.push(
                { fieldApiName: 'Ratio__c', parentObjectApiName: 'Account' },
                { fieldApiName: 'Score__c', parentObjectApiName: 'Contact' }
            );
            RecipeCockpitService.applyObjectSelections(recipe, new Map([[ACCOUNT_TREE_KEY, new Set(['Contact'])]]));

            expect(fieldSelectionOf(treeOf(recipe, ACCOUNT_TREE_KEY), 'OtherChildObject__c')).toEqual({
                objectApiName: 'OtherChildObject__c',
                excludedFieldApiNames: [],
                lockedFields: [
                    { fieldApiName: 'Score__c', reason: RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON },
                    { fieldApiName: 'Contact__c', reason: RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON }
                ]
            });
            expect(RecipeCockpitService.listExcludedFieldApiNamesByObject(undefined).size).toBe(0);

        });

        it('marks the object whose every field is unticked', () => {

            const recipe = loadRecipe();
            untick(recipe, { Contact: ['LastName', 'AccountId'] });

            expect(fieldSelectionOf(treeOf(recipe, ACCOUNT_TREE_KEY), 'Contact')?.isEveryFieldExcluded).toBeTrue();

        });

        it('marks an object with a record-type section, as read from its recipe', () => {

            const parsed = RecipeCockpitService.parseRecipeSource([
                '- object: Thing__c',
                '  fields:',
                '    RecordTypeId: Thing__c.One',
                '    Picklist__c:',
                '        random_choice:',
                '            - a',
                '            ### TODO: -- RecordType Options -- One -- SELECT THIS SECTION OF OPTIONS IF USING RECORD TYPE -- One',
                '            - b',
                ''
            ].join('\n'));

            expect(parsed.get('Thing__c')?.hasRecordTypeSections).toBeTrue();
            expect(RecipeCockpitService.parseRecipeSource('- object: Thing__c\n  fields:\n    Name: x\n').get('Thing__c')?.hasRecordTypeSections).toBeUndefined();

        });

    });

    describe('readTreeSelections and writeTreeSelections', () => {

        it('writes a folder and an object named __proto__ as keys, and reads back every api name', async () => {

            const workspaceState = buildWorkspaceState();
            const treeSelections = {
                excludedObjectApiNamesByFolderName: new Map([[ACCOUNT_TREE_KEY, new Set(['Contact'])]]),
                excludedFieldApiNamesByFolderName: new Map([
                    [ACCOUNT_TREE_KEY, new Map([['Account', new Set(['Legacy_Code__c'])], ['__proto__', new Set(['Name'])]])],
                    ['__proto__', new Map([['Lead', new Set(['Company'])]])]
                ]),
                objectCountsByFolderName: new Map([[ACCOUNT_TREE_KEY, new Map([['Contact', 6]])]]),
                fixedValuesByFolderName: new Map(),
                validationRulesOffByFolderName: new Map()
            };

            await expect(RecipeCockpitService.writeTreeSelections(workspaceState, treeSelections)).resolves.toBeTrue();

            const stored = workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY) as any;
            expect(stored.version).toBe(RECIPE_COCKPIT_OBJECT_SELECTION_VERSION);
            expect(Object.keys(stored.excludedFieldApiNamesByFolderName)).toEqual([ACCOUNT_TREE_KEY, '__proto__']);
            expect(Object.keys(stored.excludedFieldApiNamesByFolderName[ACCOUNT_TREE_KEY])).toEqual(['Account', '__proto__']);
            expect(stored.objectCountsByFolderName).toEqual({ [ACCOUNT_TREE_KEY]: { Contact: 6 } });
            // __proto__ IS NO OBJECT API NAME, SO READING IT BACK DROPS IT -- AS A KEY, NEVER AS A PROTOTYPE
            treeSelections.excludedFieldApiNamesByFolderName.get(ACCOUNT_TREE_KEY)?.delete('__proto__');
            expect(RecipeCockpitService.readTreeSelections(workspaceState)).toEqual(treeSelections);

        });

        it('says so and answers false when there is no workspace, or the write fails', async () => {

            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            const emptySelections = { excludedObjectApiNamesByFolderName: new Map(), excludedFieldApiNamesByFolderName: new Map(), objectCountsByFolderName: new Map(), fixedValuesByFolderName: new Map(), validationRulesOffByFolderName: new Map() };
            const failingWorkspaceState = buildWorkspaceState();
            failingWorkspaceState.update.mockImplementation(() => Promise.reject('read-only [x](command:y)'));

            await expect(RecipeCockpitService.writeTreeSelections(undefined, emptySelections)).resolves.toBeFalse();
            await expect(RecipeCockpitService.writeTreeSelections(failingWorkspaceState, emptySelections)).resolves.toBeFalse();

            expect(warningSpy).toHaveBeenCalledTimes(2);
            expect(warningSpy.mock.calls[1][0]).not.toContain('[x](command:y)');

        });

        it('keeps the stored fields when #219\'s writeObjectSelections writes the objects', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({}, { [ACCOUNT_TREE_KEY]: { Account: ['Legacy_Code__c'] } }) });

            await RecipeCockpitService.writeObjectSelections(workspaceState, new Map([[ACCOUNT_TREE_KEY, new Set(['Contact'])]]));

            expect(workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY))
                .toEqual(storedSelections({ [ACCOUNT_TREE_KEY]: ['Contact'] }, { [ACCOUNT_TREE_KEY]: { Account: ['Legacy_Code__c'] } }));

        });

        it('reads a version 2 entry, written before record counts (#255), as its objects and fields with no counts', () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: {
                ...storedSelections({ [ACCOUNT_TREE_KEY]: ['Contact'] }, { [ACCOUNT_TREE_KEY]: { Account: ['Legacy_Code__c'] } }),
                version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_COUNTS,
                objectCountsByFolderName: { [ACCOUNT_TREE_KEY]: { Account: 9 } }
            } });

            expect(RecipeCockpitService.readTreeSelections(workspaceState)).toEqual({
                excludedObjectApiNamesByFolderName: new Map([[ACCOUNT_TREE_KEY, new Set(['Contact'])]]),
                excludedFieldApiNamesByFolderName: new Map([[ACCOUNT_TREE_KEY, new Map([['Account', new Set(['Legacy_Code__c'])]])]]),
                objectCountsByFolderName: new Map(),
                fixedValuesByFolderName: new Map(),
                validationRulesOffByFolderName: new Map()
            });

        });

        it('reads a version 1 entry as its objects with nothing unticked', () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: {
                version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION_WITHOUT_FIELDS,
                excludedObjectApiNamesByFolderName: { [ACCOUNT_TREE_KEY]: ['Contact'] },
                excludedFieldApiNamesByFolderName: { [ACCOUNT_TREE_KEY]: { Account: ['Legacy_Code__c'] } }
            } });

            const treeSelections = RecipeCockpitService.readTreeSelections(workspaceState);

            expect(treeSelections.excludedObjectApiNamesByFolderName).toEqual(new Map([[ACCOUNT_TREE_KEY, new Set(['Contact'])]]));
            expect(treeSelections.excludedFieldApiNamesByFolderName.size).toBe(0);
            expect(treeSelections.objectCountsByFolderName.size).toBe(0);

        });

        it('drops every field entry that is not an object of field api names', () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({}, {
                [ACCOUNT_TREE_KEY]: { Account: ['Legacy_Code__c', 'Bad Name', 'Smuggled\n- object: X', 7], 'Bad Object': ['Name'], Contact: 'LastName', Lead: [] },
                [LEAD_TREE_KEY]: ['Company'],
                '': { Lead: ['Company'] }
            }) });

            expect(RecipeCockpitService.readTreeSelections(workspaceState).excludedFieldApiNamesByFolderName)
                .toEqual(new Map([[ACCOUNT_TREE_KEY, new Map([['Account', new Set(['Legacy_Code__c'])]])]]));

        });

    });

    describe('routePanelMessage', () => {

        const buildDrawnPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
            const recipe = loadRecipe();
            recipe.trees.push({ treeKey: '', title: RECIPE_COCKPIT_UNGROUPED_TREE_TITLE, folderName: '', objects: [{ objectApiName: 'Lead', parentLookups: [] }], fieldCount: 2 });
            panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 4 };
            panelState.treeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipe);
            return panelState;
        };

        it('allows each field with a recipe line of each selectable object of a card with a folder, and nothing else', () => {

            const selectableFieldKeys = [...buildDrawnPanelState().treeHistoryAllowLists.selectableFieldKeys];

            expect(selectableFieldKeys).toContain(`${ACCOUNT_TREE_KEY}\nAccount\nLegacy_Code__c`);
            expect(selectableFieldKeys).toContain(`${ACCOUNT_TREE_KEY}\nContact\nAccountId`);
            expect(selectableFieldKeys).toContain(`${LEAD_TREE_KEY}\nLead\nCompany`);
            expect(selectableFieldKeys.filter(fieldKey => fieldKey.startsWith('\n'))).toEqual([]);
            expect(selectableFieldKeys).toHaveLength(13 + 2);

        });

        it('routes a drawn field to its folder, carrying whether it should now be included', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'setFieldIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', included: false }, buildDrawnPanelState()))
                .toEqual({ kind: 'setFieldIncluded', treeKey: ACCOUNT_TREE_KEY, folderName: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', isIncluded: false });

        });

        it.each([
            ['a field the object does not draw', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Phone', included: false }],
            ['a field of another object', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'LastName', included: false }],
            ['a field of another card', { treeKey: LEAD_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', included: false }],
            ['the ungrouped card', { treeKey: '', objectApiName: 'Lead', fieldApiName: 'Company', included: false }],
            ['a field name that is a line of YAML', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Name\n- object: Evil', included: false }],
            ['a field name that is not a string', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 7, included: false }],
            ['an included that is not a boolean', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', included: 'false' }],
            ['a nickname the object is not drawn with', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', nickname: 'Other_NickName', included: false }]
        ])('does nothing for %s', (_caseName, payload) => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'setFieldIncluded', ...payload } as any, buildDrawnPanelState())).toBeUndefined();

        });

        it('does nothing before "rendered", after "ready" or a failure to draw, or with no model', () => {

            const fieldMessage = { command: 'setFieldIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Legacy_Code__c', included: false };
            const undrawnPanelState = buildDrawnPanelState();
            undrawnPanelState.treeHistoryAllowLists = RecipeCockpitService.buildEmptyTreeHistoryAllowLists();
            const modelLessPanelState = buildDrawnPanelState();
            modelLessPanelState.recipeDataMessage = undefined;

            expect(RecipeCockpitService.routePanelMessage(fieldMessage as any, undrawnPanelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage(fieldMessage as any, modelLessPanelState)).toBeUndefined();

        });

        it.each([
            ['an object of another card', { treeKey: LEAD_TREE_KEY, objectApiName: 'Contact', included: true }],
            ['an included that is not a boolean', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', included: 1 }],
            ['a nickname that is not a string', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', nickname: 7, included: true }],
            ['a nickname the object is not drawn with', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', nickname: 'Other_NickName', included: true }]
        ])('does nothing on All / None for %s', (_caseName, payload) => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'setAllFieldsIncluded', ...payload } as any, buildDrawnPanelState())).toBeUndefined();

        });

        it('routes All / None by the object\'s key, and Reset by a card with a folder', () => {

            const panelState = buildDrawnPanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', included: false } as any, panelState))
                .toEqual({ kind: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, folderName: ACCOUNT_TREE_KEY, objectApiName: 'Contact', isIncluded: false });
            expect(RecipeCockpitService.routePanelMessage({ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Lead', included: false } as any, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'resetTreeSelection', treeKey: ACCOUNT_TREE_KEY } as any, panelState)).toEqual({ kind: 'resetTreeSelection', folderName: ACCOUNT_TREE_KEY });
            expect(RecipeCockpitService.routePanelMessage({ command: 'resetTreeSelection', treeKey: '' } as any, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'resetTreeSelection', treeKey: 7 } as any, panelState)).toBeUndefined();

        });

    });

    describe('Run Faker and the whole-tree insert', () => {

        it('builds the filtered copy without the unticked fields, and names them for the data set', () => {

            const recipe = loadRecipe();
            untick(recipe, { Account: ['Legacy_Code__c', 'Sub_Rating__c'] });
            const recipeText = fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8');

            const filteredRecipe = RecipeCockpitService.buildRunFakerFilteredRecipe(recipeText, treeOf(recipe, ACCOUNT_TREE_KEY), undefined, recipe);

            if ( 'refusalMessage' in filteredRecipe ) {
                throw new Error(filteredRecipe.refusalMessage);
            }
            expect(filteredRecipe.excludedObjectApiNames).toEqual([]);
            expect(filteredRecipe.excludedFieldApiNamesByObject).toEqual({ Account: ['Legacy_Code__c', 'Sub_Rating__c'] });
            expect(filteredRecipe.recipeText).not.toContain('Legacy_Code__c:');
            expect(filteredRecipe.recipeText).not.toContain('when: ${{ Rating__c');
            expect(filteredRecipe.recipeText).toContain('    Rating__c: ');

        });

        it('collects the insert\'s targets without the unticked fields, and carries them to readiness', async () => {

            const loadedRecipe = loadRecipeRun();
            untick(loadedRecipe.recipeViewModel, { Contact: ['LastName'] });
            const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
            panelState.treeHistoryTargets = loadedRecipe.treeHistoryTargets;
            const recipeDataMessage = { command: 'recipeData' as const, recipe: loadedRecipe.recipeViewModel, renderSequence: 2 };

            const contactTarget = ( await RecipeCockpitService.collectCreateTargets(panelState, recipeDataMessage) )
                .find(createTarget => createTarget.treeKey === ACCOUNT_TREE_KEY && createTarget.objectApiName === 'Contact');

            expect(contactTarget).toEqual({ treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', recipeFieldApiNames: ['AccountId'], excludedFieldApiNames: ['LastName'] });

            // ONE TREE'S TARGETS, AS THE INSERT OF THAT TREE ASKS FOR THEM
            const leadTargets = await RecipeCockpitService.collectCreateTargets(panelState, recipeDataMessage, LEAD_TREE_KEY);
            expect(leadTargets).toHaveLength(1);
            expect(leadTargets[0]).toMatchObject({ treeKey: LEAD_TREE_KEY, objectApiName: 'Lead' });
            expect(leadTargets[0].excludedFieldApiNames).toBeUndefined();

        });

        it('names the unticked fields in the insert modal', () => {

            const recipe = loadRecipe();
            const totals = new Map([['Account', 1], ['Contact', 2]]);
            const buildDetail = () => RecipeCockpitService.flattenConfirmContent(RecipeCockpitService.buildInsertConfirmationContent('qa', { isSandbox: true, organizationType: 'Enterprise Edition' } as any,
                treeOf(recipe, ACCOUNT_TREE_KEY), recipe, totals, [], 'faker-js', 'recipe.yml'));

            expect(buildDetail()).not.toContain('Unticked');

            untick(recipe, { Account: ['Legacy_Code__c'], Contact: ['LastName'] });

            // ONE LEAD-IN PER OBJECT, ITS FIELDS UNDER IT (#483)
            expect(buildDetail()).toContain(['Account, 1 field left out, not sent:', '  Legacy_Code__c', 'Contact, 1 field left out, not sent:', '  LastName'].join('\n'));

        });

    });

    describe('readiness (#210) with unticked fields, many at once', () => {

        it('never counts a required lookup, which Create fills with a parent Id whether or not it is ticked', () => {

            const describe = { objectApiName: 'Contact', isCreateable: true, fields: [
                { fieldApiName: 'AccountId', fieldType: 'reference', referenceTo: ['Account'], isNillable: false, isCreateable: true, isDefaultedOnCreate: false },
                { fieldApiName: 'LastName', fieldType: 'string', referenceTo: [] as string[], isNillable: false, isCreateable: true, isDefaultedOnCreate: false }
            ] };

            expect(RecipeCockpitRecordCreation.buildUntickedRequiredFieldReason('Contact', describe, ['AccountId'])).toBe('');
            expect(RecipeCockpitRecordCreation.buildUntickedRequiredFieldReason('Contact', describe, ['AccountId', 'LastName'])).toContain(': LastName.');

        });

        it('counts and shortens a long list of unticked required fields', () => {

            const requiredFields = Array.from({ length: 12 }, (_, fieldIndex) => `Required_${fieldIndex}__c`);
            const describe = { objectApiName: 'Contact', isCreateable: true, fields: requiredFields.map(fieldApiName => ({ fieldApiName, fieldType: 'string', referenceTo: [] as string[], isNillable: false, isCreateable: true, isDefaultedOnCreate: false })) };

            expect(RecipeCockpitRecordCreation.buildUntickedRequiredFieldReason('Contact', describe, requiredFields))
                .toBe(`Contact has 12 unticked fields this org requires: ${requiredFields.slice(0, 10).join(', ')} and 2 more. Tick them in the Treecipe tab to insert records.`);

        });

    });

    describe('readiness (#210) with unticked fields', () => {

        const describe_ = (fields: Array<{ fieldApiName: string; fieldType?: string; isNillable?: boolean; isCreateable?: boolean; isDefaultedOnCreate?: boolean }>): ICreateObjectDescribe => ({
            objectApiName: 'Contact',
            isCreateable: true,
            fields: fields.map(field => ({
                fieldApiName: field.fieldApiName,
                fieldType: field.fieldType ?? 'string',
                referenceTo: [],
                isNillable: field.isNillable ?? true,
                isCreateable: field.isCreateable ?? true,
                isDefaultedOnCreate: field.isDefaultedOnCreate ?? false
            }))
        });
        const sandbox = { isSandbox: true, organizationType: 'Developer Edition' };

        it('offers the insert whether or not an unticked field is one the org lacks, since no field is checked against the describe (#264)', () => {

            const describe = describe_([{ fieldApiName: 'LastName' }]);

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({ objectApiName: 'Contact', orgTypeDetail: sandbox, describe }).disabledReason).toBe('');
            expect(RecipeCockpitRecordCreation.buildCreateReadiness({ objectApiName: 'Contact', orgTypeDetail: sandbox, describe, excludedFieldApiNames: ['Legacy__c'] }).disabledReason).toBe('');

        });

        it('refuses when an unticked field is one the org requires, and not one it fills or allows blank', () => {

            const describe = describe_([
                { fieldApiName: 'LastName', isNillable: false },
                { fieldApiName: 'IsActive__c', isNillable: false, isDefaultedOnCreate: true },
                { fieldApiName: 'Phone' },
                { fieldApiName: 'Formula__c', isNillable: false, isCreateable: false }
            ]);

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({ objectApiName: 'Contact', orgTypeDetail: sandbox, describe, excludedFieldApiNames: ['lastname'] }).disabledReason)
                .toBe('Contact has 1 unticked field this org requires: LastName. Tick it in the Treecipe tab to insert records.');
            expect(RecipeCockpitRecordCreation.buildCreateReadiness({ objectApiName: 'Contact', orgTypeDetail: sandbox, describe, excludedFieldApiNames: ['IsActive__c', 'Phone', 'Formula__c'] }).disabledReason)
                .toBe('');
            expect(RecipeCockpitRecordCreation.findRequiredFieldApiNames(describe)).toEqual(['LastName']);

        });

    });

    describe('openRecipeCockpitPanel', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;

        // THE Run Faker by Recipe CALL THE CARD'S INSERT MAKES (#375): THE RECIPE, AND ITS FILTERED COPY ONLY WHEN THE CARD LEAVES SOMETHING OUT
        const resolveRunFakerCall = (treeKey: string): any[] => {
            const panelState = (RecipeCockpitService as any).recipeCockpitPanelState;
            const recipeFilePath = panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(treeKey);
            const filteredRecipe = RecipeCockpitService.resolveRunFakerFilteredRecipe(panelState, treeKey, recipeFilePath, 'Nothing was generated or inserted for');
            return [RECIPE_COCKPIT_RUN_FAKER_COMMAND, recipeFilePath, ...( filteredRecipe ? [filteredRecipe] : [] )];
        };
        let disposeHandler: (() => void) | undefined;
        let postedPanelMessages: any[];

        const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);
        const executeCommand = vscode.commands.executeCommand as jest.Mock;
        const showWarningMessage = vscode.window.showWarningMessage as jest.Mock;

        const buildWebviewPanel = () => ({
            reveal: jest.fn(),
            dispose: jest.fn(),
            onDidDispose: jest.fn().mockImplementation((handler: () => void) => { disposeHandler = handler; return { dispose: jest.fn() }; }),
            webview: {
                html: '',
                postMessage: jest.fn().mockImplementation((hostMessage: any) => { postedPanelMessages.push(hostMessage); return Promise.resolve(true); }),
                onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: (panelMessage: any) => Promise<void>) => {
                    receivedMessageHandler = messageHandler;
                    return { dispose: jest.fn() };
                })
            }
        });

        const openAndDraw = async (workspaceState: ReturnType<typeof buildWorkspaceState>) => {
            await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            const recipeDataMessage = lastPosted('recipeData');
            await receivedMessageHandler({ command: 'rendered', renderSequence: recipeDataMessage.renderSequence });
            return recipeDataMessage;
        };

        const storedOf = (workspaceState: ReturnType<typeof buildWorkspaceState>) => workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY);

        beforeEach(() => {
            postedPanelMessages = [];
            executeCommand.mockReset();
            showWarningMessage.mockReset();
            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => buildWebviewPanel());
            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => ({ text: initialMessage, dispose: jest.fn() }) as any);
        });

        afterEach(() => {
            disposeHandler?.();
            disposeHandler = undefined;
        });

        it('keeps an untick, posts the card back in place, and a reveal draws it', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', fieldApiName: 'LastName', included: false });

            expect(storedOf(workspaceState)).toEqual(storedSelections({}, { [ACCOUNT_TREE_KEY]: { Contact: ['LastName'] } }));
            expect(lastPosted('objectSelection')).toMatchObject({ command: 'objectSelection', renderSequence: recipeDataMessage.renderSequence, treeKey: ACCOUNT_TREE_KEY });
            expect(fieldSelectionOf(lastPosted('objectSelection'), 'Contact')).toEqual({ objectApiName: 'Contact', excludedFieldApiNames: ['LastName'], lockedFields: [] });

            postedPanelMessages = [];
            await receivedMessageHandler({ command: 'ready' });
            expect(fieldSelectionOf(treeOf(lastPosted('recipeData').recipe, ACCOUNT_TREE_KEY), 'Contact')?.excludedFieldApiNames).toEqual(['LastName']);

            await receivedMessageHandler({ command: 'rendered', renderSequence: lastPosted('recipeData').renderSequence });
            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', fieldApiName: 'LastName', included: true });
            expect(storedOf(workspaceState)).toEqual(storedSelections({}, {}));

        });

        it('refuses to untick a locked field or a field of an excluded object, writing nothing', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: ['Contact'] }) });
            await openAndDraw(workspaceState);
            workspaceState.update.mockClear();

            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Rating__c', included: false });
            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', fieldApiName: 'LastName', included: false });
            await receivedMessageHandler({ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'OtherChildObject__c', included: false });

            expect(workspaceState.update).not.toHaveBeenCalled();

        });

        it('None unticks every field it may, and frees a controlling field with its dependents; All ticks them again', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', included: false });

            const accountSelection = fieldSelectionOf(lastPosted('objectSelection'), 'Account');
            expect(accountSelection?.excludedFieldApiNames).toEqual(['Name', 'Legacy_Code__c', 'Annual_Budget__c', 'Rating__c', 'Sub_Rating__c', 'Regions__c', 'ParentId', 'OwnerId']);
            expect(accountSelection?.lockedFields).toEqual([]);
            expect(accountSelection?.isEveryFieldExcluded).toBeTrue();

            await receivedMessageHandler({ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', included: true });

            expect(fieldSelectionOf(lastPosted('objectSelection'), 'Account')?.excludedFieldApiNames).toEqual([]);
            expect(storedOf(workspaceState)).toEqual(storedSelections({}, {}));

        });

        it('runs a card with only unticked fields on a filtered copy that names them', async () => {

            await openAndDraw(buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({}, { [ACCOUNT_TREE_KEY]: { Contact: ['LastName'] } }) }));

            const runFakerCall = resolveRunFakerCall(ACCOUNT_TREE_KEY);
            expect(runFakerCall?.[1]).toBe(ACCOUNT_RECIPE_FILE_PATH);
            expect(runFakerCall?.[2]).toMatchObject({ excludedObjectApiNames: [], excludedFieldApiNamesByObject: { Contact: ['LastName'] } });
            expect(runFakerCall?.[2].recipeText).not.toContain('LastName:');

        });

        it('ticks and unticks a field of a card with nothing locked, posting it back with no field selection once nothing is left out', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Company', included: false });
            expect(fieldSelectionOf(lastPosted('objectSelection'), 'Lead')?.excludedFieldApiNames).toEqual(['Company']);

            await receivedMessageHandler({ command: 'setAllFieldsIncluded', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', included: true });
            expect(lastPosted('objectSelection')).toEqual({ command: 'objectSelection', renderSequence: expect.any(Number), treeKey: LEAD_TREE_KEY });

            await receivedMessageHandler({ command: 'setAllFieldsIncluded', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', included: false });
            expect(fieldSelectionOf(lastPosted('objectSelection'), 'Lead')?.excludedFieldApiNames).toEqual(['Company', 'Status']);

        });

        it('re-checks only the changed folder\'s insert targets, from the cached describes and the answered org type, with no new connection', async () => {

            await openAndDraw(buildWorkspaceState());
            const selectDataOrgSpy = jest.spyOn(RecipeCockpitService as any, 'selectDataOrg');
            const getConnectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection');
            const describeObjectsSpy = jest.spyOn(SalesforceOrgService, 'describeObjects').mockImplementation(async (_username: string, objectApiNames: string[]) => ({
                wasCancelled: false,
                outcomes: objectApiNames.map(objectApiName => ({
                    objectApiName: objectApiName,
                    wasCached: true,
                    describe: { objectApiName: objectApiName, objectLabel: objectApiName, isCreateable: true, fields: [
                        { fieldApiName: 'Company', fieldLabel: '', fieldType: 'string', referenceTo: [], isNillable: false, isCreateable: true, isDefaultedOnCreate: false },
                        { fieldApiName: 'Status', fieldLabel: '', fieldType: 'picklist', referenceTo: [], isNillable: true, isCreateable: true, isDefaultedOnCreate: false }
                    ] } as any
                }))
            }) as any);
            const panelState = ( RecipeCockpitService as any ).recipeCockpitPanelState as IRecipeCockpitPanelState;
            panelState.dataOrgDetails = [{ targetOrgIdentifier: 'qa', username: 'qa@example.com.qa' } as any];
            panelState.dataOrgSelection = { orgIndex: 0, orgDetail: panelState.dataOrgDetails[0], requestSequence: 6, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' } as any };
            panelState.dataOrgRequestSequence = 6;
            panelState.dataOrgObjectApiNames = new Set(['Account', 'Contact', 'OtherChildObject__c', 'Lead']);

            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Company', included: false });

            expect(selectDataOrgSpy).not.toHaveBeenCalled();
            expect(getConnectionSpy).not.toHaveBeenCalled();
            expect(describeObjectsSpy.mock.calls[0][1]).toEqual(['Lead']);
            const readiness = lastPosted('dataOrgReadiness');
            expect(readiness).toMatchObject({ requestSequence: 6 });
            expect(readiness.createTargets).toHaveLength(1);
            expect(readiness.createTargets[0]).toMatchObject({ treeKey: LEAD_TREE_KEY, objectApiName: 'Lead' });
            expect(readiness.createTargets[0].disabledReason).toBe('Lead has 1 unticked field this org requires: Company. Tick it in the Treecipe tab to insert records.');

            // NOTHING WHILE A SCRATCH ORG RUN HOLDS THE PANEL, AND NOTHING FOR A SELECTION THAT HAS NOT ANSWERED IT IS A SANDBOX
            describeObjectsSpy.mockClear();
            panelState.scratchOrgStateMessage = { isRunning: true } as any;
            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Company', included: true });
            panelState.scratchOrgStateMessage = undefined;
            panelState.dataOrgSelection.orgTypeDetail = undefined;
            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Company', included: false });
            expect(describeObjectsSpy).not.toHaveBeenCalled();

        });

        it('drops a re-check the reader moved on from, and one whose describe failed', async () => {

            await openAndDraw(buildWorkspaceState());
            const panelState = ( RecipeCockpitService as any ).recipeCockpitPanelState as IRecipeCockpitPanelState;
            panelState.dataOrgDetails = [{ targetOrgIdentifier: 'qa', username: 'qa@example.com.qa' } as any];
            panelState.dataOrgSelection = { orgIndex: 0, orgDetail: panelState.dataOrgDetails[0], requestSequence: 6, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' } as any };
            panelState.dataOrgRequestSequence = 6;
            panelState.dataOrgObjectApiNames = new Set(['Lead']);
            const describeObjectsSpy = jest.spyOn(SalesforceOrgService, 'describeObjects').mockImplementation(async () => {
                panelState.dataOrgRequestSequence = 7;
                return { wasCancelled: true, outcomes: [] } as any;
            });

            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Company', included: false });
            expect(lastPosted('dataOrgReadiness')).toBeUndefined();

            panelState.dataOrgRequestSequence = 6;
            describeObjectsSpy.mockImplementation(() => Promise.reject(new Error('offline')));
            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Company', included: true });
            expect(lastPosted('dataOrgReadiness')).toBeUndefined();

        });

        it('changes nothing for a field action with no model on screen', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
            workspaceState.update.mockClear();

            await ( RecipeCockpitService as any ).setFieldIncluded(undefined, panelState, { kind: 'setFieldIncluded', treeKey: LEAD_TREE_KEY, folderName: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Company', isIncluded: false });
            await ( RecipeCockpitService as any ).setAllFieldsIncluded(undefined, panelState, { kind: 'setAllFieldsIncluded', treeKey: LEAD_TREE_KEY, folderName: LEAD_TREE_KEY, objectApiName: 'Lead', isIncluded: false });

            expect(workspaceState.update).not.toHaveBeenCalled();

        });

        it('asks nothing on Reset of a folder with nothing left out, and names a renamed tree when it does ask', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'resetTreeSelection', treeKey: LEAD_TREE_KEY });
            expect(showWarningMessage).not.toHaveBeenCalled();

            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', fieldApiName: 'Company', included: false });
            const panelState = ( RecipeCockpitService as any ).recipeCockpitPanelState as IRecipeCockpitPanelState;
            treeOf(panelState.recipeDataMessage!.recipe, LEAD_TREE_KEY).customName = 'Leads [x](command:y)';
            showWarningMessage.mockResolvedValueOnce(undefined);

            await receivedMessageHandler({ command: 'resetTreeSelection', treeKey: LEAD_TREE_KEY });

            // THE IN-PANEL DIALOG WRITES IT WITH textContent (#349), SO IT IS SHOWN AS TYPED, NOT ESCAPED
            expect(showWarningMessage.mock.calls[0][0]).toBe('Reset the selection of Leads [x](command:y)?');

        });

        it('Reset asks first, then includes every object, ticks every field and drops every count of the folder', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: {
                ...storedSelections(
                    { [ACCOUNT_TREE_KEY]: ['Contact'], [LEAD_TREE_KEY]: ['Lead'] },
                    { [ACCOUNT_TREE_KEY]: { Account: ['Legacy_Code__c'] } }
                ),
                objectCountsByFolderName: { [ACCOUNT_TREE_KEY]: { Account: 4 }, [LEAD_TREE_KEY]: { Lead: 7 } }
            } });
            await openAndDraw(workspaceState);

            showWarningMessage.mockResolvedValueOnce(undefined);
            await receivedMessageHandler({ command: 'resetTreeSelection', treeKey: ACCOUNT_TREE_KEY });
            expect(showWarningMessage).toHaveBeenCalledWith(
                'Reset the selection of Account-thru-OtherChildObject__c?',
                { inPanel: true, detail: 'Every object is included, every field is ticked, every record count goes back to the recipe\'s own again and every validation rule is applied again.\n\nWhat stays\nThe recipe file is not changed, so an edit written into it stays: clear it with its field\'s edit button.' },
                RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL
            );
            expect(( storedOf(workspaceState) as any ).excludedObjectApiNamesByFolderName[ACCOUNT_TREE_KEY]).toEqual(['Contact']);
            expect(( storedOf(workspaceState) as any ).objectCountsByFolderName[ACCOUNT_TREE_KEY]).toEqual({ Account: 4 });

            showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL);
            await receivedMessageHandler({ command: 'resetTreeSelection', treeKey: ACCOUNT_TREE_KEY });

            expect(storedOf(workspaceState)).toEqual({ ...storedSelections({ [LEAD_TREE_KEY]: ['Lead'] }, {}), objectCountsByFolderName: { [LEAD_TREE_KEY]: { Lead: 7 } } });
            const posted = lastPosted('objectSelection');
            expect(posted.treeKey).toBe(ACCOUNT_TREE_KEY);
            expect(posted.objectSelection).toBeUndefined();
            expect(posted.objectCounts).toBeUndefined();
            expect(fieldSelectionOf(posted, 'Account')?.excludedFieldApiNames).toEqual([]);

        });

        it('Reset asks for a folder whose only change is a record count', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: { ...storedSelections({}, {}), objectCountsByFolderName: { [LEAD_TREE_KEY]: { Lead: 7 } } } });
            await openAndDraw(workspaceState);

            showWarningMessage.mockResolvedValueOnce(RECIPE_COCKPIT_RESET_SELECTION_CONFIRM_LABEL);
            await receivedMessageHandler({ command: 'resetTreeSelection', treeKey: LEAD_TREE_KEY });

            expect(showWarningMessage).toHaveBeenCalledTimes(1);
            expect(storedOf(workspaceState)).toEqual(storedSelections({}, {}));

        });

    });

    describe('the panel script', () => {

        const drawRecipe = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined) => {
            const panel = runPanelScript();
            const recipe = loadRecipe();
            recipe.trees.push({ treeKey: '', title: RECIPE_COCKPIT_UNGROUPED_TREE_TITLE, folderName: '', objects: [{ objectApiName: 'Lead', parentLookups: [] }], fieldCount: 2 });
            recipeChanges(recipe);
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
            panel.postToPanel({ command: 'loadPhase', message: '' });
            panel.expandAllTrees();
            return panel;
        };

        const objectsNamed = (panel: ReturnType<typeof runPanelScript>, objectApiName: string) => panel.objectElements().filter(objectElement => panel.objectNameOf(objectElement) === objectApiName);
        const objectNamed = (panel: ReturnType<typeof runPanelScript>, objectApiName: string) => objectsNamed(panel, objectApiName)[0];
        const expanded = (panel: ReturnType<typeof runPanelScript>, objectApiName: string) => {
            const objectElement = objectNamed(panel, objectApiName);
            panel.expandObject(objectElement);
            return objectElement;
        };
        const checkboxOf = (panel: ReturnType<typeof runPanelScript>, objectElement: any, fieldApiName: string) => panel.findAll(panel.fieldRowNamed(objectElement, fieldApiName), 'treeFieldInclude')[0];
        const noteOf = (panel: ReturnType<typeof runPanelScript>, objectElement: any, fieldApiName: string) => panel.findAll(panel.fieldRowNamed(objectElement, fieldApiName), 'treeFieldNote')[0];

        // #343 HID ALL / NONE; #410 DRAWS ONE "All fields" BOX IN THEIR PLACE, NEVER THE TWO BUTTONS
        it('draws a ticked checkbox on each field with a recipe line, and no All / None', () => {

            const panel = drawRecipe();
            const contact = expanded(panel, 'Contact');
            const lastNameBox = checkboxOf(panel, contact, 'LastName');

            expect(lastNameBox.tagName).toBe('button');
            expect(lastNameBox.attributes.role).toBe('checkbox');
            expect(lastNameBox.attributes['aria-checked']).toBe('true');
            expect(lastNameBox.textContent).toBe('✓');
            expect(lastNameBox.disabled).toBeFalse();
            expect(panel.findAll(panel.objectBodyOf(contact), 'treeFieldBulk')).toEqual([]);
            expect(panel.findAll(panel.objectBodyOf(contact), 'treeFieldAll')).toEqual([]);
            expect(panel.findAll(panel.objectBodyOf(contact), 'treeFieldNone')).toEqual([]);
            expect(panel.objectBodyOf(contact).children[0].classList.contains('treeFieldSelectAllRow')).toBeTrue();
            expect(panel.objectBodyOf(contact).children[1].classList.contains('treeFieldsBox')).toBeTrue();
            expect(panel.objectBodyOf(contact).children[1].children[0].classList.contains('treeField')).toBeTrue();

        });

        describe('the "All fields" box (#410)', () => {

            const selectAllOf = (panel: ReturnType<typeof runPanelScript>, objectElement: any) => panel.findAll(panel.objectBodyOf(objectElement), 'treeFieldSelectAll')[0];
            const selectAllRowOf = (panel: ReturnType<typeof runPanelScript>, objectElement: any) => panel.findAll(panel.objectBodyOf(objectElement), 'treeFieldSelectAllRow')[0];
            const postedSelectAll = (panel: ReturnType<typeof runPanelScript>) => panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'setAllFieldsIncluded');
            const panelLabelOf = (panel: ReturnType<typeof runPanelScript>, objectElement: any) => panel.findAll(selectAllRowOf(panel, objectElement), 'treeFieldSelectAllLabel')[0];
            const recipeFieldNamesOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string) => objectOf(recipe, objectApiName).fields.filter(field => field.lineNumber).map(field => field.fieldApiName);

            it('draws one labelled checkbox above the field rows, ticked while every field is ticked', () => {

                const panel = drawRecipe();
                const contact = expanded(panel, 'Contact');
                const selectAllElement = selectAllOf(panel, contact);

                expect(panel.findAll(panel.objectBodyOf(contact), 'treeFieldSelectAll')).toHaveLength(1);
                expect(selectAllElement.tagName).toBe('button');
                expect(selectAllElement.classList.contains('sdtButton-check')).toBeTrue();
                expect(selectAllElement.attributes.role).toBe('checkbox');
                expect(selectAllElement.attributes['aria-checked']).toBe('true');
                expect(selectAllElement.textContent).toBe('✓');
                expect(selectAllElement.disabled).toBeFalse();
                expect(selectAllElement.attributes.title).toBe('Every field ticked — click to leave every field out that can be unticked');
                expect(selectAllElement.attributes['aria-label']).toBe('All fields of Contact: ' + selectAllElement.attributes.title);
                expect(panel.findAll(selectAllRowOf(panel, contact), 'treeFieldSelectAllLabel')[0].textContent).toBe('All fields');

            });

            it('posts names only: from ticked it unticks, from mixed or unticked it ticks', () => {

                const tickedPanel = drawRecipe();
                selectAllOf(tickedPanel, expanded(tickedPanel, 'Contact')).dispatch('click');
                expect(postedSelectAll(tickedPanel)).toEqual([{ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', included: false }]);

                const mixedPanel = drawRecipe(recipe => untick(recipe, { Contact: ['LastName'] }));
                const mixedContact = expanded(mixedPanel, 'Contact');
                const mixedElement = selectAllOf(mixedPanel, mixedContact);
                expect(mixedElement.attributes['aria-checked']).toBe('mixed');
                expect(mixedElement.textContent).toBe('−');
                expect(mixedElement.attributes.title).toBe('1 of 2 fields ticked — click to tick every field');
                mixedElement.dispatch('click');
                expect(postedSelectAll(mixedPanel)).toEqual([{ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', included: true }]);

                const untickedPanel = drawRecipe(recipe => untick(recipe, { Contact: ['LastName', 'AccountId'] }));
                const untickedContact = expanded(untickedPanel, 'Contact');
                const untickedElement = selectAllOf(untickedPanel, untickedContact);
                expect(untickedElement.attributes['aria-checked']).toBe('false');
                expect(untickedElement.textContent).toBe('');
                panelLabelOf(untickedPanel, untickedContact).dispatch('click');
                expect(postedSelectAll(untickedPanel)).toEqual([{ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', included: true }]);

                // THE BOX ITSELF CHANGES NOTHING: ONLY THE HOST'S ANSWER REDRAWS IT
                expect(untickedElement.attributes['aria-checked']).toBe('false');

            });

            it('carries the object\'s nickname when the row has one', () => {

                const panel = drawRecipe(recipe => { objectOf(recipe, 'Contact').nickname = 'Contact_NickName'; });
                selectAllOf(panel, expanded(panel, 'Contact')).dispatch('click');

                expect(postedSelectAll(panel)).toEqual([{ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', nickname: 'Contact_NickName', included: false }]);

            });

            it('leaves a locked field out of its state, so it reads unticked while the lock keeps that field ticked', () => {

                const recipe = loadRecipe();
                const otherFieldNames = recipeFieldNamesOf(recipe, 'OtherChildObject__c').filter(fieldApiName => fieldApiName !== 'Contact__c');
                expect(otherFieldNames.length).toBeGreaterThan(0);

                const panel = drawRecipe(drawnRecipe => {
                    untick(drawnRecipe, { OtherChildObject__c: otherFieldNames });
                    fieldSelectionOf(treeOf(drawnRecipe, ACCOUNT_TREE_KEY), 'OtherChildObject__c')!.lockedFields.push({ fieldApiName: 'Contact__c', reason: RECIPE_COCKPIT_FIELD_RECORD_TYPE_REASON });
                });
                const other = expanded(panel, 'OtherChildObject__c');

                expect(checkboxOf(panel, other, 'Contact__c').attributes['aria-checked']).toBe('true');
                expect(selectAllOf(panel, other).attributes['aria-checked']).toBe('false');

            });

            it('is hidden while every field is locked, and comes back when a lock goes', () => {

                const recipe = loadRecipe();
                const contactFieldNames = recipeFieldNamesOf(recipe, 'Contact');
                const lockEveryContactField = { objects: [{ objectApiName: 'Contact', excludedFieldApiNames: [] as string[], lockedFields: contactFieldNames.map(fieldApiName => ({ fieldApiName: fieldApiName, reason: RECIPE_COCKPIT_FIELD_RECORD_TYPE_REASON })) }] };

                const panel = drawRecipe(drawnRecipe => { treeOf(drawnRecipe, ACCOUNT_TREE_KEY).fieldSelection = lockEveryContactField; });
                panel.postToPanel({ command: 'rendered' });
                const contact = expanded(panel, 'Contact');
                // THE ROW STAYS FOR CONTACT'S OWN "TODOs only" (#477); THE BOX ITSELF HIDES
                const selectAllCheckOf = () => panel.findAll(selectAllRowOf(panel, contact), 'treeFieldSelectAllCheck')[0];
                expect(panel.isHidden(selectAllRowOf(panel, contact))).toBeFalse();
                expect(panel.isHidden(selectAllCheckOf())).toBeTrue();

                panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3 });
                expect(panel.isHidden(selectAllCheckOf())).toBeFalse();
                expect(selectAllOf(panel, contact).attributes['aria-checked']).toBe('true');

            });

            it('redraws in place when the host answers a single field\'s click', () => {

                const panel = drawRecipe();
                panel.postToPanel({ command: 'rendered' });
                const contact = expanded(panel, 'Contact');
                const selectAllElement = selectAllOf(panel, contact);

                panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, fieldSelection: { objects: [{ objectApiName: 'Contact', excludedFieldApiNames: ['LastName'], lockedFields: [] }] } });
                expect(selectAllOf(panel, contact)).toBe(selectAllElement);
                expect(selectAllElement.attributes['aria-checked']).toBe('mixed');

                panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, fieldSelection: { objects: [{ objectApiName: 'Contact', excludedFieldApiNames: ['LastName', 'AccountId'], lockedFields: [] }] } });
                expect(selectAllElement.attributes['aria-checked']).toBe('false');

            });

            it('is disabled on an excluded object, and a click posts nothing', () => {

                const panel = drawRecipe(recipe => untick(recipe, {}, ['Contact']));
                const contact = expanded(panel, 'Contact');
                const selectAllElement = selectAllOf(panel, contact);

                expect(selectAllElement.disabled).toBeTrue();
                expect(selectAllElement.attributes.title).toBe('Contact is excluded, so its fields are read-only');
                expect(selectAllRowOf(panel, contact).children[0].classList.contains('disabled')).toBeTrue();

                panelLabelOf(panel, contact).dispatch('click');
                expect(postedSelectAll(panel)).toEqual([]);

            });

            it('is drawn on a self-lookup\'s iteration too, which keeps fields of its own (#467)', () => {

                const panel = drawRecipe(recipe => {
                    const accountObject = objectOf(recipe, 'Account');
                    accountObject.nickname = 'Account_NickName';
                    accountObject.iterations = [{ nickname: 'Account_child_NickName', lineNumber: 40, parentObjectApiName: 'Account', parentNickname: 'Account_NickName', fields: [{ fieldApiName: 'Name', lineNumber: 42, recipeValue: '${{fake.Company}}' } as any] }];
                    treeOf(recipe, ACCOUNT_TREE_KEY).objects.push({ objectApiName: 'Account', parentLookups: [], iterationNickname: 'Account_child_NickName' });
                });
                const [account, iteration] = objectsNamed(panel, 'Account');
                panel.expandObject(account);
                panel.expandObject(iteration);

                expect(panel.findAll(panel.objectBodyOf(account), 'treeFieldSelectAll')).toHaveLength(1);
                expect(panel.findAll(panel.objectBodyOf(iteration), 'treeField').length).toBeGreaterThan(0);
                expect(panel.findAll(panel.objectBodyOf(iteration), 'treeFieldSelectAll')).toHaveLength(1);

            });

            it('is not drawn on a card with no folder, or on an object written more than once without distinct nicknames', () => {

                const panel = drawRecipe(recipe => { objectOf(recipe, 'Contact').hasIndistinctOccurrences = true; });
                const ungroupedLead = objectsNamed(panel, 'Lead').find(objectElement => panel.findAll(objectElement, 'treeObjectInclude').length === 0);
                panel.expandObject(ungroupedLead);

                expect(panel.findAll(ungroupedLead, 'treeFieldSelectAll')).toEqual([]);
                expect(panel.findAll(expanded(panel, 'Contact'), 'treeFieldSelectAll')).toEqual([]);

            });

        });

        it('draws no checkbox on the ungrouped card, which has no folder to keep a selection by', () => {

            const panel = drawRecipe();
            const ungroupedLead = objectsNamed(panel, 'Lead').find(objectElement => panel.findAll(objectElement, 'treeObjectInclude').length === 0);
            panel.expandObject(ungroupedLead);

            expect(panel.findAll(ungroupedLead, 'treeFieldInclude')).toEqual([]);
            expect(panel.findAll(ungroupedLead, 'treeFieldBulk')).toEqual([]);

        });

        it('posts a click as names, and leaves the decision to the host', () => {

            const panel = drawRecipe();
            const contact = expanded(panel, 'Contact');

            checkboxOf(panel, contact, 'LastName').dispatch('click');

            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'setFieldIncluded' || hostMessage.command === 'setAllFieldsIncluded')).toEqual([
                { command: 'setFieldIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', fieldApiName: 'LastName', included: false }
            ]);
            expect(checkboxOf(panel, contact, 'LastName').attributes['aria-checked']).toBe('true');

        });

        it('greys an unticked row and keeps its picklist values and ↗ yml working', () => {

            const panel = drawRecipe(recipe => untick(recipe, { Account: ['Regions__c'] }));
            const account = expanded(panel, 'Account');
            const regionsRow = panel.fieldRowNamed(account, 'Regions__c');
            const regionsBox = checkboxOf(panel, account, 'Regions__c');

            expect(regionsRow.classList.contains('fieldExcluded')).toBeTrue();
            expect(regionsBox.attributes['aria-checked']).toBe('false');
            expect(regionsBox.textContent).toBe('');
            expect(regionsBox.attributes.title).toBe('Unticked — click to generate this field');

            panel.findAll(regionsRow, 'picklistToggle')[0].dispatch('click');
            expect(panel.postedHostMessages).toContainEqual({ command: 'loadPicklistValues', objectApiName: 'Account', fieldApiName: 'Regions__c', treeKey: 'Account-thru-OtherChildObject__c' });
            panel.findAll(regionsRow, 'treeFieldSource')[0].dispatch('click');
            expect(panel.postedHostMessages.some(hostMessage => hostMessage.command === 'openSource')).toBeTrue();

            regionsBox.dispatch('click');
            expect(panel.postedHostMessages).toContainEqual({ command: 'setFieldIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', fieldApiName: 'Regions__c', included: true });

        });

        it('disables a locked field with its reason, and a parent-excluded lookup unticked', () => {

            const panel = drawRecipe(recipe => {
                untick(recipe, {});
                const tree = treeOf(recipe, ACCOUNT_TREE_KEY);
                tree.fieldSelection!.objects.push({ objectApiName: 'OtherChildObject__c', excludedFieldApiNames: [], lockedFields: [{ fieldApiName: 'Contact__c', reason: RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON }] });
            });
            const account = expanded(panel, 'Account');
            const other = expanded(panel, 'OtherChildObject__c');

            expect(checkboxOf(panel, account, 'Rating__c').disabled).toBeTrue();
            expect(checkboxOf(panel, account, 'Rating__c').attributes['aria-checked']).toBe('true');
            expect(checkboxOf(panel, account, 'Rating__c').attributes.title).toBe('Cannot be unticked: controls Sub_Rating__c');
            expect(noteOf(panel, account, 'Rating__c').textContent).toBe('controls Sub_Rating__c');
            expect(checkboxOf(panel, other, 'Contact__c').disabled).toBeTrue();
            expect(checkboxOf(panel, other, 'Contact__c').attributes['aria-checked']).toBe('false');
            expect(noteOf(panel, other, 'Contact__c').textContent).toBe('parent excluded');
            expect(panel.fieldRowNamed(other, 'Contact__c').classList.contains('fieldExcluded')).toBeTrue();
            expect(panel.isHidden(noteOf(panel, account, 'Name'))).toBeTrue();

        });

        it('draws an excluded object\'s fields read-only', () => {

            const panel = drawRecipe(recipe => untick(recipe, { Contact: ['LastName'] }, ['Contact']));
            const contact = expanded(panel, 'Contact');

            expect(checkboxOf(panel, contact, 'LastName').disabled).toBeTrue();
            expect(checkboxOf(panel, contact, 'AccountId').disabled).toBeTrue();
            expect(checkboxOf(panel, contact, 'AccountId').attributes.title).toBe('Contact is excluded, so its fields are read-only');

        });

        it('warns on the row when every field is unticked', () => {

            const panel = drawRecipe(recipe => untick(recipe, { Contact: ['LastName', 'AccountId'] }));
            const warningElement = panel.findAll(objectNamed(panel, 'Contact').children[0], 'treeFieldWarning')[0];

            expect(warningElement.textContent).toBe(RECIPE_COCKPIT_EVERY_FIELD_UNTICKED_WARNING);
            expect(panel.isHidden(warningElement)).toBeFalse();
            expect(panel.isHidden(panel.findAll(objectNamed(panel, 'Account').children[0], 'treeFieldWarning')[0])).toBeTrue();

        });

        // THE COMPARISON THAT SAID WHICH FIELDS AN ORG REQUIRES IS GONE (#266); THE INSERT'S OWN READINESS STILL REFUSES ONE
        it('draws no "required in <org>" note on an unticked field, and ignores an orgDescribe message', () => {

            const panel = drawRecipe(recipe => untick(recipe, { Contact: ['LastName'] }));
            panel.postToPanel({ command: 'rendered' });
            const contact = expanded(panel, 'Contact');

            panel.postToPanel({
                command: 'orgDescribe', treeKey: ACCOUNT_TREE_KEY, orgLabel: 'qa (qa@example.com.qa)', summary: 'Described', isFailure: false, isCancelled: false,
                objects: [], diff: { objects: [], statusCounts: {} }, renderSequence: 3,
                requiredFields: [{ objectApiName: 'Contact', fieldApiNames: ['LastName', 'AccountId'] }]
            });

            expect(panel.isHidden(noteOf(panel, contact, 'LastName'))).toBeTrue();
            expect(panel.isHidden(noteOf(panel, contact, 'AccountId'))).toBeTrue();
            expect(panel.findAll(panel.treeCards()[0], 'treeTab').map(tab => tab.textContent)).not.toContain('Compare');

        });

        it('redraws the card the host names in place, and shows Reset, at the top of the Treecipe tab, only while the card leaves something out', () => {

            const panel = drawRecipe();
            panel.postToPanel({ command: 'rendered' });
            const contact = expanded(panel, 'Contact');
            const resetElement = panel.findAll(panel.treeCards()[0], 'treeResetSelection')[0];
            expect(panel.findAll(panel.findAll(panel.treeCards()[0], 'treecipeHeader')[0], 'treeResetSelection')).toEqual([resetElement]);
            expect(panel.findAll(panel.findAll(panel.treeCards()[0], 'treeHeaderActions')[0] ?? {}, 'treeResetSelection')).toEqual([]);
            expect(panel.isHidden(resetElement)).toBeTrue();

            const fieldSelection = { objects: [{ objectApiName: 'Contact', excludedFieldApiNames: ['LastName'], lockedFields: [] as any[] }] };
            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 99, fieldSelection });
            expect(checkboxOf(panel, contact, 'LastName').attributes['aria-checked']).toBe('true');

            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, fieldSelection });
            expect(checkboxOf(panel, contact, 'LastName').attributes['aria-checked']).toBe('false');
            expect(panel.isHidden(resetElement)).toBeFalse();

            resetElement.dispatch('click');
            expect(panel.postedHostMessages).toContainEqual({ command: 'resetTreeSelection', treeKey: ACCOUNT_TREE_KEY });
            expect(panel.isHidden(panel.findAll(panel.treeCards()[1], 'treeResetSelection')[0])).toBeTrue();

            // A STORED RECORD COUNT ALONE IS SOMETHING TO RESET TOO
            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3 });
            expect(panel.isHidden(resetElement)).toBeTrue();
            panel.postToPanel({ command: 'objectSelection', treeKey: ACCOUNT_TREE_KEY, renderSequence: 3, objectCounts: [{ objectApiName: 'Contact', count: 4 }] });
            expect(panel.isHidden(resetElement)).toBeFalse();

        });

    });

});
