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
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    IRecipeCockpitTreeViewModel,
    RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY,
    RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    RECIPE_COCKPIT_EXCLUDED_IN_STRUCTURE_REASON,
    RECIPE_COCKPIT_RUN_FAKER_COMMAND,
    RECIPE_COCKPIT_TREE_GLYPH_PATH,
    RECIPE_COCKPIT_UNGROUPED_TREE_TITLE
} from '../RecipeCockpitService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

/*
    #219: a tree icon on each Structure row includes or excludes an object, and its children follow.
    The HOST keeps what the reader excluded by tree folder in workspaceState, computes the cascade,
    and posts it; ▶ Run Faker generates from a filtered copy and Create refuses an excluded object.
*/

const HISTORY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'historyWorkspace');
const HISTORY_GENERATED_RECIPES_PATH = path.join(HISTORY_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes');
const CURRENT_RUN_FOLDER_NAME = 'recipe-2026-09-20T10-00-00';
const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LEAD_TREE_KEY = 'Lead-ONLY';
const ACCOUNT_RECIPE_FILE_PATH = path.join(HISTORY_GENERATED_RECIPES_PATH, CURRENT_RUN_FOLDER_NAME, ACCOUNT_TREE_KEY, `recipe--${ACCOUNT_TREE_KEY}-2026-09-20T10-00-00.yml`);

const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
    RecipeCockpitService.findGeneratedRecipeRuns(HISTORY_GENERATED_RECIPES_PATH),
    HISTORY_WORKSPACE_ROOT,
    CURRENT_RUN_FOLDER_NAME
).recipeViewModel;

const buildUngroupedTree = (): IRecipeCockpitTreeViewModel => ({
    treeKey: '',
    title: RECIPE_COCKPIT_UNGROUPED_TREE_TITLE,
    folderName: '',
    objects: [],
    fieldCount: 0
});

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

const storedSelections = (excludedObjectApiNamesByFolderName: Record<string, unknown>) => ({
    version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION,
    excludedObjectApiNamesByFolderName: excludedObjectApiNamesByFolderName
});

const treeOf = (recipe: IRecipeCockpitRecipeViewModel, treeKey: string) => recipe.trees.find(tree => tree.treeKey === treeKey) as IRecipeCockpitTreeViewModel;

describe('RecipeCockpitService, excluding objects in Structure (#219)', () => {

    describe('parseRecipeSource', () => {

        it('marks an object written twice with no nickname to tell the occurrences apart, and not one told apart by nickname', () => {

            const indistinct = RecipeCockpitService.parseRecipeSource('- object: Account\n  fields:\n    Name: a\n- object: Account\n  fields:\n    Name: b\n');
            const distinct = RecipeCockpitService.parseRecipeSource([
                '- object: Account', '  nickname: Account_NickName', '  fields:', '    Name: a', '  friends:',
                '    - object: Account', '      nickname: Account_child_NickName', '      fields:', '        ParentId: Account_NickName', ''
            ].join('\n'));

            expect(indistinct.get('Account')?.hasIndistinctOccurrences).toBeTrue();
            expect(distinct.get('Account')?.hasIndistinctOccurrences).toBeUndefined();
            expect(distinct.get('Account')?.iterations).toHaveLength(1);

        });

    });

    describe('applyObjectSelections', () => {

        it('leaves every card as it was when nothing is excluded', () => {

            const recipe = loadRecipe();
            const before = JSON.stringify(recipe);

            RecipeCockpitService.applyObjectSelections(recipe, new Map());

            expect(JSON.stringify(recipe)).toBe(before);
            expect(recipe.trees.every(tree => !('objectSelection' in tree))).toBeTrue();

        });

        it('excludes the object, auto-excludes its only child, and counts only the objects the card draws', () => {

            const recipe = loadRecipe();

            RecipeCockpitService.applyObjectSelections(recipe, new Map([[ACCOUNT_TREE_KEY, new Set(['Contact'])]]));

            expect(treeOf(recipe, ACCOUNT_TREE_KEY).objectSelection).toEqual({
                exclusions: [
                    { objectApiName: 'Contact', kind: 'excluded' },
                    { objectApiName: 'OtherChildObject__c', kind: 'autoExcluded', excludedParentObjectApiName: 'Contact' }
                ],
                disabledLookups: [],
                // User IS A LOOKUP TARGET WITH NO RECIPE: IN THE TREE, NOT DRAWN, NOT COUNTED
                includedObjectCount: 1,
                objectCount: 3
            });
            expect(treeOf(recipe, LEAD_TREE_KEY).objectSelection).toBeUndefined();

        });

        it('drops a stale name silently, and never applies a selection to the ungrouped card', () => {

            const recipe = loadRecipe();
            recipe.trees.push(buildUngroupedTree());

            RecipeCockpitService.applyObjectSelections(recipe, new Map([
                [ACCOUNT_TREE_KEY, new Set(['Gone__c', 'User'])],
                ['', new Set(['Lead'])],
                ['Vanished-Tree', new Set(['Account'])]
            ]));

            expect(recipe.trees.every(tree => tree.objectSelection === undefined)).toBeTrue();

        });

        it('lists every excluded object of a card, the auto-excluded ones included', () => {

            const recipe = loadRecipe();
            RecipeCockpitService.applyObjectSelections(recipe, new Map([[ACCOUNT_TREE_KEY, new Set(['Account'])]]));

            expect(RecipeCockpitService.listExcludedObjectApiNames(treeOf(recipe, ACCOUNT_TREE_KEY))).toEqual(['Account', 'Contact', 'OtherChildObject__c']);
            expect(RecipeCockpitService.listExcludedObjectApiNames(treeOf(recipe, LEAD_TREE_KEY))).toEqual([]);

        });

    });

    describe('readObjectSelections and writeObjectSelections', () => {

        it('writes what it reads back, a folder named __proto__ included', async () => {

            const workspaceState = buildWorkspaceState();
            const selections = new Map([[ACCOUNT_TREE_KEY, new Set(['Contact'])], ['__proto__', new Set(['Lead'])]]);

            await expect(RecipeCockpitService.writeObjectSelections(workspaceState, selections)).resolves.toBeTrue();

            expect(workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY)).toEqual(storedSelections({ [ACCOUNT_TREE_KEY]: ['Contact'], ['__proto__']: ['Lead'] }));
            expect(RecipeCockpitService.readObjectSelections(workspaceState)).toEqual(selections);

        });

        it('writes no entry for a folder with nothing excluded', async () => {

            const workspaceState = buildWorkspaceState();

            await RecipeCockpitService.writeObjectSelections(workspaceState, new Map([[ACCOUNT_TREE_KEY, new Set<string>()], [LEAD_TREE_KEY, new Set(['Lead'])]]));

            expect(workspaceState.storedValues.get(RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY)).toEqual(storedSelections({ [LEAD_TREE_KEY]: ['Lead'] }));

        });

        it('reads nothing from another shape or version, and drops every entry that is not a folder of object api names', () => {

            const read = (storedValue: unknown) => RecipeCockpitService.readObjectSelections(buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedValue }));

            expect(read(undefined).size).toBe(0);
            expect(read('Contact').size).toBe(0);
            expect(read({ ...storedSelections({ [ACCOUNT_TREE_KEY]: ['Contact'] }), version: RECIPE_COCKPIT_OBJECT_SELECTION_VERSION + 1 }).size).toBe(0);
            expect(RecipeCockpitService.readObjectSelections({ get: () => { throw new Error('no state'); }, update: jest.fn() } as any).size).toBe(0);

            expect(read(storedSelections({
                [ACCOUNT_TREE_KEY]: ['Contact', 'Bad\nName', 7, ''],
                [LEAD_TREE_KEY]: 'Lead',
                '': ['Lead'],
                'Empty-Tree': []
            }))).toEqual(new Map([[ACCOUNT_TREE_KEY, new Set(['Contact'])]]));

        });

        it('given no workspace state, or a write that fails, says so and answers false', async () => {

            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            const failingState = { get: jest.fn(), update: jest.fn(() => Promise.reject(new Error('[disk](command:x) full'))) };

            await expect(RecipeCockpitService.writeObjectSelections(undefined, new Map())).resolves.toBeFalse();
            await expect(RecipeCockpitService.writeObjectSelections(failingState as any, new Map())).resolves.toBeFalse();

            expect(warningSpy).toHaveBeenCalledTimes(2);
            expect(warningSpy.mock.calls[1][0]).not.toContain('[disk](command:x)');

        });

    });

    describe('routePanelMessage, setObjectIncluded', () => {

        const buildDrawnPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState(HISTORY_WORKSPACE_ROOT);
            const recipe = loadRecipe();
            recipe.trees.push(buildUngroupedTree());
            panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 4 };
            panelState.treeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipe);
            return panelState;
        };

        it('allows each object a card with a folder draws, once, and nothing else', () => {

            expect([...RecipeCockpitService.collectTreeHistoryAllowLists(buildDrawnPanelState().recipeDataMessage!.recipe).selectableObjectKeys]).toEqual([
                `${ACCOUNT_TREE_KEY}\nAccount`,
                `${ACCOUNT_TREE_KEY}\nContact`,
                `${ACCOUNT_TREE_KEY}\nOtherChildObject__c`,
                `${LEAD_TREE_KEY}\nLead`
            ]);

        });

        it('leaves out an object written twice with no nickname to tell the occurrences apart', () => {

            const recipe = buildDrawnPanelState().recipeDataMessage!.recipe;
            recipe.objects.find(objectViewModel => objectViewModel.objectApiName === 'Contact')!.hasIndistinctOccurrences = true;

            expect([...RecipeCockpitService.collectTreeHistoryAllowLists(recipe).selectableObjectKeys]).not.toContain(`${ACCOUNT_TREE_KEY}\nContact`);

        });

        it('routes a drawn object to its folder, carrying whether it should now be included', () => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'setObjectIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', included: false }, buildDrawnPanelState()))
                .toEqual({ kind: 'setObjectIncluded', treeKey: ACCOUNT_TREE_KEY, folderName: ACCOUNT_TREE_KEY, objectApiName: 'Contact', isIncluded: false });
            expect(RecipeCockpitService.routePanelMessage({ command: 'setObjectIncluded', treeKey: LEAD_TREE_KEY, objectApiName: 'Lead', included: true }, buildDrawnPanelState()))
                .toMatchObject({ isIncluded: true });

        });

        it.each([
            ['an object the card does not draw', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'User', included: false }],
            ['an object of another card', { treeKey: LEAD_TREE_KEY, objectApiName: 'Contact', included: false }],
            ['the ungrouped card', { treeKey: '', objectApiName: 'Lead', included: false }],
            ['an included that is not a boolean', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', included: 'false' }],
            ['a tree key that is not a string', { treeKey: 7, objectApiName: 'Contact', included: false }],
            ['a nickname the object is not drawn with', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', nickname: 'Account_NickName', included: false }],
            ['a nickname that is not a string', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', nickname: 7, included: false }]
        ])('does nothing for %s', (_caseName, payload) => {

            expect(RecipeCockpitService.routePanelMessage({ command: 'setObjectIncluded', ...payload } as any, buildDrawnPanelState())).toBeUndefined();

        });

        it('does nothing before "rendered", after "ready" or a failure to draw, or with no model', () => {

            const undrawnPanelState = buildDrawnPanelState();
            undrawnPanelState.treeHistoryAllowLists = RecipeCockpitService.buildEmptyTreeHistoryAllowLists();
            expect(RecipeCockpitService.routePanelMessage({ command: 'setObjectIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', included: false }, undrawnPanelState)).toBeUndefined();

            const modelLessPanelState = buildDrawnPanelState();
            modelLessPanelState.recipeDataMessage = undefined;
            expect(RecipeCockpitService.routePanelMessage({ command: 'setObjectIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', included: false }, modelLessPanelState)).toBeUndefined();

        });

        it('refuses a Create of an object the card excludes, whatever the panel posted', () => {

            const panelState = buildDrawnPanelState();
            RecipeCockpitService.applyObjectSelections(panelState.recipeDataMessage!.recipe, new Map([[ACCOUNT_TREE_KEY, new Set(['Contact'])]]));
            panelState.dataOrgSelection = { orgIndex: 0, orgDetail: { targetOrgIdentifier: 'qa', username: 'qa@example.com.qa' } as any, requestSequence: 1, orgTypeDetail: { isSandbox: true } as any };
            panelState.creatableObjectKeys = new Set([
                RecipeCockpitService.buildCreatableObjectKey(ACCOUNT_TREE_KEY, 'Account'),
                RecipeCockpitService.buildCreatableObjectKey(ACCOUNT_TREE_KEY, 'OtherChildObject__c')
            ]);
            panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.set(ACCOUNT_TREE_KEY, ACCOUNT_RECIPE_FILE_PATH);

            expect(RecipeCockpitService.routePanelMessage({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', count: 1 }, panelState))
                .toMatchObject({ kind: 'createRecords' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'createRecords', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'OtherChildObject__c', count: 1 }, panelState))
                .toMatchObject({ kind: 'postCreateState', hostMessage: { isRunning: false } });

        });

    });

    describe('openRecipeCockpitPanel', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let disposeHandler: (() => void) | undefined;
        let postedPanelMessages: any[];

        const lastPosted = (command: string) => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === command);
        const executeCommand = vscode.commands.executeCommand as jest.Mock;

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
            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => buildWebviewPanel());
            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation((initialMessage: string) => ({ text: initialMessage, dispose: jest.fn() }) as any);
        });

        afterEach(() => {
            disposeHandler?.();
            disposeHandler = undefined;
        });

        it('draws the exclusions workspaceState kept for the folder', async () => {

            const recipeDataMessage = await openAndDraw(buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: ['Contact'] }) }));

            expect(treeOf(recipeDataMessage.recipe, ACCOUNT_TREE_KEY).objectSelection?.exclusions.map((exclusion: any) => exclusion.objectApiName)).toEqual(['Contact', 'OtherChildObject__c']);

        });

        it('keeps a toggle, posts the cascade back in place, and a reveal and a reopen both draw it', async () => {

            const workspaceState = buildWorkspaceState();
            const recipeDataMessage = await openAndDraw(workspaceState);

            await receivedMessageHandler({ command: 'setObjectIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', included: false });

            expect(storedOf(workspaceState)).toEqual(storedSelections({ [ACCOUNT_TREE_KEY]: ['Contact'] }));
            expect(lastPosted('objectSelection')).toEqual({
                command: 'objectSelection',
                renderSequence: recipeDataMessage.renderSequence,
                treeKey: ACCOUNT_TREE_KEY,
                objectSelection: {
                    exclusions: [
                        { objectApiName: 'Contact', kind: 'excluded' },
                        { objectApiName: 'OtherChildObject__c', kind: 'autoExcluded', excludedParentObjectApiName: 'Contact' }
                    ],
                    disabledLookups: [],
                    includedObjectCount: 1,
                    objectCount: 3
                }
            });

            // A REVEAL REPLAYS THE STORED MODEL, WHICH CARRIES THE SELECTION
            postedPanelMessages = [];
            await receivedMessageHandler({ command: 'ready' });
            expect(treeOf(lastPosted('recipeData').recipe, ACCOUNT_TREE_KEY).objectSelection?.includedObjectCount).toBe(1);

            // INCLUDING IT AGAIN BRINGS BACK EXACTLY WHAT IT AUTO-EXCLUDED
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastPosted('recipeData').renderSequence });
            await receivedMessageHandler({ command: 'setObjectIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', included: true });

            expect(storedOf(workspaceState)).toEqual(storedSelections({}));
            expect(lastPosted('objectSelection')).toEqual({ command: 'objectSelection', renderSequence: recipeDataMessage.renderSequence, treeKey: ACCOUNT_TREE_KEY });

        });

        it('given a write that fails, posts nothing and generates as before', async () => {

            const workspaceState = buildWorkspaceState();
            await openAndDraw(workspaceState);
            jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            workspaceState.update.mockImplementation(() => Promise.reject(new Error('read-only')));

            await receivedMessageHandler({ command: 'setObjectIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', included: false });

            expect(lastPosted('objectSelection')).toBeUndefined();

        });

        it('runs a card with nothing excluded on its recipe exactly as before', async () => {

            await openAndDraw(buildWorkspaceState());

            await receivedMessageHandler({ command: 'runFaker', treeKey: ACCOUNT_TREE_KEY });

            expect(executeCommand).toHaveBeenCalledWith(RECIPE_COCKPIT_RUN_FAKER_COMMAND, ACCOUNT_RECIPE_FILE_PATH);
            expect(executeCommand.mock.calls.find(call => call[0] === RECIPE_COCKPIT_RUN_FAKER_COMMAND)).toHaveLength(2);

        });

        it('runs a card with exclusions on a filtered copy, and never writes the recipe', async () => {

            const recipeBefore = fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8');
            await openAndDraw(buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: ['Contact'] }) }));

            await receivedMessageHandler({ command: 'runFaker', treeKey: ACCOUNT_TREE_KEY });

            const runFakerCall = executeCommand.mock.calls.find(call => call[0] === RECIPE_COCKPIT_RUN_FAKER_COMMAND);
            expect(runFakerCall?.[1]).toBe(ACCOUNT_RECIPE_FILE_PATH);
            expect(runFakerCall?.[2].excludedObjectApiNames).toEqual(['Contact', 'OtherChildObject__c']);
            expect(runFakerCall?.[2].recipeText).toContain('- object: Account\n');
            expect(runFakerCall?.[2].recipeText).not.toContain('- object: Contact');
            expect(runFakerCall?.[2].recipeText).not.toContain('- object: OtherChildObject__c');
            expect(fs.readFileSync(ACCOUNT_RECIPE_FILE_PATH, 'utf8')).toBe(recipeBefore);
            expect(lastPosted('runFakerState')).toMatchObject({ isRunning: false, treeKey: ACCOUNT_TREE_KEY });

        });

        it('refuses to run, naming the tree, when nothing would be left to generate', async () => {

            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            await openAndDraw(buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: ['Account'] }) }));

            await receivedMessageHandler({ command: 'runFaker', treeKey: ACCOUNT_TREE_KEY });

            expect(executeCommand.mock.calls.find(call => call[0] === RECIPE_COCKPIT_RUN_FAKER_COMMAND)).toBeUndefined();
            expect(warningSpy).toHaveBeenCalledTimes(1);
            expect(warningSpy.mock.calls[0][0]).toStartWith('Run Faker did not run on Relationship Tree 1: Every object in the recipe is excluded');
            expect(lastPosted('runFakerState')).toMatchObject({ isRunning: false, treeKey: ACCOUNT_TREE_KEY });

        });

        it('refuses to run, rather than generating the whole tree, when the recipe cannot be read', async () => {

            const warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            await openAndDraw(buildWorkspaceState({ [RECIPE_COCKPIT_OBJECT_SELECTION_STATE_KEY]: storedSelections({ [ACCOUNT_TREE_KEY]: ['Contact'] }) }));
            const realReadFileSync = fs.readFileSync;
            jest.spyOn(fs, 'readFileSync').mockImplementation(((filePath: fs.PathOrFileDescriptor, options?: any) => {
                if ( filePath === ACCOUNT_RECIPE_FILE_PATH ) { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); }
                return realReadFileSync(filePath, options);
            }) as typeof fs.readFileSync);

            await receivedMessageHandler({ command: 'runFaker', treeKey: ACCOUNT_TREE_KEY });

            expect(executeCommand.mock.calls.find(call => call[0] === RECIPE_COCKPIT_RUN_FAKER_COMMAND)).toBeUndefined();
            expect(warningSpy.mock.calls[0][0]).toContain('Relationship Tree 1: its recipe could not be read');
            expect(warningSpy.mock.calls[0][0]).toContain('EACCES');

        });

    });

    describe('the panel script', () => {

        const drawRecipe = (recipeChanges: (recipe: IRecipeCockpitRecipeViewModel) => void = () => undefined) => {
            const panel = runPanelScript();
            const recipe = loadRecipe();
            recipe.trees.push(buildUngroupedTree());
            recipeChanges(recipe);
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
            panel.postToPanel({ command: 'loadPhase', message: '' });
            panel.expandAllTrees();
            return panel;
        };

        const excludeContact = (recipe: IRecipeCockpitRecipeViewModel) => RecipeCockpitService.applyObjectSelections(recipe, new Map([[ACCOUNT_TREE_KEY, new Set(['Contact'])]]));

        const objectNamed = (panel: ReturnType<typeof runPanelScript>, objectApiName: string) => panel.objectElements().find(objectElement => panel.objectNameOf(objectElement) === objectApiName);
        const includeOf = (panel: ReturnType<typeof runPanelScript>, objectApiName: string) => panel.findAll(objectNamed(panel, objectApiName).children[0], 'treeObjectInclude')[0];
        const glyphOf = (includeElement: any) => includeElement.children[0];
        const labelOf = (panel: ReturnType<typeof runPanelScript>, objectApiName: string) => panel.findAll(objectNamed(panel, objectApiName).children[0], 'treeExclusion')[0];
        const countOf = (panel: ReturnType<typeof runPanelScript>, cardIndex: number) => panel.findAll(panel.treeCards()[cardIndex], 'treeCount')[0].textContent;

        it('draws every object included, a real button before its name, with the tree as inline SVG', () => {

            const panel = drawRecipe();
            const accountInclude = includeOf(panel, 'Account');
            const headerChildren = objectNamed(panel, 'Account').children[0].children;

            expect(accountInclude.tagName).toBe('button');
            expect(headerChildren.indexOf(accountInclude)).toBeLessThan(headerChildren.findIndex((child: any) => child.classList.contains('treeObjectName')));
            expect(accountInclude.attributes).toMatchObject({ 'aria-pressed': 'true', title: 'Included — click to exclude' });
            expect(accountInclude.disabled).toBeFalse();
            expect(glyphOf(accountInclude)).toMatchObject({ tagName: 'svg', namespaceURI: 'http://www.w3.org/2000/svg' });
            expect(glyphOf(accountInclude).attributes).toMatchObject({ class: 'treeGlyph included', 'aria-hidden': 'true', viewBox: '0 0 16 16' });
            expect(glyphOf(accountInclude).children[0]).toMatchObject({ tagName: 'path', namespaceURI: 'http://www.w3.org/2000/svg' });
            expect(glyphOf(accountInclude).children[0].attributes.d).toBe(RECIPE_COCKPIT_TREE_GLYPH_PATH);
            expect(panel.objectElements().some(objectElement => objectElement.classList.contains('excluded'))).toBeFalse();
            expect(countOf(panel, 0)).toBe('3 objects · 13 fields');

        });

        it('draws no icon on the ungrouped card, which has no folder to keep a selection by', () => {

            const panel = drawRecipe(recipe => {
                const ungroupedTree = recipe.trees[recipe.trees.length - 1];
                ungroupedTree.objects = [{ objectApiName: 'Lead', parentLookups: [] }];
            });

            const ungroupedCard = panel.treeCards()[2];
            expect(panel.findAll(ungroupedCard, 'treeObject')).toHaveLength(1);
            expect(panel.findAll(ungroupedCard, 'treeObjectInclude')).toEqual([]);

        });

        it('draws the three states by shape, aria-pressed, disabled and title, with the overlay on every row left out', () => {

            const panel = drawRecipe(excludeContact);

            const contactInclude = includeOf(panel, 'Contact');
            expect(glyphOf(contactInclude).attributes.class).toBe('treeGlyph excluded');
            expect(contactInclude.attributes).toMatchObject({ 'aria-pressed': 'false', title: 'Excluded — click to include' });
            expect(contactInclude.disabled).toBeFalse();
            expect(labelOf(panel, 'Contact').textContent).toBe('excluded');

            const otherInclude = includeOf(panel, 'OtherChildObject__c');
            expect(glyphOf(otherInclude).attributes.class).toBe('treeGlyph autoExcluded');
            expect(otherInclude.attributes).toMatchObject({ 'aria-pressed': 'false', title: 'Excluded because parent Contact is excluded' });
            expect(otherInclude.disabled).toBeTrue();
            expect(labelOf(panel, 'OtherChildObject__c').textContent).toBe('auto-excluded — parent Contact excluded');

            expect(['Account', 'Contact', 'OtherChildObject__c', 'Lead'].map(objectApiName => objectNamed(panel, objectApiName).classList.contains('excluded')))
                .toEqual([false, true, true, false]);
            expect(panel.isHidden(labelOf(panel, 'Account'))).toBeTrue();
            expect(countOf(panel, 0)).toBe('1 of 3 objects · 13 fields');
            expect(countOf(panel, 1)).toBe('1 object · 2 fields');

        });

        it('keeps an excluded row expandable: the overlay hides nothing, and the icon is outside the row\'s body', () => {

            const panel = drawRecipe(excludeContact);
            const contactElement = objectNamed(panel, 'Contact');

            panel.expandObject(contactElement);

            expect(panel.isHidden(panel.objectBodyOf(contactElement))).toBeFalse();
            expect(panel.visibleFieldNamesOf(contactElement)).toContain('LastName');
            expect(panel.findAll(panel.objectBodyOf(contactElement), 'treeObjectInclude')).toEqual([]);

        });

        it('posts the toggle as names, and the click neither expands the row nor decides what is excluded', () => {

            const panel = drawRecipe(excludeContact);

            includeOf(panel, 'Account').dispatch('click');
            includeOf(panel, 'Contact').dispatch('click');
            includeOf(panel, 'OtherChildObject__c').dispatch('click');

            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'setObjectIncluded')).toEqual([
                { command: 'setObjectIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', included: false },
                { command: 'setObjectIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact', included: true }
            ]);
            expect(panel.isHidden(panel.objectBodyOf(objectNamed(panel, 'Account')))).toBeTrue();
            // NOTHING CHANGES UNTIL THE HOST ANSWERS
            expect(objectNamed(panel, 'Account').classList.contains('excluded')).toBeFalse();

        });

        it('redraws the card the host names in place, only for the model on screen', () => {

            const panel = drawRecipe();
            const recipe = loadRecipe();
            excludeContact(recipe);
            const objectSelection = treeOf(recipe, ACCOUNT_TREE_KEY).objectSelection;

            panel.postToPanel({ command: 'objectSelection', renderSequence: 2, treeKey: ACCOUNT_TREE_KEY, objectSelection: objectSelection });
            expect(objectNamed(panel, 'Contact').classList.contains('excluded')).toBeFalse();

            panel.postToPanel({ command: 'objectSelection', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY, objectSelection: objectSelection });
            expect(objectNamed(panel, 'Contact').classList.contains('excluded')).toBeTrue();
            expect(countOf(panel, 0)).toBe('1 of 3 objects · 13 fields');
            // REDRAWN IN PLACE: THE CARD THE READER OPENED IS STILL OPEN
            expect(panel.isHidden(panel.findAll(panel.treeCards()[0], 'treeBody')[0])).toBeFalse();

            panel.postToPanel({ command: 'objectSelection', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY });
            expect(objectNamed(panel, 'Contact').classList.contains('excluded')).toBeFalse();
            expect(includeOf(panel, 'OtherChildObject__c').disabled).toBeFalse();
            expect(countOf(panel, 0)).toBe('3 objects · 13 fields');

        });

        it('lays the overlay on a self-lookup\'s iteration with its object, and gives the iteration no icon of its own', () => {

            const addIteration = (recipe: IRecipeCockpitRecipeViewModel) => {
                const accountObject = recipe.objects.find(objectViewModel => objectViewModel.objectApiName === 'Account')!;
                accountObject.nickname = 'Account_NickName';
                accountObject.iterations = [{ nickname: 'Account_child_NickName', lineNumber: 40, parentObjectApiName: 'Account', parentNickname: 'Account_NickName', fields: [] }];
                treeOf(recipe, ACCOUNT_TREE_KEY).objects.push({ objectApiName: 'Account', parentLookups: [], iterationNickname: 'Account_child_NickName' });
            };
            const panel = drawRecipe(recipe => {
                addIteration(recipe);
                RecipeCockpitService.applyObjectSelections(recipe, new Map([[ACCOUNT_TREE_KEY, new Set(['Account'])]]));
            });

            const accountElements = panel.objectElements().filter(objectElement => panel.objectNameOf(objectElement) === 'Account');
            expect(accountElements).toHaveLength(2);
            expect(accountElements.map(objectElement => objectElement.classList.contains('excluded'))).toEqual([true, true]);
            expect(accountElements.map(objectElement => panel.findAll(objectElement.children[0], 'treeObjectInclude').length)).toEqual([1, 0]);
            // THE ICON POSTS THE NICKNAME THE OBJECT IS DRAWN WITH
            panel.findAll(accountElements[0].children[0], 'treeObjectInclude')[0].dispatch('click');
            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'setObjectIncluded')).toEqual([
                { command: 'setObjectIncluded', treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', included: true, nickname: 'Account_NickName' }
            ]);

        });

        it('says when a lookup of an included object points at an excluded parent', () => {

            const panel = drawRecipe(recipe => {
                treeOf(recipe, ACCOUNT_TREE_KEY).objectSelection = {
                    exclusions: [{ objectApiName: 'Contact', kind: 'excluded' }],
                    disabledLookups: [{ objectApiName: 'OtherChildObject__c', fieldApiName: 'Contact__c', parentObjectApiName: 'Contact' }],
                    includedObjectCount: 2,
                    objectCount: 3
                };
            });

            expect(panel.findAll(objectNamed(panel, 'OtherChildObject__c').children[0], 'treeLookups')[0].textContent).toBe('(Contact__c → Contact · parent excluded)');
            expect(panel.findAll(objectNamed(panel, 'Contact').children[0], 'treeLookups')[0].textContent).toBe('(AccountId → Account)');

        });

        it('refuses the icon of an object written twice with no nickname to tell the occurrences apart', () => {

            const panel = drawRecipe(recipe => { recipe.objects.find(objectViewModel => objectViewModel.objectApiName === 'Contact')!.hasIndistinctOccurrences = true; });
            const contactInclude = includeOf(panel, 'Contact');

            expect(contactInclude.disabled).toBeTrue();
            expect(contactInclude.attributes.title).toContain('written more than once');

            contactInclude.dispatch('click');
            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'setObjectIncluded')).toEqual([]);

        });

        it('disables Data-by-Org Create on an excluded object with the reason "excluded in Structure"', () => {

            const panel = drawRecipe(excludeContact);
            panel.postToPanel({ command: 'rendered' });
            panel.treeCards().forEach((treeCard: any) => panel.openTab(treeCard, 'Data-by-Org'));
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', renderSequence: 3 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Sandbox', isSandbox: true, requestSequence: 5, renderSequence: 3 });
            panel.postToPanel({
                command: 'dataOrgReadiness',
                objects: ['Account', 'Contact', 'OtherChildObject__c', 'Lead'].map(objectApiName => ({ objectApiName: objectApiName, disabledReason: '', requiredLookups: [] })),
                createResults: [],
                requestSequence: 5,
                renderSequence: 3
            });

            const dataRowNamed = (objectApiName: string) => panel.dataObjectElements()
                .find((rowElement: any) => panel.findAll(rowElement, 'dataObjectName')[0].textContent === objectApiName);
            const createOf = (objectApiName: string) => panel.findAll(dataRowNamed(objectApiName), 'dataCreate')[0];
            const reasonOf = (objectApiName: string) => panel.findAll(dataRowNamed(objectApiName), 'dataCreateReason')[0].textContent;

            expect(createOf('Account').disabled).toBeFalse();
            expect(createOf('Contact').disabled).toBeTrue();
            expect(reasonOf('Contact')).toBe(RECIPE_COCKPIT_EXCLUDED_IN_STRUCTURE_REASON);
            expect(reasonOf('OtherChildObject__c')).toBe('excluded in Structure');

            // INCLUDING IT AGAIN GIVES CREATE BACK, WITHOUT A NEW READINESS
            panel.postToPanel({ command: 'objectSelection', renderSequence: 3, treeKey: ACCOUNT_TREE_KEY });
            expect(createOf('Contact').disabled).toBeFalse();
            expect(reasonOf('Contact')).toBe('');

        });

    });

});
