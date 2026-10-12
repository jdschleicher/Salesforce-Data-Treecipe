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
    RECIPE_COCKPIT_ADD_PARENT_OBJECT_CONFIRM_LABEL,
    RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL
} from '../RecipeCockpitService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { RelationshipService } from '../../RelationshipService/RelationshipService';
import { RecipeCockpitRecipeWriter } from '../RecipeCockpitRecipeWriter';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    "Add <Parent> to recipe" (#294), end to end on the host and in the panel: the model offers each
    TODO lookup whose one standard parent the recipe does not write, the router admits only what the
    confirmed-drawn model offered, and the executor confirms, writes the parent from the recipe's own
    backend's template, wires the lookup and reloads. The writer's rule is asserted in
    RecipeCockpitAddParentObject.test.ts.

    The tree is Account, User and Opportunity (lookup targets Generate Treecipe lists with no
    recipe) and Contact. The recipe writes Contact only: AccountId is addable; Owner__c points at
    User, which has no template; Related__c can name Account or Opportunity; ReportsToId is a
    self-lookup.
*/

const TODO = '### TODO -- REFERENCE ID REQUIRED';
const TREE_OBJECTS = ['Account', 'User', 'Opportunity', 'Contact'];
const TREE_KEY = RelationshipService.buildRecipeTreeFolderName(TREE_OBJECTS);

const RECIPE_TEXT = [
    '# Relationship Tree: RelationshipTree_1',
    '',
    '# Contact (Parents: Account, Contact, Opportunity, User)',
    '- object: Contact',
    '  nickname: Contact_NickName',
    '  count: 2',
    '  fields:',
    '    LastName: ${{ faker.person.lastName() }}',
    `    AccountId: ${TODO}`,
    `    ReportsToId: ${TODO}`,
    `    Owner__c: ${TODO}`,
    `    Related__c: ${TODO}`,
    ''
].join('\n');

const buildWrapperField = (objectApiName: string, fieldApiName: string, fieldType: string) => ({
    objectName: objectApiName, fieldName: fieldApiName, fieldLabel: fieldApiName, type: fieldType, recipeValue: fieldType === 'Lookup' ? TODO : ''
});

const OBJECTS_WRAPPER = {
    ObjectToObjectInfoMap: {
        Account: { RelationshipDetail: { level: 0, parentObjectToFieldReferences: {} } },
        User: { RelationshipDetail: { level: 0, parentObjectToFieldReferences: {} } },
        Opportunity: { RelationshipDetail: { level: 0, parentObjectToFieldReferences: {} } },
        Contact: {
            Fields: [
                buildWrapperField('Contact', 'LastName', 'Text'),
                buildWrapperField('Contact', 'AccountId', 'Lookup'),
                buildWrapperField('Contact', 'ReportsToId', 'Lookup'),
                buildWrapperField('Contact', 'Owner__c', 'Lookup'),
                buildWrapperField('Contact', 'Related__c', 'Lookup')
            ],
            RelationshipDetail: {
                level: 1,
                parentObjectToFieldReferences: { Account: ['AccountId', 'Related__c'], Contact: ['ReportsToId'], User: ['Owner__c'], Opportunity: ['Related__c'] }
            }
        }
    },
    RecipeFiles: [{ objects: TREE_OBJECTS }]
};

const BACKENDS: ReadonlyArray<[string, string, Record<string, Record<string, string>>]> = [
    ['faker-js', 'recipe-fakerjs-2026-10-01T00-00-00', new FakerJSRecipeFakerService().getMinimumRequiredFieldsTemplate()],
    ['snowfakery', 'recipe-2026-10-01T00-00-00', new SnowfakeryRecipeFakerService().getMinimumRequiredFieldsTemplate()]
];

const ADD_ACCOUNT_MESSAGE = { command: 'addParentObject', treeKey: TREE_KEY, objectApiName: 'Contact', fieldApiName: 'AccountId' };
const NOTHING_RUNS = { kind: 'postWireLookupState', hostMessage: { command: 'wireLookupState', isRunning: false } };
const ACCOUNT_ADDITION = { objectApiName: 'Contact', fieldApiName: 'AccountId', parentObjectApiName: 'Account' };

describe.each(BACKENDS)('RecipeCockpitService, adding a lookup\'s parent to a %s recipe (#294)', (backendName, runFolderName, template) => {

    let workspaceRoot: string;
    let recipeFilePath: string;

    beforeEach(() => {

        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-add-parent-'));
        const runFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', runFolderName);
        fs.mkdirSync(path.join(runFolderPath, TREE_KEY), { recursive: true });
        fs.writeFileSync(path.join(runFolderPath, 'treecipeObjectsWrapper-2026-10-01T00-00-00.json'), JSON.stringify(OBJECTS_WRAPPER));
        const recipePrefix = backendName === 'faker-js' ? 'recipe-fakerjs' : 'recipe';
        recipeFilePath = path.join(runFolderPath, TREE_KEY, `${recipePrefix}--${TREE_KEY}-2026-10-01T00-00-00.yml`);
        fs.writeFileSync(recipeFilePath, RECIPE_TEXT);

    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    const loadModel = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.buildRecipeViewModel(workspaceRoot);

    const buildActivePanelState = (recipeViewModel = loadModel()): IRecipeCockpitPanelState => {
        const panelState = RecipeCockpitService.buildInitialPanelState(workspaceRoot);
        panelState.recipeDataMessage = { command: 'recipeData', recipe: recipeViewModel, renderSequence: 1 };
        panelState.pendingAddableParentTargets = RecipeCockpitService.collectAddableParentTargets(recipeViewModel, new Map([[TREE_KEY, recipeFilePath]]));
        panelState.addableParentTargets = panelState.pendingAddableParentTargets;
        return panelState;
    };

    describe('the model', () => {

        it('offers the one lookup to a templated parent the recipe does not write, and no other', () => {

            const tree = loadModel().trees.find(candidateTree => candidateTree.treeKey === TREE_KEY);

            expect(tree.addableParents).toEqual([ACCOUNT_ADDITION]);
            expect(tree).not.toHaveProperty('lookupWirings');

        });

        it('posts no addableParents once the recipe writes the parent', () => {

            fs.writeFileSync(recipeFilePath, `- object: Account\n  nickname: Account_NickName\n  count: 1\n  fields:\n    Name: x\n\n${RECIPE_TEXT}`);

            expect(loadModel().trees.find(candidateTree => candidateTree.treeKey === TREE_KEY)).not.toHaveProperty('addableParents');

        });

        it('reads the recipe from disk when the load has not, and offers nothing for a file it cannot read', () => {

            const tree = loadModel().trees.find(candidateTree => candidateTree.treeKey === TREE_KEY);
            const levels = new Map([['Account', 0], ['Contact', 1]]);

            expect(RecipeCockpitService.listTreeAddableParents(recipeFilePath, tree, levels)).toEqual([ACCOUNT_ADDITION]);
            expect(RecipeCockpitService.listTreeAddableParents(path.join(workspaceRoot, 'missing.yml'), tree, levels)).toEqual([]);

        });

        it('maps each drawn "Add" to the card\'s recipe file, host-only', () => {

            const targets = RecipeCockpitService.collectAddableParentTargets(loadModel(), new Map([[TREE_KEY, recipeFilePath]]));

            expect([...targets.entries()]).toEqual([[`${TREE_KEY}\nContact\n\nAccountId`, { recipeFilePath: recipeFilePath, addition: ACCOUNT_ADDITION }]]);
            expect(RecipeCockpitService.collectAddableParentTargets(loadModel(), new Map()).size).toBe(0);

        });

    });

    describe('routePanelMessage', () => {

        it('routes by names to the host-only recipe file, never a path or parent the message carries', () => {

            expect(RecipeCockpitService.routePanelMessage({ ...ADD_ACCOUNT_MESSAGE, filePath: '/etc/passwd', friendObjectApiName: 'Evil__c' }, buildActivePanelState())).toEqual({
                kind: 'addParentObject',
                treeKey: TREE_KEY,
                recipeFilePath: recipeFilePath,
                addition: ACCOUNT_ADDITION
            });

        });

        it('refuses until the panel has confirmed drawing the model', () => {

            const panelState = buildActivePanelState();
            panelState.addableParentTargets = new Map();

            expect(RecipeCockpitService.routePanelMessage(ADD_ACCOUNT_MESSAGE, panelState)).toEqual(NOTHING_RUNS);

        });

        it.each([
            ['a parent with no template', { fieldApiName: 'Owner__c' }],
            ['a polymorphic lookup', { fieldApiName: 'Related__c' }],
            ['a self-lookup', { fieldApiName: 'ReportsToId' }],
            ['a field that is not a lookup', { fieldApiName: 'LastName' }],
            ['an occurrence nickname the row does not draw', { objectNickname: 'Contact_NickName' }],
            ['another card', { treeKey: 'Lead-ONLY' }],
            ['a field that is not a string', { fieldApiName: ['AccountId'] }],
            ['a nickname that is not a string', { objectNickname: 7 }],
            ['no tree', { treeKey: undefined }]
        ])('refuses %s', (_description, override) => {

            expect(RecipeCockpitService.routePanelMessage({ ...ADD_ACCOUNT_MESSAGE, ...override }, buildActivePanelState())).toEqual(NOTHING_RUNS);

        });

        it('shares the wiring\'s one-write lock and waits for an Add friend', () => {

            const panelState = buildActivePanelState();
            panelState.wireLookupStateMessage = { command: 'wireLookupState', isRunning: true };
            expect(RecipeCockpitService.routePanelMessage(ADD_ACCOUNT_MESSAGE, panelState)).toBeUndefined();

            panelState.wireLookupStateMessage = undefined;
            panelState.addFriendStateMessage = { command: 'addFriendState', isRunning: true };
            expect(RecipeCockpitService.routePanelMessage(ADD_ACCOUNT_MESSAGE, panelState)).toEqual(NOTHING_RUNS);

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
            (vscode.window.showQuickPick as jest.Mock).mockReset();

            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation(() => ({ text: '', dispose: jest.fn() }) as any);
            showWarningMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            showInformationMessageSpy = jest.spyOn(VSCodeWorkspaceService, 'showInformationMessage').mockImplementation(() => undefined);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        it(`on confirmation adds Account from the ${backendName} template, wires the lookup, and reloads with Account in the card`, async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_ADD_PARENT_OBJECT_CONFIRM_LABEL);

            await openRenderedCockpit();
            await receivedMessageHandler(ADD_ACCOUNT_MESSAGE);

            const writtenText = fs.readFileSync(recipeFilePath, 'utf-8');
            expect(writtenText).toBe([
                '# Relationship Tree: RelationshipTree_1',
                '',
                '# Account (Added by the Recipe Cockpit as the parent of Contact.AccountId)',
                '- object: Account',
                '  nickname: Account_NickName',
                '  count: 1',
                '  fields:',
                `    Name: ${template.Account.Name}`,
                '',
                ...RECIPE_TEXT.split('\n').slice(2)
            ].join('\n').replace(`    AccountId: ${TODO}`, '    AccountId: Account_NickName'));

            const loadedObjects = yaml.load(writtenText) as { object: string; fields: Record<string, unknown> }[];
            expect(loadedObjects.map(loadedObject => loadedObject.object)).toEqual(['Account', 'Contact']);
            expect(loadedObjects[1].fields.AccountId).toBe('Account_NickName');

            const [title, options, confirmLabel] = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0];
            expect(title).toBe('Add Account to the recipe and wire Contact.AccountId to it?');
            expect(options.modal).toBe(true);
            expect(options.detail).toContain(path.basename(recipeFilePath));
            expect(options.detail).toContain(`Fields, from the ${backendName} minimum required fields template: Name.`);
            expect(confirmLabel).toBe(RECIPE_COCKPIT_ADD_PARENT_OBJECT_CONFIRM_LABEL);
            expect(showInformationMessageSpy).toHaveBeenCalledWith(expect.stringContaining('Added Account as Account_NickName'));

            expect(postedPanelMessages.filter(hostMessage => hostMessage.command === 'wireLookupState').map(hostMessage => hostMessage.isRunning)).toEqual([true, false]);
            expect(postedPanelMessages.find(hostMessage => hostMessage.command === 'recipeData').focusTree).toEqual({ treeKey: TREE_KEY, tab: 'treecipe' });

            // THE CARD NOW DRAWS ACCOUNT, OFFERS NOTHING MORE TO ADD, AND THE CONTACT ROW SHOWS THE NICKNAME
            const reloadedModel = lastModel();
            const reloadedTree = reloadedModel.trees.find(candidateTree => candidateTree.treeKey === TREE_KEY);
            expect(reloadedTree).not.toHaveProperty('addableParents');
            expect(reloadedModel.objects.map(objectViewModel => objectViewModel.objectApiName)).toContain('Account');
            expect(reloadedModel.objects.find(objectViewModel => objectViewModel.objectApiName === 'Contact').fields.find(field => field.fieldApiName === 'AccountId').recipeValue).toBe('Account_NickName');

            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            expect(RecipeCockpitService.routePanelMessage(ADD_ACCOUNT_MESSAGE, (RecipeCockpitService as any).recipeCockpitPanelState)).toEqual(NOTHING_RUNS);

        });

        it('on cancel writes nothing, reloads nothing and gives the buttons back', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            await openRenderedCockpit();
            await receivedMessageHandler(ADD_ACCOUNT_MESSAGE);

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(RECIPE_TEXT);
            expect(postedPanelMessages).toEqual([{ command: 'wireLookupState', isRunning: true }, { command: 'wireLookupState', isRunning: false }]);
            expect(showInformationMessageSpy).not.toHaveBeenCalled();

        });

        it.each([
            ['the lookup filled in by hand', RECIPE_TEXT.replace(`AccountId: ${TODO}`, 'AccountId: 001000000000001'), 'is no longer'],
            ['the parent added by hand', `- object: Account\n  nickname: Mine\n  count: 1\n\n${RECIPE_TEXT}`, 'already has a "- object: Account" block'],
            ['the object written twice with no nicknames to tell apart', `${RECIPE_TEXT}\n${RECIPE_TEXT.split('\n').slice(3).join('\n').replace('  nickname: Contact_NickName\n', '')}`, 'cannot be told apart']
        ])('given %s since the draw, says why and writes nothing', async (_description, editedText, reason) => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_ADD_PARENT_OBJECT_CONFIRM_LABEL);

            await openRenderedCockpit();
            fs.writeFileSync(recipeFilePath, editedText);
            await receivedMessageHandler(ADD_ACCOUNT_MESSAGE);

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(editedText);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('Account was not added to'));
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining(reason));
            expect(postedCommands()).not.toContain('recipeData');

        });

        it('given the recipe file removed while the confirmation was open, writes nothing', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => {
                fs.rmSync(recipeFilePath);
                return RECIPE_COCKPIT_ADD_PARENT_OBJECT_CONFIRM_LABEL;
            });

            await openRenderedCockpit();
            await receivedMessageHandler(ADD_ACCOUNT_MESSAGE);

            expect(fs.existsSync(recipeFilePath)).toBe(false);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('so nothing was added.'));
            expect(postedCommands()).toEqual(['wireLookupState', 'wireLookupState']);

        });

        it('given the recipe file gone since the draw, says so before asking anything', async () => {

            await openRenderedCockpit();
            fs.rmSync(recipeFilePath);
            await receivedMessageHandler(ADD_ACCOUNT_MESSAGE);

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('no longer exists in this workspace, so nothing was added. Re-open'));
            expect(postedCommands()).toEqual(['wireLookupState', 'wireLookupState']);

        });

        it('answers a refused message with the buttons back, and asks nothing', async () => {

            await openRenderedCockpit();
            await receivedMessageHandler({ ...ADD_ACCOUNT_MESSAGE, fieldApiName: 'Related__c' });

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(postedPanelMessages).toEqual([{ command: 'wireLookupState', isRunning: false }]);

        });

        it('given a recipe whose backend cannot be told from its names, says so before asking anything', async () => {

            const mixedFilePath = path.join(path.dirname(recipeFilePath), backendName === 'faker-js' ? `recipe--${TREE_KEY}-2026-10-01T00-00-00.yml` : `recipe-fakerjs--${TREE_KEY}-2026-10-01T00-00-00.yml`);
            fs.renameSync(recipeFilePath, mixedFilePath);
            recipeFilePath = mixedFilePath;

            await openRenderedCockpit();
            await receivedMessageHandler(ADD_ACCOUNT_MESSAGE);

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('which faker backend wrote it cannot be told'));
            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(RECIPE_TEXT);

        });

        it('given a backend template with no entry for the parent, says so before asking anything', async () => {

            await openRenderedCockpit();
            jest.spyOn(RecipeCockpitService, 'getParentObjectTemplates').mockReturnValue({});
            await receivedMessageHandler(ADD_ACCOUNT_MESSAGE);

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('there is no minimum required fields template for it'));

        });

        it('a template with no required field writes a block with its count only, and says so', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_ADD_PARENT_OBJECT_CONFIRM_LABEL);

            await openRenderedCockpit();
            jest.spyOn(RecipeCockpitService, 'getParentObjectTemplates').mockReturnValue({ Account: {} });
            await receivedMessageHandler(ADD_ACCOUNT_MESSAGE);

            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0][1].detail).toContain(`The ${backendName} template has no required field for Account, so its block has a count only.`);
            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toContain('- object: Account\n  nickname: Account_NickName\n  count: 1\n\n');

        });

        it('writes nothing when the file now names another parent than the one confirmed', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_ADD_PARENT_OBJECT_CONFIRM_LABEL);

            await openRenderedCockpit();
            jest.spyOn(RecipeCockpitRecipeWriter, 'addParentObject').mockReturnValue({ isApplied: true, recipeText: 'changed', parentObjectApiName: 'Lead', parentNickname: 'Lead_NickName', edits: [] });
            await receivedMessageHandler(ADD_ACCOUNT_MESSAGE);

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(RECIPE_TEXT);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('Contact.AccountId no longer points at it.'));

        });

        it('names the occurrence in the confirmation when the object is written twice', async () => {

            const twiceText = `${RECIPE_TEXT}\n${RECIPE_TEXT.split('\n').slice(3).join('\n').replace('Contact_NickName', 'Contact_Other_NickName')}`;
            fs.writeFileSync(recipeFilePath, twiceText);
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_ADD_PARENT_OBJECT_CONFIRM_LABEL);

            await openRenderedCockpit();
            await receivedMessageHandler({ ...ADD_ACCOUNT_MESSAGE, objectNickname: 'Contact_Other_NickName' });

            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0]).toBe('Add Account to the recipe and wire Contact (Contact_Other_NickName).AccountId to it?');
            const loadedObjects = yaml.load(fs.readFileSync(recipeFilePath, 'utf-8')) as { nickname: string; fields?: Record<string, unknown> }[];
            expect(loadedObjects.map(loadedObject => loadedObject.nickname)).toEqual(['Contact_NickName', 'Account_NickName', 'Contact_Other_NickName']);
            expect(loadedObjects[2].fields.AccountId).toBe('Account_NickName');

        });

        it('a "Wire to…" confirmation label does not add anything', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL);

            await openRenderedCockpit();
            await receivedMessageHandler(ADD_ACCOUNT_MESSAGE);

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(RECIPE_TEXT);

        });

    });

    describe('the panel script', () => {

        const renderModel = (recipeViewModel = loadModel()) => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipeViewModel, renderSequence: 1 });
            panel.expandAllTrees();
            panel.objectElements().forEach((objectElement: any) => panel.expandObject(objectElement));
            return panel;
        };

        const addButtonsOf = (panel: any) => panel.findAll(panel.cockpitBodyElement, 'treeAddParentObject');

        it('draws "Add Account to recipe" on the one addable lookup and on no other row', () => {

            const panel = renderModel();
            const contactElement = panel.objectElements().find((objectElement: any) => panel.findAll(objectElement, 'treeAddParentObject').length > 0);

            expect(addButtonsOf(panel).map((buttonElement: any) => buttonElement.textContent)).toEqual(['Add Account to recipe']);
            expect(addButtonsOf(panel)[0].attributes['aria-label']).toBe('Add Account to the recipe for Contact.AccountId');
            expect(panel.findAll(panel.fieldRowNamed(contactElement, 'AccountId'), 'treeAddParentObject')).toHaveLength(1);
            ['Related__c', 'Owner__c', 'ReportsToId', 'LastName'].forEach(fieldApiName => {
                expect(panel.findAll(panel.fieldRowNamed(contactElement, fieldApiName), 'treeAddParentObject')).toHaveLength(0);
            });

        });

        it('posts names only, and is held with every wire button until the host answers', () => {

            const panel = renderModel();
            const postedAdds = () => panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'addParentObject');

            addButtonsOf(panel)[0].dispatch('click');
            addButtonsOf(panel)[0].dispatch('click');

            expect(postedAdds()).toEqual([ADD_ACCOUNT_MESSAGE]);
            expect(addButtonsOf(panel)[0].disabled).toBe(true);

            panel.postToPanel({ command: 'wireLookupState', isRunning: false });
            expect(addButtonsOf(panel)[0].disabled).toBe(false);

        });

        it('names the occurrence when the object is written twice', () => {

            const recipeViewModel = loadModel();
            recipeViewModel.trees.find(candidateTree => candidateTree.treeKey === TREE_KEY).addableParents = [{ ...ACCOUNT_ADDITION, objectNickname: 'Contact_NickName' }];
            recipeViewModel.objects.find(objectViewModel => objectViewModel.objectApiName === 'Contact').nickname = 'Contact_NickName';

            const panel = renderModel(recipeViewModel);
            addButtonsOf(panel)[0].dispatch('click');

            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'addParentObject')).toEqual([{ ...ADD_ACCOUNT_MESSAGE, objectNickname: 'Contact_NickName' }]);

        });

        it('draws a model posted while a write is in flight with its button already disabled', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'wireLookupState', isRunning: true });
            panel.postToPanel({ command: 'recipeData', recipe: loadModel(), renderSequence: 1 });
            panel.expandAllTrees();
            panel.objectElements().forEach((objectElement: any) => panel.expandObject(objectElement));

            expect(addButtonsOf(panel).map((buttonElement: any) => buttonElement.disabled)).toEqual([true]);

        });

    });

});
