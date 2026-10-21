import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    window: { createWebviewPanel: jest.fn(), withProgress: jest.fn(), showWarningMessage: jest.fn(), showQuickPick: jest.fn() },
    commands: { executeCommand: jest.fn() },
    ViewColumn: { One: 1 },
    ProgressLocation: { Notification: 15 },
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import {
    RecipeCockpitService,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    RECIPE_COCKPIT_NO_REMOVED_TODOS_NOTE,
    RECIPE_COCKPIT_PANEL_PLACE_VERSION,
    RECIPE_COCKPIT_TODO_OTHER_RECIPE_REASON,
    RECIPE_COCKPIT_TODO_REFERENCE_LOOKUP_REASON,
    RECIPE_COCKPIT_TODO_REMOVE_CONFIRM_LABEL,
    RECIPE_COCKPIT_TODO_REMOVE_LOCK_REASONS,
    RECIPE_COCKPIT_TODO_RESTORE_CONFIRM_LABEL
} from '../RecipeCockpitService';
import { RecipeCockpitRemovedTodoStore } from '../RecipeCockpitRemovedTodoStore';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';

/*
    "Remove TODO" and "Restore" (#391), on the host and in the panel: the model says which TODOs
    can be removed, the router admits only what the confirmed-drawn model offered, the executor
    confirms, writes the removed-TODOs file and the recipe, and reloads onto the list it was clicked
    in; the panel draws each row field first with its line link and button, and the Removed list.
    The writer's own rule is asserted in RecipeCockpitTodoRemoveWriter.test.ts, the file's in
    RecipeCockpitRemovedTodoStore.test.ts.
*/

const RUN_FOLDER_NAME = 'recipe-2026-10-01T00-00-00';
const TREE_KEY = 'Account-ONLY';
const LOOKUP_TODO = '### TODO -- REFERENCE ID REQUIRED';

const RECIPE_TEXT = [
    '- object: Account',
    '  nickname: Account_NickName',
    '  count: 1',
    '  fields:',
    '    Name: ${{ fake.Company }} # TODO pick a real company',
    `    ParentId: ${LOOKUP_TODO}`,
    '    Phone: ${{ fake.PhoneNumber }}',
    '        # TODO check the phone format',
    '    ### TODO -- the reader\'s note on Account',
    ''
].join('\n');

const NAME_TODO = { lineNumber: 5, text: '# TODO pick a real company' };
const PHONE_TODO = { lineNumber: 8, text: '# TODO check the phone format' };
const OBJECT_TODO = { lineNumber: 9, text: '### TODO -- the reader\'s note on Account' };
const PARENT_TODO_LINE_NUMBER = 6;

const OBJECTS_WRAPPER = {
    ObjectToObjectInfoMap: {
        Account: {
            Fields: [
                { objectName: 'Account', fieldName: 'Name', fieldLabel: 'Name', type: 'Text', recipeValue: '${{ fake.Company }}' },
                { objectName: 'Account', fieldName: 'ParentId', fieldLabel: 'Parent', type: 'Lookup', recipeValue: LOOKUP_TODO },
                { objectName: 'Account', fieldName: 'Phone', fieldLabel: 'Phone', type: 'Phone', recipeValue: '${{ fake.PhoneNumber }}' }
            ],
            RelationshipDetail: { level: 0, parentObjectToFieldReferences: { Account: ['ParentId'] } }
        }
    },
    RecipeFiles: [{ objects: ['Account'] }]
};

const NOTHING_RUNS = { kind: 'postWireLookupState', hostMessage: { command: 'wireLookupState', isRunning: false } };
const removeMessage = (lineNumber: number) => ({ command: 'removeTodo', treeKey: TREE_KEY, lineNumber: lineNumber });
const restoreMessage = (removalKey: string) => ({ command: 'restoreTodo', treeKey: TREE_KEY, removalKey: removalKey });

answerInPanelConfirmationsThroughWarningMock();

describe('RecipeCockpitService, removing and restoring TODOs (#391)', () => {

    let workspaceRoot: string;
    let recipeFilePath: string;
    let removedTodoFilePath: string;

    const writeRemovedTodoFile = (recipeText: string, lineNumber: number, todoText: string) => {
        const { RecipeCockpitRecipeWriter } = jest.requireActual('../RecipeCockpitRecipeWriter');
        const removeResult = RecipeCockpitRecipeWriter.removeTodoComment(recipeText, { lineNumber: lineNumber, todoText: todoText });
        fs.writeFileSync(recipeFilePath, removeResult.recipeText);
        fs.writeFileSync(removedTodoFilePath, RecipeCockpitRemovedTodoStore.serialize([removeResult.removed]));
        return removeResult.recipeText as string;
    };

    beforeEach(() => {

        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-todo-removal-'));
        const runFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', RUN_FOLDER_NAME);
        fs.mkdirSync(path.join(runFolderPath, TREE_KEY), { recursive: true });
        fs.writeFileSync(path.join(runFolderPath, 'treecipeObjectsWrapper-2026-10-01T00-00-00.json'), JSON.stringify(OBJECTS_WRAPPER));
        recipeFilePath = path.join(runFolderPath, TREE_KEY, `recipe--${TREE_KEY}-2026-10-01T00-00-00.yml`);
        removedTodoFilePath = RecipeCockpitRemovedTodoStore.buildFilePath(recipeFilePath);
        fs.writeFileSync(recipeFilePath, RECIPE_TEXT);

    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    const loadModel = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.buildRecipeViewModel(workspaceRoot);
    const accountOf = (recipeViewModel: IRecipeCockpitRecipeViewModel) => recipeViewModel.objects.find(objectViewModel => objectViewModel.objectApiName === 'Account');

    const buildActivePanelState = (recipeViewModel = loadModel()): IRecipeCockpitPanelState => {
        const panelState = RecipeCockpitService.buildInitialPanelState(workspaceRoot);
        const runFakerRecipeFilePathsByTreeKey = new Map([[TREE_KEY, recipeFilePath]]);
        panelState.recipeDataMessage = { command: 'recipeData', recipe: recipeViewModel, renderSequence: 1 };
        panelState.treeHistoryTargets = { ...panelState.treeHistoryTargets, runFakerRecipeFilePathsByTreeKey: runFakerRecipeFilePathsByTreeKey };
        panelState.treeHistoryAllowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipeViewModel, runFakerRecipeFilePathsByTreeKey);
        return panelState;
    };

    describe('the model', () => {

        it('marks the TODO a lookup\'s value is as one that cannot be removed, and only it', () => {

            const account = accountOf(loadModel());
            const fieldOf = (fieldApiName: string) => account.fields.find(field => field.fieldApiName === fieldApiName);

            expect(fieldOf('ParentId').todos).toEqual([expect.objectContaining({ lineNumber: PARENT_TODO_LINE_NUMBER, removeLock: 'field-value' })]);
            expect(fieldOf('Name').todos).toEqual([{ lineNumber: NAME_TODO.lineNumber, text: NAME_TODO.text }]);
            expect(fieldOf('Phone').todos).toEqual([{ lineNumber: PHONE_TODO.lineNumber, text: PHONE_TODO.text }]);
            expect(account.todos).toEqual([{ lineNumber: OBJECT_TODO.lineNumber, text: OBJECT_TODO.text }]);

        });

        it('offers a Remove for every TODO of the card\'s own recipe no lock holds, and posts no removed list when nothing was removed', () => {

            const recipeViewModel = loadModel();
            const allowLists = RecipeCockpitService.collectTreeHistoryAllowLists(recipeViewModel, new Map([[TREE_KEY, recipeFilePath]]));

            expect([...allowLists.removableTodoKeys].sort()).toEqual([NAME_TODO, PHONE_TODO, OBJECT_TODO].map(todo => `${TREE_KEY}\n${todo.lineNumber}`).sort());
            expect([...allowLists.restorableTodoKeys]).toEqual([]);
            expect(recipeViewModel.trees[0]).not.toHaveProperty('removedTodos');
            // A CARD WITH NO SINGLE RECIPE FILE OFFERS NONE
            expect([...RecipeCockpitService.collectTreeHistoryAllowLists(recipeViewModel).removableTodoKeys]).toEqual([]);

        });

        it('lists what the removed-TODOs file holds that is still out of the recipe, and leaves out one put back by hand', () => {

            const removedText = writeRemovedTodoFile(RECIPE_TEXT, PHONE_TODO.lineNumber, PHONE_TODO.text);

            expect(loadModel().trees[0].removedTodos).toEqual([{ removalKey: '0', objectApiName: 'Account', objectNickname: 'Account_NickName', fieldApiName: 'Phone', lineNumber: PHONE_TODO.lineNumber, text: PHONE_TODO.text }]);

            // THE LINE TYPED BACK BY HAND: LISTED ONCE, UNDER OPEN
            fs.writeFileSync(recipeFilePath, RECIPE_TEXT);
            const reloaded = loadModel();
            expect(reloaded.trees[0]).not.toHaveProperty('removedTodos');
            expect(accountOf(reloaded).fields.find(field => field.fieldApiName === 'Phone').todos).toHaveLength(1);
            expect(removedText).not.toContain(PHONE_TODO.text);

        });

        it.each([
            ['is not JSON', () => fs.writeFileSync(removedTodoFilePath, '{ not json')],
            ['cannot be read at all', () => fs.mkdirSync(removedTodoFilePath)]
        ])('says so when the removed-TODOs file %s, and lists nothing from it', (_description, writeFile) => {

            writeFile();

            const recipeViewModel = loadModel();
            expect(recipeViewModel.trees[0]).not.toHaveProperty('removedTodos');
            expect(recipeViewModel.notices).toContainEqual(expect.stringContaining(`"${path.basename(removedTodoFilePath)}" is not a removed-TODOs file`));

        });

    });

    describe('routePanelMessage', () => {

        it('routes a Remove by the card and line to the host-only recipe file, with the text the panel drew', () => {

            expect(RecipeCockpitService.routePanelMessage({ ...removeMessage(PHONE_TODO.lineNumber), filePath: '/etc/passwd', todoText: '# TODO evil' } as any, buildActivePanelState())).toEqual({
                kind: 'removeTodo', treeKey: TREE_KEY, recipeFilePath: recipeFilePath, lineNumber: PHONE_TODO.lineNumber, todoText: PHONE_TODO.text
            });
            expect(RecipeCockpitService.routePanelMessage(removeMessage(NAME_TODO.lineNumber), buildActivePanelState())).toEqual(expect.objectContaining({ todoText: NAME_TODO.text }));

        });

        it.each([
            ['the lookup\'s TODO, which a lock holds', removeMessage(PARENT_TODO_LINE_NUMBER)],
            ['a line with no TODO', removeMessage(3)],
            ['a line that is not a number', { ...removeMessage(PHONE_TODO.lineNumber), lineNumber: '8' }],
            ['another card', { ...removeMessage(PHONE_TODO.lineNumber), treeKey: 'Lead-ONLY' }],
            ['a Restore of a row the model does not draw', restoreMessage('0')],
            ['a Restore by a key that is not one', { ...restoreMessage('0'), removalKey: '__proto__' }]
        ])('refuses %s, and answers that nothing runs', (_description, panelMessage) => {

            expect(RecipeCockpitService.routePanelMessage(panelMessage, buildActivePanelState())).toEqual(NOTHING_RUNS);

        });

        it('refuses until the panel has confirmed drawing the model', () => {

            const panelState = buildActivePanelState();
            panelState.treeHistoryAllowLists = RecipeCockpitService.buildEmptyTreeHistoryAllowLists();

            expect(RecipeCockpitService.routePanelMessage(removeMessage(PHONE_TODO.lineNumber), panelState)).toEqual(NOTHING_RUNS);

        });

        it('shares the one recipe write with a wiring, and waits for an Add friend in flight', () => {

            const panelState = buildActivePanelState();
            panelState.wireLookupStateMessage = { command: 'wireLookupState', isRunning: true };
            expect(RecipeCockpitService.routePanelMessage(removeMessage(PHONE_TODO.lineNumber), panelState)).toBeUndefined();

            panelState.wireLookupStateMessage = undefined;
            panelState.addFriendStateMessage = { command: 'addFriendState', isRunning: true };
            expect(RecipeCockpitService.routePanelMessage(removeMessage(PHONE_TODO.lineNumber), panelState)).toEqual(NOTHING_RUNS);

        });

        it('routes a Restore by its removalKey to the entry the host holds, never one the message carries', () => {

            writeRemovedTodoFile(RECIPE_TEXT, PHONE_TODO.lineNumber, PHONE_TODO.text);
            const panelState = buildActivePanelState();
            panelState.removedTodosByTreeKey = new Map([[TREE_KEY, RecipeCockpitService.readRemovedTodos(recipeFilePath, workspaceRoot, fs.readFileSync(recipeFilePath, 'utf-8')).entries]]);

            expect(RecipeCockpitService.routePanelMessage({ ...restoreMessage('0'), removed: { originalLine: '- object: Evil' } } as any, panelState)).toEqual({
                kind: 'restoreTodo', treeKey: TREE_KEY, recipeFilePath: recipeFilePath, removed: expect.objectContaining({ fieldApiName: 'Phone', originalLine: '        # TODO check the phone format' })
            });
            expect(RecipeCockpitService.routePanelMessage(restoreMessage('1'), panelState)).toEqual(NOTHING_RUNS);

        });

    });

    describe('openRecipeCockpitPanel, the write', () => {

        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let showWarningMessageSpy: jest.SpyInstance;
        let showInformationMessageSpy: jest.SpyInstance;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedCommands = () => postedPanelMessages.map(hostMessage => hostMessage.command);
        const lastRecipeData = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData');

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

            (vscode.window.createWebviewPanel as jest.Mock).mockReset().mockImplementation(() => fakeWebviewPanel);
            (vscode.window.showWarningMessage as jest.Mock).mockReset();

            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation(() => ({ text: '', dispose: jest.fn() }) as any);
            showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            showInformationMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showInformationMessage').mockImplementation(() => undefined);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;
            (RecipeCockpitService as any).recipeCockpitPanelState = undefined;

        });

        afterEach(() => {
            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitPanelState = undefined;
        });

        it('on confirmation removes the line, records it beside the recipe, reloads onto Open, and Restore puts it back byte for byte', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_title: string, _options: unknown, ...labels: string[]) => labels[0]);

            await openRenderedCockpit();
            await receivedMessageHandler(removeMessage(PHONE_TODO.lineNumber));

            const removedText = fs.readFileSync(recipeFilePath, 'utf-8');
            expect(removedText).toBe(RECIPE_TEXT.replace('        # TODO check the phone format\n', ''));
            expect(() => yaml.load(removedText)).not.toThrow();
            expect(RecipeCockpitRemovedTodoStore.parse(fs.readFileSync(removedTodoFilePath, 'utf-8')).entries).toEqual([expect.objectContaining({ fieldApiName: 'Phone', todoText: PHONE_TODO.text, kind: 'line' })]);
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0]).toEqual([
                'Remove this TODO from the recipe?',
                { inPanel: true, detail: expect.stringContaining(path.basename(removedTodoFilePath)) },
                RECIPE_COCKPIT_TODO_REMOVE_CONFIRM_LABEL
            ]);
            expect(showInformationMessageSpy).toHaveBeenCalledWith(expect.stringContaining('Removed a TODO'));
            expect(postedPanelMessages.filter(hostMessage => hostMessage.command === 'wireLookupState').map(hostMessage => hostMessage.isRunning)).toEqual([true, false]);
            expect(lastRecipeData().focusTree).toEqual({ treeKey: TREE_KEY, tab: 'troubleshooting', troubleshootingSubTab: 'todos', todosView: 'open' });
            expect(lastRecipeData().recipe.trees[0].removedTodos).toEqual([expect.objectContaining({ removalKey: '0', fieldApiName: 'Phone', text: PHONE_TODO.text })]);

            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            postedPanelMessages.length = 0;
            await receivedMessageHandler(restoreMessage('0'));

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(RECIPE_TEXT);
            expect(fs.existsSync(removedTodoFilePath)).toBe(false);
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[1][2]).toBe(RECIPE_COCKPIT_TODO_RESTORE_CONFIRM_LABEL);
            expect(lastRecipeData().focusTree).toEqual({ treeKey: TREE_KEY, tab: 'troubleshooting', troubleshootingSubTab: 'todos', todosView: 'removed' });
            expect(lastRecipeData().recipe.trees[0]).not.toHaveProperty('removedTodos');

        });

        it('cuts a TODO off the end of a line and keeps the value, and puts it back', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_title: string, _options: unknown, ...labels: string[]) => labels[0]);

            await openRenderedCockpit();
            await receivedMessageHandler(removeMessage(NAME_TODO.lineNumber));

            const removedText = fs.readFileSync(recipeFilePath, 'utf-8');
            expect(removedText).toBe(RECIPE_TEXT.replace(' # TODO pick a real company', ''));
            expect((yaml.load(removedText) as any)[0].fields.Name).toBe('${{ fake.Company }}');

            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await receivedMessageHandler(restoreMessage('0'));
            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(RECIPE_TEXT);

        });

        it('on cancel writes nothing, reloads nothing and gives the buttons back', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            await openRenderedCockpit();
            await receivedMessageHandler(removeMessage(PHONE_TODO.lineNumber));

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(RECIPE_TEXT);
            expect(fs.existsSync(removedTodoFilePath)).toBe(false);
            expect(postedPanelMessages).toEqual([{ command: 'wireLookupState', isRunning: true }, { command: 'wireLookupState', isRunning: false }]);

        });

        it('given the TODO edited while the confirmation was open, says why and writes nothing', async () => {

            const editedText = RECIPE_TEXT.replace('# TODO check the phone format', '# TODO check the phone format, edited');
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => {
                fs.writeFileSync(recipeFilePath, editedText);
                return RECIPE_COCKPIT_TODO_REMOVE_CONFIRM_LABEL;
            });

            await openRenderedCockpit();
            await receivedMessageHandler(removeMessage(PHONE_TODO.lineNumber));

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(editedText);
            expect(fs.existsSync(removedTodoFilePath)).toBe(false);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('The TODO was not removed: Line 8 of the recipe no longer carries this TODO'));
            expect(postedCommands()).not.toContain('recipeData');

        });

        it('never writes over a removed-TODOs file it cannot read, nor through one that is a link', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_TODO_REMOVE_CONFIRM_LABEL);

            await openRenderedCockpit();
            fs.writeFileSync(removedTodoFilePath, '{ not json');
            await receivedMessageHandler(removeMessage(PHONE_TODO.lineNumber));

            expect(fs.readFileSync(removedTodoFilePath, 'utf-8')).toBe('{ not json');
            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(RECIPE_TEXT);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('is not a removed-TODOs file the Recipe Cockpit can read'));

            const outsideFilePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-outside-')), 'outside.json');
            fs.writeFileSync(outsideFilePath, 'outside');
            fs.rmSync(removedTodoFilePath);
            fs.symlinkSync(outsideFilePath, removedTodoFilePath);
            await receivedMessageHandler(removeMessage(PHONE_TODO.lineNumber));

            expect(fs.readFileSync(outsideFilePath, 'utf-8')).toBe('outside');
            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(RECIPE_TEXT);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('is a link or is outside this workspace'));
            fs.rmSync(path.dirname(outsideFilePath), { recursive: true, force: true });

        });

        it('puts the removed-TODOs file back as it was when the recipe cannot be written', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_TODO_REMOVE_CONFIRM_LABEL);
            const realRenameSync = fs.renameSync;
            jest.spyOn(fs, 'renameSync').mockImplementation((fromPath: fs.PathLike, toPath: fs.PathLike) => {
                if ( toPath === recipeFilePath ) {
                    throw new Error('disk full');
                }
                return realRenameSync(fromPath, toPath);
            });

            await openRenderedCockpit();
            await receivedMessageHandler(removeMessage(PHONE_TODO.lineNumber));

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(RECIPE_TEXT);
            expect(fs.existsSync(removedTodoFilePath)).toBe(false);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('could not be written (disk full)'));

        });

        it('on a cancelled Restore writes nothing', async () => {

            const removedText = writeRemovedTodoFile(RECIPE_TEXT, PHONE_TODO.lineNumber, PHONE_TODO.text);
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            await openRenderedCockpit();
            await receivedMessageHandler(restoreMessage('0'));

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(removedText);
            expect(RecipeCockpitRemovedTodoStore.parse(fs.readFileSync(removedTodoFilePath, 'utf-8')).entries).toHaveLength(1);

        });

        it.each([
            ['the removed-TODOs file no longer lists it', () => fs.writeFileSync(removedTodoFilePath, RecipeCockpitRemovedTodoStore.serialize([])), 'no longer lists this TODO'],
            ['the recipe file is gone', () => fs.rmSync(recipeFilePath), 'no longer exists in this workspace'],
            ['the recipe file cannot be read', () => { fs.rmSync(recipeFilePath); fs.mkdirSync(recipeFilePath); }, 'could not be read']
        ])('refuses a Restore when %s, before asking', async (_description, changeFiles, refusalText) => {

            writeRemovedTodoFile(RECIPE_TEXT, PHONE_TODO.lineNumber, PHONE_TODO.text);

            await openRenderedCockpit();
            changeFiles();
            await receivedMessageHandler(restoreMessage('0'));

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining(refusalText));
            expect(postedCommands()).not.toContain('recipeData');

        });

        it('refuses a Restore whose place went while the confirmation was open', async () => {

            const removedText = writeRemovedTodoFile(RECIPE_TEXT, PHONE_TODO.lineNumber, PHONE_TODO.text);
            const editedText = removedText.replace('    Phone: ${{ fake.PhoneNumber }}', '    Phone: "555-0100"');
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => {
                fs.writeFileSync(recipeFilePath, editedText);
                return RECIPE_COCKPIT_TODO_RESTORE_CONFIRM_LABEL;
            });

            await openRenderedCockpit();
            await receivedMessageHandler(restoreMessage('0'));

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(editedText);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('The TODO was not put back'));

        });

        it('keeps the removed-TODOs file as it was when a Restore cannot write the recipe', async () => {

            const removedText = writeRemovedTodoFile(RECIPE_TEXT, PHONE_TODO.lineNumber, PHONE_TODO.text);
            const removedTodoFileText = fs.readFileSync(removedTodoFilePath, 'utf-8');
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_TODO_RESTORE_CONFIRM_LABEL);
            const realRenameSync = fs.renameSync;
            jest.spyOn(fs, 'renameSync').mockImplementation((fromPath: fs.PathLike, toPath: fs.PathLike) => {
                if ( toPath === recipeFilePath ) {
                    throw new Error('disk full');
                }
                return realRenameSync(fromPath, toPath);
            });

            await openRenderedCockpit();
            await receivedMessageHandler(restoreMessage('0'));

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(removedText);
            expect(fs.readFileSync(removedTodoFilePath, 'utf-8')).toBe(removedTodoFileText);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('The TODO was not put back: "'));

        });

        it('refuses a Restore whose place in the recipe is gone, and keeps it listed', async () => {

            writeRemovedTodoFile(RECIPE_TEXT, PHONE_TODO.lineNumber, PHONE_TODO.text);
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_TODO_RESTORE_CONFIRM_LABEL);

            await openRenderedCockpit();
            const editedText = fs.readFileSync(recipeFilePath, 'utf-8').replace('    Phone: ${{ fake.PhoneNumber }}', '    Phone: "555-0100"');
            fs.writeFileSync(recipeFilePath, editedText);
            await receivedMessageHandler(restoreMessage('0'));

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(editedText);
            expect(RecipeCockpitRemovedTodoStore.parse(fs.readFileSync(removedTodoFilePath, 'utf-8')).entries).toHaveLength(1);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('The TODO was not put back'));
            expect(postedCommands()).not.toContain('recipeData');

        });

    });

    describe('the panel', () => {

        type Panel = ReturnType<typeof runPanelScript>;

        const drawRecipe = (recipe: IRecipeCockpitRecipeViewModel, savedState?: any): Panel => {
            const panel = runPanelScript(savedState ? { savedState } : {});
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 3 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            panel.openTab(panel.treeCards()[0], 'Troubleshooting');
            return panel;
        };

        const cardOf = (panel: Panel) => panel.treeCards()[0];
        const viewPanelOf = (panel: Panel, todosView: string) => panel.findAll(cardOf(panel), `todosViewPanel-${todosView}`)[0];
        const viewTabOf = (panel: Panel, todosView: string) => panel.findAll(cardOf(panel), `todosView-${todosView}`)[0];
        const openRowsOf = (panel: Panel) => panel.findAll(viewPanelOf(panel, 'open'), 'troubleshootingTodo');
        const rowOf = (panel: Panel, fieldLabel: string) => openRowsOf(panel).find((rowElement: any) => panel.findAll(rowElement, 'troubleshootingTodoField')[0].textContent === fieldLabel);

        const modelWithRemoved = () => {
            writeRemovedTodoFile(RECIPE_TEXT, PHONE_TODO.lineNumber, PHONE_TODO.text);
            return loadModel();
        };

        it('draws each row with the field, its line link and its button on the first line and the TODO under them', () => {

            const panel = drawRecipe(loadModel());
            const phoneRow = rowOf(panel, 'Phone');
            const headElement = panel.findAll(phoneRow, 'troubleshootingTodoHead')[0];

            expect(headElement.children.map((childElement: any) => childElement.className.split(' ').find((className: string) => className.startsWith('troubleshootingTodo') || className === 'treeTodoSource'))).toEqual(['troubleshootingTodoField', 'treeTodoSource', 'troubleshootingTodoAction']);
            expect(headElement.children.map((childElement: any) => childElement.textContent)).toEqual(['Phone', '↗ yml', 'Remove TODO']);
            expect(phoneRow.children[1].className).toBe('troubleshootingTodoText');
            expect(phoneRow.children[1].textContent).toBe(PHONE_TODO.text);
            // AN OBJECT'S OWN TODO SAYS SO, MUTED, IN THE SAME PLACE
            expect(panel.findAll(rowOf(panel, 'on the object'), 'troubleshootingTodoField')[0].className).toBe('troubleshootingTodoField muted');

        });

        it('disables Remove TODO on a TODO a lock holds, and says why; a lookup\'s says to wire it', () => {

            const panel = drawRecipe(loadModel());
            const parentRemove = panel.findAll(rowOf(panel, 'ParentId'), 'troubleshootingTodoRemove')[0];

            expect(parentRemove.disabled).toBe(true);
            expect(parentRemove.attributes.title).toBe(RECIPE_COCKPIT_TODO_REFERENCE_LOOKUP_REASON);
            expect(panel.findAll(rowOf(panel, 'Phone'), 'troubleshootingTodoRemove')[0].disabled).toBe(false);

            const recipe = loadModel();
            recipe.objects[0].fields.find(field => field.fieldApiName === 'Phone').todos[0].removeLock = 'record-type-options';
            const lockedPanel = drawRecipe(recipe);
            expect(panel.findAll(rowOf(lockedPanel, 'Phone'), 'troubleshootingTodoRemove')[0].attributes.title).toBe(RECIPE_COCKPIT_TODO_REMOVE_LOCK_REASONS['record-type-options']);

            // A TODO OF ANOTHER CARD'S RECIPE FILE IS REMOVED ONLY FROM THAT CARD
            const otherRecipe = loadModel();
            otherRecipe.trees[0].runFakerRecipeFileName = 'recipe--Other.yml';
            const otherPanel = drawRecipe(otherRecipe);
            expect(panel.findAll(rowOf(otherPanel, 'Phone'), 'troubleshootingTodoRemove')[0].attributes.title).toBe(RECIPE_COCKPIT_TODO_OTHER_RECIPE_REASON);

        });

        it('posts the card and the line on a click, and holds every TODO button until the host gives them back', () => {

            const panel = drawRecipe(modelWithRemoved());
            const nameRemove = panel.findAll(rowOf(panel, 'Name'), 'troubleshootingTodoRemove')[0];
            const restoreButton = panel.findAll(viewPanelOf(panel, 'removed'), 'troubleshootingTodoRestore')[0];

            nameRemove.dispatch('click');

            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'removeTodo', treeKey: TREE_KEY, lineNumber: NAME_TODO.lineNumber });
            expect(nameRemove.disabled).toBe(true);
            expect(restoreButton.disabled).toBe(true);
            expect(panel.findAll(rowOf(panel, 'ParentId'), 'troubleshootingTodoRemove')[0].disabled).toBe(true);

            panel.postToPanel({ command: 'wireLookupState', isRunning: false });
            expect(nameRemove.disabled).toBe(false);
            expect(restoreButton.disabled).toBe(false);
            // A LOCKED ONE STAYS DISABLED
            expect(panel.findAll(rowOf(panel, 'ParentId'), 'troubleshootingTodoRemove')[0].disabled).toBe(true);

        });

        it('draws Open and Removed with their counts, Open first, and lists a removed TODO with Restore', () => {

            const panel = drawRecipe(modelWithRemoved());

            expect(viewTabOf(panel, 'open').textContent).toBe('Open (3)');
            expect(viewTabOf(panel, 'removed').textContent).toBe('Removed (1)');
            expect(panel.isHidden(viewPanelOf(panel, 'open'))).toBe(false);
            expect(panel.isHidden(viewPanelOf(panel, 'removed'))).toBe(true);

            viewTabOf(panel, 'removed').dispatch('click');

            expect(panel.isHidden(viewPanelOf(panel, 'open'))).toBe(true);
            expect(viewTabOf(panel, 'removed').attributes['aria-selected']).toBe('true');
            const removedRows = panel.findAll(viewPanelOf(panel, 'removed'), 'troubleshootingTodo');
            expect(removedRows.map((rowElement: any) => [panel.findAll(rowElement, 'troubleshootingTodoField')[0].textContent, panel.findAll(rowElement, 'troubleshootingTodoText')[0].textContent])).toEqual([['Phone', PHONE_TODO.text]]);
            expect(panel.findAll(viewPanelOf(panel, 'removed'), 'troubleshootingTodoObject')[0].textContent).toBe('Account · Account_NickName');

            panel.findAll(removedRows[0], 'troubleshootingTodoRestore')[0].dispatch('click');
            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'restoreTodo', treeKey: TREE_KEY, removalKey: '0' });

        });

        it('says when nothing was removed, and searches the Removed list by its own box', () => {

            const emptyPanel = drawRecipe(loadModel());
            expect(emptyPanel.findAll(viewPanelOf(emptyPanel, 'removed'), 'treeEmpty')[0].textContent).toBe(RECIPE_COCKPIT_NO_REMOVED_TODOS_NOTE);
            expect(viewTabOf(emptyPanel, 'removed').textContent).toBe('Removed (0)');

            const panel = drawRecipe(modelWithRemoved());
            const removedPanel = viewPanelOf(panel, 'removed');
            expect(panel.findAll(removedPanel, 'tabMatchCount')[0].textContent).toBe('1 removed TODO');

            panel.typeIntoTabSearch(cardOf(panel), 'todosViewPanel-removed', 'nothing like it');
            expect(panel.findAll(removedPanel, 'tabMatchCount')[0].textContent).toBe('no matches');
            expect(panel.isHidden(panel.findAll(removedPanel, 'troubleshootingTodoGroup')[0])).toBe(true);
            // THE OPEN LIST'S SEARCH IS ITS OWN
            expect(panel.findAll(viewPanelOf(panel, 'open'), 'tabMatchCount')[0].textContent).toBe('3 TODOs');

            panel.typeIntoTabSearch(cardOf(panel), 'todosViewPanel-removed', 'phone');
            expect(panel.findAll(removedPanel, 'tabMatchCount')[0].textContent).toBe('1 of 1 removed TODO');

        });

        it('keeps the Removed list and its search in the place, and opens on it again', () => {

            const panel = drawRecipe(modelWithRemoved());
            viewTabOf(panel, 'removed').dispatch('click');
            panel.typeIntoTabSearch(cardOf(panel), 'todosViewPanel-removed', 'phone');

            const savedTree = panel.savedState().trees.find((candidateTree: any) => candidateTree.treeKey === TREE_KEY);
            expect(savedTree).toEqual(expect.objectContaining({ todosView: 'removed', removedTodosSearchText: 'phone' }));
            // THE TODO'S SUB-TAB IS THE FIRST, SO IT IS NOT WRITTEN
            expect(savedTree).not.toHaveProperty('troubleshootingSubTab');

            const restoredPanel = drawRecipe(modelWithRemoved(), panel.savedState());
            expect(panel.isHidden(viewPanelOf(restoredPanel, 'removed'))).toBe(false);
            expect(panel.findAll(viewPanelOf(restoredPanel, 'removed'), 'tabSearchInput')[0].value).toBe('phone');

            // THE HOST KEEPS BOTH, AND NOTHING ELSE NAMED SO
            const normalizedPlace = RecipeCockpitService.normalizePanelPlace({ ...panel.savedState(), version: RECIPE_COCKPIT_PANEL_PLACE_VERSION });
            expect(normalizedPlace.trees[0]).toEqual(expect.objectContaining({ todosView: 'removed', removedTodosSearchText: 'phone' }));
            expect(RecipeCockpitService.normalizePanelPlace({ ...panel.savedState(), trees: [{ ...savedTree, todosView: 'open', removedTodosSearchText: 7 }] }).trees[0]).not.toContainAnyKeys(['todosView', 'removedTodosSearchText']);

        });

        it('a reload after a Restore opens the Removed list it was clicked in', () => {

            const panel = runPanelScript({});
            panel.postToPanel({ command: 'recipeData', recipe: modelWithRemoved(), renderSequence: 3, focusTree: { treeKey: TREE_KEY, tab: 'troubleshooting', troubleshootingSubTab: 'todos', todosView: 'removed' } });
            panel.postToPanel({ command: 'rendered' });

            expect(panel.isHidden(viewPanelOf(panel, 'removed'))).toBe(false);
            expect(panel.isHidden(viewPanelOf(panel, 'open'))).toBe(true);

        });

    });

});
