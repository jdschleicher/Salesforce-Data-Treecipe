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
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel,
    RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON,
    RECIPE_COCKPIT_NO_FIELDS_SELECTED_MESSAGE,
    RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    RECIPE_COCKPIT_UNGROUPED_TREE_TITLE
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';

/*
    #611: an object whose every field is unticked is not generated. The host leaves it out as a
    noFieldsSelected exclusion, which cuts off its children like a chain-link exclusion, and the
    panel draws one red message in place of everything after the object's name. Ticking any field
    brings it back. The faker-js journey is in acceptance/TreecipeTabJourneys.ts.
*/

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const ACCOUNT_RECIPE_FILE_PATH = path.join(HISTORY_GENERATED_RECIPES_PATH, CURRENT_RUN_FOLDER_NAME, ACCOUNT_TREE_KEY, `recipe--${ACCOUNT_TREE_KEY}-2026-09-20T10-00-00.yml`);
const CONTACT_FIELDS = ['LastName', 'AccountId'];

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT,
    CURRENT_RUN_FOLDER_NAME
).recipeViewModel;

const treeOf = (recipe: IRecipeCockpitRecipeViewModel) => recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY) as IRecipeCockpitTreeViewModel;
const exclusionsOf = (tree: IRecipeCockpitTreeViewModel) => tree.objectSelection?.exclusions;

const untick = (recipe: IRecipeCockpitRecipeViewModel, fieldsByObject: Record<string, string[]>, excludedObjectApiNames: string[] = []) => RecipeCockpitService.applyObjectSelections(
    recipe,
    new Map(excludedObjectApiNames.length > 0 ? [[ACCOUNT_TREE_KEY, new Set(excludedObjectApiNames)]] : []),
    new Map([[ACCOUNT_TREE_KEY, new Map(Object.entries(fieldsByObject).map(([objectApiName, fieldApiNames]) => [objectApiName, new Set(fieldApiNames)]))]])
);

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

const storedFieldSelections = (excludedFieldApiNamesByFolderName: Record<string, unknown>) => ({
    version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    excludedObjectApiNamesByFolderName: {},
    excludedFieldApiNamesByFolderName: excludedFieldApiNamesByFolderName,
    objectCountsByFolderName: {},
    validationRulesOffByFolderName: {}
});

answerInPanelConfirmationsThroughWarningMock();

beforeEach(() => {
    jest.spyOn(SalesforceOrgService, 'readScratchOrgDetail').mockResolvedValue(undefined);
});

describe('RecipeCockpitService, an object with no fields selected (#611)', () => {

    describe('applyObjectSelections', () => {

        it('leaves the object out as noFieldsSelected and auto-excludes the child it cuts off', () => {

            const recipe = loadRecipe();
            untick(recipe, { Contact: CONTACT_FIELDS });
            const tree = treeOf(recipe);

            expect(exclusionsOf(tree)).toEqual([
                { objectApiName: 'Contact', kind: 'noFieldsSelected' },
                { objectApiName: 'OtherChildObject__c', kind: 'autoExcluded', excludedParentObjectApiName: 'Contact' }
            ]);
            expect(tree.objectSelection).toMatchObject({ includedObjectCount: 1, objectCount: 3 });
            // ITS FIELDS STAY ON THE CARD, SO THE PANEL CAN TICK ONE AGAIN; NONE IS LISTED FOR GENERATION, SINCE THE OBJECT GOES WHOLE
            expect(tree.fieldSelection?.objects.find(objectFieldSelection => objectFieldSelection.objectApiName === 'Contact')).toMatchObject({ excludedFieldApiNames: CONTACT_FIELDS, isEveryFieldExcluded: true });
            expect([...RecipeCockpitService.listExcludedFieldApiNamesByObject(tree)]).toEqual([]);
            expect(RecipeCockpitService.listNoFieldsSelectedObjectApiNames(tree)).toEqual(['Contact']);
            expect(RecipeCockpitService.listFieldReadOnlyObjectApiNames(tree)).toEqual(['OtherChildObject__c']);

        });

        it('keeps a chain-link exclusion as excluded, and an object with one field ticked as it was', () => {

            const excludedRecipe = loadRecipe();
            untick(excludedRecipe, { Contact: CONTACT_FIELDS }, ['Contact']);
            expect(exclusionsOf(treeOf(excludedRecipe))?.[0]).toEqual({ objectApiName: 'Contact', kind: 'excluded' });

            const partlyUntickedRecipe = loadRecipe();
            untick(partlyUntickedRecipe, { Contact: ['LastName'] });
            expect(treeOf(partlyUntickedRecipe).objectSelection).toBeUndefined();

        });

        it('cuts off a kept child whose only ticked field was its lookup to the no-fields parent, until nothing changes', () => {

            const recipe = loadRecipe();
            // OtherChildObject__c GIVEN Account AS A SECOND PARENT THROUGH Ratio__c, WHICH IS UNTICKED: ITS ONE TICKED FIELD IS Contact__c
            treeOf(recipe).objects.find(treeObject => treeObject.objectApiName === 'OtherChildObject__c')!.parentLookups.push({ fieldApiName: 'Ratio__c', parentObjectApiName: 'Account' });
            untick(recipe, { Contact: CONTACT_FIELDS, OtherChildObject__c: ['Score__c', 'Ratio__c'] });
            const tree = treeOf(recipe);

            expect(exclusionsOf(tree)).toEqual([
                { objectApiName: 'Contact', kind: 'noFieldsSelected' },
                { objectApiName: 'OtherChildObject__c', kind: 'noFieldsSelected' }
            ]);

        });

        it('locks a kept child\'s lookup to the no-fields parent as parent excluded', () => {

            const recipe = loadRecipe();
            treeOf(recipe).objects.find(treeObject => treeObject.objectApiName === 'OtherChildObject__c')!.parentLookups.push({ fieldApiName: 'Ratio__c', parentObjectApiName: 'Account' });
            untick(recipe, { Contact: CONTACT_FIELDS });
            const tree = treeOf(recipe);

            expect(exclusionsOf(tree)).toEqual([{ objectApiName: 'Contact', kind: 'noFieldsSelected' }]);
            expect(tree.objectSelection?.disabledLookups).toEqual([{ objectApiName: 'OtherChildObject__c', fieldApiName: 'Contact__c', parentObjectApiName: 'Contact' }]);
            expect(tree.fieldSelection?.objects.find(objectFieldSelection => objectFieldSelection.objectApiName === 'OtherChildObject__c')?.lockedFields)
                .toEqual([{ fieldApiName: 'Contact__c', reason: RECIPE_COCKPIT_FIELD_PARENT_EXCLUDED_REASON }]);

        });

        it('names the object in the insert confirmation\'s Left out section', () => {

            const recipe = loadRecipe();
            untick(recipe, { Contact: CONTACT_FIELDS });

            expect(RecipeCockpitService.buildInsertLeftOutLines(treeOf(recipe)).lines).toEqual(expect.arrayContaining([
                'Contact: not generated, no fields selected',
                'OtherChildObject__c: not generated, auto-excluded with its parent Contact'
            ]));

        });

    });

    describe('Run Faker', () => {

        it('builds the snowfakery copy without the object and the child it cuts off, with every other line unchanged', () => {

            const recipe = loadRecipe();
            untick(recipe, { Contact: CONTACT_FIELDS });
            const recipeText = fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8');

            const filteredRecipe = RecipeCockpitService.buildRunFakerFilteredRecipe(recipeText, treeOf(recipe), undefined, recipe);

            if ( 'refusalMessage' in filteredRecipe ) {
                throw new Error(filteredRecipe.refusalMessage);
            }
            expect(filteredRecipe.excludedObjectApiNames).toEqual(['Contact', 'OtherChildObject__c']);
            expect([...filteredRecipe.recipeText.matchAll(/^- object: (\S+)$/gm)].map(objectLine => objectLine[1])).toEqual(['Account']);
            const accountBlock = recipeText.slice(recipeText.indexOf('- object: Account'), recipeText.indexOf('# Level 1 - Contact'));
            expect(filteredRecipe.recipeText).toContain(accountBlock.trimEnd());

        });

    });

    describe('listNoFieldsSelectedIterationKeys', () => {

        it('lists an iteration with no field ticked by its occurrence key, never a first occurrence, nor an excluded object\'s', () => {

            const tree = {
                treeKey: 'Account-ONLY',
                title: 'Account',
                folderName: 'Account-ONLY',
                fieldCount: 2,
                objects: [
                    { objectApiName: 'Account', parentLookups: [] },
                    { objectApiName: 'Account', parentLookups: [], iterationNickname: 'Account_child_NickName' },
                    { objectApiName: 'Contact', parentLookups: [], iterationNickname: 'Contact_child_NickName' }
                ],
                fieldSelection: { objects: [
                    { objectApiName: 'Account', nickname: 'Account_NickName', excludedFieldApiNames: ['Name'], lockedFields: [], isEveryFieldExcluded: true as const },
                    { objectApiName: 'Account', nickname: 'Account_child_NickName', excludedFieldApiNames: ['Name'], lockedFields: [], isEveryFieldExcluded: true as const },
                    { objectApiName: 'Contact', nickname: 'Contact_child_NickName', excludedFieldApiNames: ['LastName'], lockedFields: [], isEveryFieldExcluded: true as const }
                ] },
                objectSelection: { exclusions: [{ objectApiName: 'Contact', kind: 'excluded' as const }], disabledLookups: [], includedObjectCount: 1, objectCount: 2 }
            } as IRecipeCockpitTreeViewModel;

            expect(RecipeCockpitService.listNoFieldsSelectedIterationKeys(tree)).toEqual(['Account\nAccount_child_NickName']);

        });

    });

    describe('openRecipeCockpitPanel', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let disposeHandler: (() => void) | undefined;
        let postedPanelMessages: any[];

        const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);

        const openAndDraw = async (workspaceState: ReturnType<typeof buildWorkspaceState>) => {
            await RecipeCockpitService.openRecipeCockpitPanel(HISTORY_WORKSPACE_ROOT, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            const recipeDataMessage = lastPosted('recipeData');
            await receivedMessageHandler({ command: 'rendered', renderSequence: recipeDataMessage.renderSequence });
            return recipeDataMessage;
        };

        beforeEach(() => {
            postedPanelMessages = [];
            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => ({
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
            }));
            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => ({ text: initialMessage, dispose: jest.fn() }) as any);
        });

        afterEach(() => {
            disposeHandler?.();
            disposeHandler = undefined;
        });

        it('refuses the chain link of a no-fields object, and a ticked field brings it back', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedFieldSelections({ [ACCOUNT_TREE_KEY]: { Contact: CONTACT_FIELDS } }) });
            await openAndDraw(workspaceState);
            workspaceState.update.mockClear();

            await receivedMessageHandler({ command: 'setObjectIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', included: false });
            await receivedMessageHandler({ command: 'setObjectIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', included: true });
            expect(workspaceState.update).not.toHaveBeenCalled();

            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', fieldApiName: 'LastName', included: true });

            expect(workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY)).toEqual(storedFieldSelections({ [ACCOUNT_TREE_KEY]: { Contact: ['AccountId'] } }));
            expect(lastPosted('objectSelection').objectSelection).toBeUndefined();

        });

        it('lets All fields tick every field of a no-fields object, and never a field of the child it cut off', async () => {

            const workspaceState = buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedFieldSelections({ [ACCOUNT_TREE_KEY]: { Contact: CONTACT_FIELDS } }) });
            await openAndDraw(workspaceState);
            workspaceState.update.mockClear();

            await receivedMessageHandler({ command: 'setFieldIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'OtherChildObject__c', fieldApiName: 'Score__c', included: false });
            expect(workspaceState.update).not.toHaveBeenCalled();

            await receivedMessageHandler({ command: 'setAllFieldsIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', included: true });
            expect(workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY)).toEqual(storedFieldSelections({}));

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
            return { panel, recipe };
        };

        const objectNamed = (panel: ReturnType<typeof runPanelScript>, objectApiName: string) => panel.objectElements().find(objectElement => panel.objectNameOf(objectElement) === objectApiName);
        const headerOf = (panel: ReturnType<typeof runPanelScript>, objectApiName: string) => objectNamed(panel, objectApiName).children[0];
        const messageOf = (panel: ReturnType<typeof runPanelScript>, objectApiName: string) => panel.findAll(headerOf(panel, objectApiName), 'treeNoFieldsSelected')[0];
        const includeOf = (panel: ReturnType<typeof runPanelScript>, objectApiName: string) => panel.findAll(headerOf(panel, objectApiName), 'treeObjectInclude')[0];
        // WHAT FOLLOWS THE NAME ON THE ROW, LESS THE MESSAGE ITSELF
        const detailsOf = (panel: ReturnType<typeof runPanelScript>, objectApiName: string) => {
            const headerChildren = headerOf(panel, objectApiName).children;
            const nameIndex = headerChildren.findIndex((element: any) => element.classList.contains('treeObjectName'));
            return headerChildren.slice(nameIndex + 1).filter((element: any) => !element.classList.contains('treeNoFieldsSelected'));
        };

        it('draws only the red message after the name, a red disabled chain link, and leaves the row undimmed', () => {

            const { panel } = drawRecipe(recipe => untick(recipe, { Contact: CONTACT_FIELDS }));
            const contactInclude = includeOf(panel, 'Contact');

            expect(messageOf(panel, 'Contact').textContent).toBe(RECIPE_COCKPIT_NO_FIELDS_SELECTED_MESSAGE);
            expect(panel.isHidden(messageOf(panel, 'Contact'))).toBeFalse();
            expect(detailsOf(panel, 'Contact').length).toBeGreaterThan(0);
            expect(detailsOf(panel, 'Contact').every((element: any) => element.classList.contains('noFieldsSelectedHidden'))).toBeTrue();
            // #612's "Get latest object detail" button is a header detail too, so it hides with the rest
            expect(detailsOf(panel, 'Contact').some((element: any) => element.classList.contains('treeObjectRefresh'))).toBeTrue();
            expect(panel.findAll(headerOf(panel, 'Contact'), 'treeObjectToggle')[0].disabled).toBeFalsy();

            expect(contactInclude.disabled).toBeTrue();
            expect(contactInclude.children[0].attributes.class).toBe('treeGlyph noFieldsSelected');
            expect(contactInclude.attributes.title).toBe('No fields selected, so no records will be generated. Tick a field to include it');
            expect(objectNamed(panel, 'Contact').classList.contains('excluded')).toBeFalse();
            expect(objectNamed(panel, 'Contact').classList.contains('noFieldsSelected')).toBeTrue();

            expect(panel.findAll(headerOf(panel, 'OtherChildObject__c'), 'treeExclusion')[0].textContent).toBe('auto-excluded — parent Contact has no fields selected');
            expect(includeOf(panel, 'OtherChildObject__c').attributes.title).toBe('Excluded because parent Contact has no fields selected');
            expect(panel.isHidden(messageOf(panel, 'OtherChildObject__c'))).toBeTrue();
            expect(panel.isHidden(messageOf(panel, 'Account'))).toBeTrue();

        });

        it('keeps the no-fields object\'s boxes clickable, and its child\'s read-only', () => {

            const { panel } = drawRecipe(recipe => untick(recipe, { Contact: CONTACT_FIELDS }));
            const contact = objectNamed(panel, 'Contact');
            const otherChild = objectNamed(panel, 'OtherChildObject__c');
            panel.expandObject(contact);
            panel.expandObject(otherChild);

            expect(panel.findAll(panel.fieldRowNamed(contact, 'LastName'), 'treeFieldInclude')[0].disabled).toBeFalse();
            expect(panel.findAll(panel.objectBodyOf(contact), 'treeFieldSelectAll')[0].disabled).toBeFalse();
            expect(panel.findAll(panel.fieldRowNamed(otherChild, 'Score__c'), 'treeFieldInclude')[0].disabled).toBeTrue();

        });

        it('puts the row back when the host answers that a field is ticked again', () => {

            const { panel, recipe } = drawRecipe(recipe => untick(recipe, { Contact: CONTACT_FIELDS }));
            untick(recipe, { Contact: ['LastName'] });
            const tree = treeOf(recipe);
            panel.postToPanel({ command: 'objectSelection', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, fieldSelection: tree.fieldSelection });

            expect(panel.isHidden(messageOf(panel, 'Contact'))).toBeTrue();
            expect(detailsOf(panel, 'Contact').some((element: any) => element.classList.contains('noFieldsSelectedHidden'))).toBeFalse();
            expect(includeOf(panel, 'Contact').disabled).toBeFalse();
            expect(includeOf(panel, 'Contact').children[0].attributes.class).toBe('treeGlyph included');
            expect(objectNamed(panel, 'Contact').classList.contains('noFieldsSelected')).toBeFalse();

        });

    });

});
