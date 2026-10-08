import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_ADD_FRIEND_CONFIRM_LABEL
} from '../RecipeCockpitService';
import { RecipeCockpitRecipeWriter } from '../RecipeCockpitRecipeWriter';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    The Recipe Cockpit's "+" on a self-lookup iteration (#197), end to end on the host: the model
    offers it, the router admits only what the confirmed-drawn model offered, and the executor
    confirms, writes through RecipeCockpitRecipeWriter.insertFriend and reloads. The writer's own
    rules are asserted in RecipeCockpitRecipeWriter.test.ts, and the records the added friend
    generates in RelationshipService.nestedFriends.test.ts.

    The workspace is built per test in a temporary folder, from the writer's self-lookup fixture
    with its Lead (which no tree lists) left out, because the executor writes the recipe file.
*/

const RUN_FOLDER_NAME = 'recipe-fakerjs-2026-10-01T00-00-00';
const TREE_KEY = 'Account-thru-Opportunity';
const ITERATION_NICKNAME = 'Account_child_NickName';
const RECIPE_FIXTURE_PATH = path.join(__dirname, 'mocks', 'recipeWriter', 'recipe-fakerjs-selfLookupFriends--RelationshipTree_1.yml');

const buildWrapperField = (objectApiName: string, fieldApiName: string, fieldType: string) => ({
    objectName: objectApiName, fieldName: fieldApiName, fieldLabel: fieldApiName, type: fieldType, recipeValue: ''
});

const OBJECTS_WRAPPER = {
    ObjectToObjectInfoMap: {
        Account: {
            Fields: [buildWrapperField('Account', 'Name', 'Text'), buildWrapperField('Account', 'ParentId', 'Lookup')],
            RelationshipDetail: { parentObjectToFieldReferences: { Account: ['ParentId'] } }
        },
        Contact: {
            Fields: [buildWrapperField('Contact', 'LastName', 'Text'), buildWrapperField('Contact', 'AccountId', 'Lookup'), buildWrapperField('Contact', 'ReportsToId', 'Lookup')],
            RelationshipDetail: { parentObjectToFieldReferences: { Account: ['AccountId'], Contact: ['ReportsToId'] } }
        },
        Case: {
            Fields: [buildWrapperField('Case', 'Subject', 'Text'), buildWrapperField('Case', 'AccountId', 'Lookup'), buildWrapperField('Case', 'ContactId', 'Lookup')],
            RelationshipDetail: { parentObjectToFieldReferences: { Account: ['AccountId'], Contact: ['ContactId'] } }
        },
        Opportunity: {
            Fields: [buildWrapperField('Opportunity', 'Name', 'Text'), buildWrapperField('Opportunity', 'AccountId', 'Lookup')],
            RelationshipDetail: { parentObjectToFieldReferences: { Account: ['AccountId'] } }
        }
    },
    RecipeFiles: [{ objects: ['Account', 'Contact', 'Case', 'Opportunity'] }]
};

const readRecipeFixtureWithoutLead = () => {
    const fixtureText = fs.readFileSync(RECIPE_FIXTURE_PATH, 'utf-8');
    return fixtureText.slice(0, fixtureText.indexOf('\n# Lead')) + '\n';
};

describe('RecipeCockpitService, "+" adds a friend under a self-lookup iteration (#197)', () => {

    let workspaceRoot: string;
    let recipeFilePath: string;

    beforeEach(() => {

        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-add-friend-'));
        const runFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', RUN_FOLDER_NAME);
        fs.mkdirSync(path.join(runFolderPath, TREE_KEY), { recursive: true });
        fs.writeFileSync(path.join(runFolderPath, 'treecipeObjectsWrapper-2026-10-01T00-00-00.json'), JSON.stringify(OBJECTS_WRAPPER));
        recipeFilePath = path.join(runFolderPath, TREE_KEY, `recipe--${TREE_KEY}-2026-10-01T00-00-00.yml`);
        fs.writeFileSync(recipeFilePath, readRecipeFixtureWithoutLead());

    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    const loadModel = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.buildRecipeViewModel(workspaceRoot);

    const buildActivePanelState = (recipeViewModel = loadModel()): IRecipeCockpitPanelState => {
        const panelState = RecipeCockpitService.buildInitialPanelState(workspaceRoot);
        panelState.recipeDataMessage = { command: 'recipeData', recipe: recipeViewModel, renderSequence: 1 };
        panelState.pendingInsertableFriendTargets = RecipeCockpitService.collectInsertableFriendTargets(recipeViewModel);
        panelState.insertableFriendTargets = panelState.pendingInsertableFriendTargets;
        return panelState;
    };

    const ADD_CONTACT_MESSAGE = { command: 'addIterationFriend', treeKey: TREE_KEY, objectApiName: 'Account', objectNickname: ITERATION_NICKNAME, friendObjectApiName: 'Contact' };
    const NOTHING_RUNS = { kind: 'postAddFriendState', hostMessage: { command: 'addFriendState', isRunning: false } };

    describe('the model', () => {

        it('offers the friends of the Account above the iteration, on the iteration only', () => {

            const recipeViewModel = loadModel();
            const accountObject = recipeViewModel.objects.find(objectViewModel => objectViewModel.objectApiName === 'Account');

            expect(accountObject.iterations.map(iteration => [iteration.nickname, iteration.insertableFriendObjectApiNames])).toEqual([
                [ITERATION_NICKNAME, ['Contact', 'Opportunity']]
            ]);
            expect(recipeViewModel.objects.filter(objectViewModel => objectViewModel.objectApiName !== 'Account').map(objectViewModel => objectViewModel.iterations)).toEqual([undefined, undefined, undefined]);
            expect(recipeViewModel.trees.map(tree => tree.treeKey)).toEqual([TREE_KEY]);

        });

        it('builds one host-only target per friend a drawn "+" offers, each naming the iteration\'s recipe file', () => {

            expect(Array.from(RecipeCockpitService.collectInsertableFriendTargets(loadModel()))).toEqual([
                [RecipeCockpitService.buildInsertableFriendKey(TREE_KEY, 'Account', ITERATION_NICKNAME, 'Contact'), recipeFilePath],
                [RecipeCockpitService.buildInsertableFriendKey(TREE_KEY, 'Account', ITERATION_NICKNAME, 'Opportunity'), recipeFilePath]
            ]);

        });

        it('offers nothing for a card that does not list the iteration, nor for a snowfakery recipe, which has none', () => {

            const recipeViewModel = loadModel();
            recipeViewModel.trees[0].objects = recipeViewModel.trees[0].objects.filter(treeObject => treeObject.iterationNickname === undefined);

            expect(RecipeCockpitService.collectInsertableFriendTargets(recipeViewModel).size).toBe(0);

            const snowfakeryRecipeText = fs.readFileSync(path.join(__dirname, 'mocks', 'recipeWriter', 'recipe-snowfakery--RelationshipTree_1.yml'), 'utf-8');
            expect(Array.from(RecipeCockpitService.parseRecipeSource(snowfakeryRecipeText).values()).filter(objectEntry => objectEntry.iterations)).toEqual([]);

        });

    });

    describe('routePanelMessage, addIterationFriend', () => {

        it('routes the four names to the host-only recipe file, never a path the message carries', () => {

            expect(RecipeCockpitService.routePanelMessage({ ...ADD_CONTACT_MESSAGE, filePath: '/etc/passwd' }, buildActivePanelState())).toEqual({
                kind: 'addIterationFriend',
                treeKey: TREE_KEY,
                objectApiName: 'Account',
                iterationNickname: ITERATION_NICKNAME,
                friendObjectApiName: 'Contact',
                recipeFilePath: recipeFilePath
            });

        });

        it('refuses until the panel has confirmed drawing the model, and answers that nothing runs', () => {

            const panelState = buildActivePanelState();
            panelState.insertableFriendTargets = new Map();

            expect(RecipeCockpitService.routePanelMessage(ADD_CONTACT_MESSAGE, panelState)).toEqual(NOTHING_RUNS);

        });

        it.each([
            ['the top occurrence\'s nickname', { objectNickname: 'Account_NickName' }],
            ['a friend the object does not have', { friendObjectApiName: 'Lead' }],
            ['the grandchild', { friendObjectApiName: 'Case' }],
            ['another card', { treeKey: 'Lead-ONLY' }],
            ['another object', { objectApiName: 'Contact' }],
            ['a nickname that is not a string', { objectNickname: [ITERATION_NICKNAME] }],
            ['a friend that is not a string', { friendObjectApiName: { name: 'Contact' } }],
            ['no tree', { treeKey: undefined }]
        ])('refuses %s', (_description, override) => {

            expect(RecipeCockpitService.routePanelMessage({ ...ADD_CONTACT_MESSAGE, ...override }, buildActivePanelState())).toEqual(NOTHING_RUNS);

        });

        it('admits one at a time, and a reload replays the one in flight', () => {

            const panelState = buildActivePanelState();
            panelState.addFriendStateMessage = { command: 'addFriendState', isRunning: true };

            expect(RecipeCockpitService.routePanelMessage(ADD_CONTACT_MESSAGE, panelState)).toBeUndefined();
            expect(RecipeCockpitService.buildReplayMessages(panelState).map(hostMessage => hostMessage.command)).toEqual(['recipeData', 'addFriendState']);

        });

    });

    describe('openRecipeCockpitPanel, the write', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let showWarningMessageSpy: jest.SpyInstance;
        let showInformationMessageSpy: jest.SpyInstance;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedCommands = () => postedPanelMessages.map(hostMessage => hostMessage.command);
        const lastModel = (): IRecipeCockpitRecipeViewModel => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData').recipe;

        const openRenderedCockpit = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            postedPanelMessages.length = 0;
        };

        beforeEach(() => {

            postedPanelMessages = [];

            const fakeWebviewPanel = {
                reveal: jest.fn(),
                dispose: jest.fn(),
                onDidDispose: jest.fn().mockReturnValue({ dispose: jest.fn() }),
                webview: {
                    html: '',
                    postMessage: jest.fn().mockImplementation((hostMessage: any) => { postedPanelMessages.push(hostMessage); return Promise.resolve(true); }),
                    onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: (panelMessage: any) => Promise<void>) => {
                        receivedMessageHandler = messageHandler;
                        return { dispose: jest.fn() };
                    })
                }
            };

            // THESE LIVE ON THE MODULE FACTORY RATHER THAN ON A SPY, SO restoreMocks DOES NOT REACH THEM
            (vscode.window.createWebviewPanel as jest.Mock).mockReset().mockImplementation(() => fakeWebviewPanel);
            (vscode.window.showWarningMessage as jest.Mock).mockReset();

            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation(() => ({ text: '', dispose: jest.fn() }) as any);
            showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            showInformationMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showInformationMessage').mockImplementation(() => undefined);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        it('on confirmation writes the friend under the iteration, then reloads with the card open on its Structure tab', async () => {

            const originalRecipeText = fs.readFileSync(recipeFilePath, 'utf-8');
            const insertResult = RecipeCockpitRecipeWriter.insertFriend(originalRecipeText, 'Account', ITERATION_NICKNAME, 'Contact');
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_ADD_FRIEND_CONFIRM_LABEL);

            await openRenderedCockpit();
            await receivedMessageHandler(ADD_CONTACT_MESSAGE);

            expect('recipeText' in insertResult && fs.readFileSync(recipeFilePath, 'utf-8')).toBe('recipeText' in insertResult && insertResult.recipeText);
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0]).toEqual([
                `Add Contact under ${ITERATION_NICKNAME}?`,
                { modal: true, detail: expect.stringContaining(path.basename(recipeFilePath)) },
                RECIPE_COCKPIT_ADD_FRIEND_CONFIRM_LABEL
            ]);
            expect(showInformationMessageSpy).toHaveBeenCalledWith(expect.stringContaining('Added Contact as Contact_child_NickName under Account_child_NickName'));
            expect(postedCommands().filter(command => ['addFriendState', 'recipeData'].includes(command))).toEqual(['addFriendState', 'recipeData', 'addFriendState']);
            expect(postedPanelMessages.filter(hostMessage => hostMessage.command === 'addFriendState').map(hostMessage => hostMessage.isRunning)).toEqual([true, false]);
            expect(postedPanelMessages.find(hostMessage => hostMessage.command === 'recipeData').focusTree).toEqual({ treeKey: TREE_KEY, tab: 'structure' });

            // THE NEW FRIEND IS DRAWN UNDER THE ITERATION, AND THE ITERATION OFFERS ONLY WHAT IT STILL LACKS
            const reloadedModel = lastModel();
            const contactIteration = reloadedModel.objects.find(objectViewModel => objectViewModel.objectApiName === 'Contact').iterations[0];
            expect(contactIteration).toMatchObject({ nickname: 'Contact_child_NickName', parentObjectApiName: 'Account', parentNickname: ITERATION_NICKNAME });
            expect(reloadedModel.trees[0].objects).toContainEqual(expect.objectContaining({ objectApiName: 'Contact', iterationNickname: 'Contact_child_NickName' }));
            expect(reloadedModel.objects.find(objectViewModel => objectViewModel.objectApiName === 'Account').iterations[0].insertableFriendObjectApiNames).toEqual(['Opportunity']);

            // ITS ↗ yml LINKS OPEN THE NEW LINES ONCE THE RELOADED MODEL IS DRAWN
            const openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            const newAccountIdLine = contactIteration.fields.find(field => field.fieldApiName === 'AccountId');
            expect(fs.readFileSync(recipeFilePath, 'utf-8').split('\n')[newAccountIdLine.lineNumber - 1]).toBe(`            AccountId: ${ITERATION_NICKNAME}`);

            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await receivedMessageHandler({ command: 'openSource', filePath: recipeFilePath, lineNumber: contactIteration.lineNumber });
            await receivedMessageHandler({ command: 'openSource', filePath: recipeFilePath, lineNumber: newAccountIdLine.lineNumber });

            expect(openFileInEditorSpy.mock.calls).toEqual([[recipeFilePath, contactIteration.lineNumber], [recipeFilePath, newAccountIdLine.lineNumber]]);

            // AND THE "+" THAT ADDED CONTACT NO LONGER ADMITS IT
            expect(RecipeCockpitService.routePanelMessage(ADD_CONTACT_MESSAGE, (RecipeCockpitService as any).recipeCockpitPanelState)).toEqual(NOTHING_RUNS);

        });

        it('on cancel writes nothing, reloads nothing and gives the buttons back', async () => {

            const originalRecipeText = fs.readFileSync(recipeFilePath, 'utf-8');
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            await openRenderedCockpit();
            await receivedMessageHandler(ADD_CONTACT_MESSAGE);

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(originalRecipeText);
            expect(postedPanelMessages).toEqual([{ command: 'addFriendState', isRunning: true }, { command: 'addFriendState', isRunning: false }]);
            expect(showInformationMessageSpy).not.toHaveBeenCalled();

        });

        it('given the file edited since the draw so the iteration already has the friend, says why and writes nothing', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_ADD_FRIEND_CONFIRM_LABEL);

            await openRenderedCockpit();

            const insertResult = RecipeCockpitRecipeWriter.insertFriend(fs.readFileSync(recipeFilePath, 'utf-8'), 'Account', ITERATION_NICKNAME, 'Contact');
            const editedRecipeText = 'recipeText' in insertResult ? insertResult.recipeText : '';
            fs.writeFileSync(recipeFilePath, editedRecipeText);

            await receivedMessageHandler(ADD_CONTACT_MESSAGE);

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(editedRecipeText);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('already has Contact under its friends: block'));
            expect(postedCommands()).not.toContain('recipeData');

        });

        it('given the recipe file removed while the confirmation was open, writes nothing', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => {
                fs.rmSync(recipeFilePath);
                return RECIPE_COCKPIT_ADD_FRIEND_CONFIRM_LABEL;
            });

            await openRenderedCockpit();
            await receivedMessageHandler(ADD_CONTACT_MESSAGE);

            expect(fs.existsSync(recipeFilePath)).toBe(false);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('so Contact was not added.'));
            expect(postedCommands()).toEqual(['addFriendState', 'addFriendState']);

        });

        it('answers a refused message with the buttons back, and asks nothing', async () => {

            await openRenderedCockpit();
            await receivedMessageHandler({ ...ADD_CONTACT_MESSAGE, friendObjectApiName: 'Lead' });

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(postedPanelMessages).toEqual([{ command: 'addFriendState', isRunning: false }]);

        });

        it('given the recipe file gone since the draw, says so before asking anything', async () => {

            await openRenderedCockpit();
            fs.rmSync(recipeFilePath);

            await receivedMessageHandler(ADD_CONTACT_MESSAGE);

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('no longer exists in this workspace, so Contact was not added'));
            expect(fs.existsSync(recipeFilePath)).toBe(false);

        });

    });

    describe('the panel script', () => {

        const renderModel = () => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadModel(), renderSequence: 1 });
            panel.expandAllTrees();
            return panel;
        };

        it('draws "+" on the self-lookup iteration alone, its friends listed once it is opened', () => {

            const panel = renderModel();
            const addFriendButtons = panel.findAll(panel.cockpitBodyElement, 'treeAddFriend');
            const iterationElement = panel.objectElements().find((objectElement: any) => panel.findAll(objectElement.children[0], 'treeAddFriend').length > 0);
            const friendList = panel.findAll(iterationElement, 'treeAddFriends')[0];

            expect(addFriendButtons).toHaveLength(1);
            expect(panel.findAll(iterationElement, 'treeIteration')[0].textContent).toBe(`${ITERATION_NICKNAME} · nested under Account_NickName`);
            expect(panel.findAll(friendList, 'treeAddFriendChoice').map((choice: any) => choice.textContent)).toEqual(['+ Contact', '+ Opportunity']);
            expect(panel.isHidden(friendList)).toBe(true);

            addFriendButtons[0].dispatch('click');

            expect(panel.isHidden(friendList)).toBe(false);
            expect(addFriendButtons[0].attributes['aria-expanded']).toBe('true');

        });

        it('posts names only, disables every "+" until the host answers, and posts nothing on a second click', () => {

            const panel = renderModel();
            const [contactChoice] = panel.findAll(panel.cockpitBodyElement, 'treeAddFriendChoice');
            const everyAddFriendButton = () => [...panel.findAll(panel.cockpitBodyElement, 'treeAddFriend'), ...panel.findAll(panel.cockpitBodyElement, 'treeAddFriendChoice')];
            const postedAdds = () => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'addIterationFriend');

            contactChoice.dispatch('click');
            contactChoice.dispatch('click');

            expect(postedAdds()).toEqual([ADD_CONTACT_MESSAGE]);
            expect(everyAddFriendButton().map(buttonElement => buttonElement.disabled)).toEqual([true, true, true]);

            panel.postToPanel({ command: 'addFriendState', isRunning: false });

            expect(everyAddFriendButton().map(buttonElement => buttonElement.disabled)).toEqual([false, false, false]);

        });

        it('draws a model the host posts while an add is in flight with its "+" already disabled', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'addFriendState', isRunning: true });
            panel.postToPanel({ command: 'recipeData', recipe: loadModel(), renderSequence: 1 });
            panel.expandAllTrees();

            expect(panel.findAll(panel.cockpitBodyElement, 'treeAddFriendChoice').map((choice: any) => choice.disabled)).toEqual([true, true]);

        });

    });

});
