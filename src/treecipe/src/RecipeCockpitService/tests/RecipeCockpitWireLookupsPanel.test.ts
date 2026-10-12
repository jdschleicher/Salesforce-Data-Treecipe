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
    RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL
} from '../RecipeCockpitService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { RelationshipService } from '../../RelationshipService/RelationshipService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    "Wire to…" and "Wire TODO lookups" (#151), end to end on the host and in the panel: the model
    offers the TODO lookups the writer can wire, the router admits only what the confirmed-drawn
    model offered, and the executor picks, confirms, writes and reloads. The writer's own rule is
    asserted in RecipeCockpitWireLookups.test.ts.

    The recipe is flat, as snowfakery writes every recipe: Account at level 0, Contact and
    Opportunity at 1, Case at 2. Case.Related__c can name Account or Opportunity, so it is the one
    lookup with more than one record to choose from.
*/

const RUN_FOLDER_NAME = 'recipe-2026-10-01T00-00-00';
const TREE_KEY = 'Account-thru-Case';
const TODO = '### TODO -- REFERENCE ID REQUIRED';

const RECIPE_TEXT = [
    '- object: Account',
    '  nickname: Account_NickName',
    '  count: 1',
    '  fields:',
    '    Name: ${{ fake.Company }}',
    `    ParentId: ${TODO}`,
    '',
    '- object: Contact',
    '  nickname: Contact_NickName',
    '  count: 1',
    '  fields:',
    '    LastName: ${{ fake.LastName }}',
    `    AccountId: ${TODO}`,
    `    ReportsToId: ${TODO}`,
    '',
    '- object: Opportunity',
    '  nickname: Opportunity_NickName',
    '  count: 1',
    '  fields:',
    '    Name: ${{ fake.Word }}',
    `    AccountId: ${TODO}`,
    '',
    '- object: Case',
    '  nickname: Case_NickName',
    '  count: 1',
    '  fields:',
    '    Subject: ${{ fake.Word }}',
    `    ContactId: ${TODO}`,
    `    Related__c: ${TODO}`,
    ''
].join('\n');

// A LOOKUP'S WRAPPER ENTRY CARRIES THE TODO, AS GENERATE TREECIPE WRITES IT, WHATEVER THE RECIPE FILE NOW SAYS
const buildWrapperField = (objectApiName: string, fieldApiName: string, fieldType: string) => ({
    objectName: objectApiName, fieldName: fieldApiName, fieldLabel: fieldApiName, type: fieldType, recipeValue: fieldType === 'Lookup' ? TODO : ''
});

const OBJECTS_WRAPPER = {
    ObjectToObjectInfoMap: {
        Account: {
            Fields: [buildWrapperField('Account', 'Name', 'Text'), buildWrapperField('Account', 'ParentId', 'Lookup')],
            RelationshipDetail: { level: 0, parentObjectToFieldReferences: { Account: ['ParentId'] } }
        },
        Contact: {
            Fields: [buildWrapperField('Contact', 'LastName', 'Text'), buildWrapperField('Contact', 'AccountId', 'Lookup'), buildWrapperField('Contact', 'ReportsToId', 'Lookup')],
            RelationshipDetail: { level: 1, parentObjectToFieldReferences: { Account: ['AccountId'], Contact: ['ReportsToId'] } }
        },
        Opportunity: {
            Fields: [buildWrapperField('Opportunity', 'Name', 'Text'), buildWrapperField('Opportunity', 'AccountId', 'Lookup')],
            RelationshipDetail: { level: 1, parentObjectToFieldReferences: { Account: ['AccountId'] } }
        },
        Case: {
            Fields: [buildWrapperField('Case', 'Subject', 'Text'), buildWrapperField('Case', 'ContactId', 'Lookup'), buildWrapperField('Case', 'Related__c', 'Lookup')],
            RelationshipDetail: { level: 2, parentObjectToFieldReferences: { Contact: ['ContactId'], Account: ['Related__c'], Opportunity: ['Related__c'] } }
        }
    },
    RecipeFiles: [{ objects: ['Account', 'Contact', 'Opportunity', 'Case'] }]
};

const SINGLE_CANDIDATE_WIRINGS = [
    { objectApiName: 'Contact', fieldApiName: 'AccountId', candidateNicknames: ['Account_NickName'] },
    { objectApiName: 'Opportunity', fieldApiName: 'AccountId', candidateNicknames: ['Account_NickName'] },
    { objectApiName: 'Case', fieldApiName: 'ContactId', candidateNicknames: ['Contact_NickName'] }
];

describe('RecipeCockpitService, wiring TODO lookups to nicknames (#151)', () => {

    let workspaceRoot: string;
    let recipeFilePath: string;

    beforeEach(() => {

        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-wire-lookups-'));
        const runFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', RUN_FOLDER_NAME);
        fs.mkdirSync(path.join(runFolderPath, TREE_KEY), { recursive: true });
        fs.writeFileSync(path.join(runFolderPath, 'treecipeObjectsWrapper-2026-10-01T00-00-00.json'), JSON.stringify(OBJECTS_WRAPPER));
        recipeFilePath = path.join(runFolderPath, TREE_KEY, `recipe--${TREE_KEY}-2026-10-01T00-00-00.yml`);
        fs.writeFileSync(recipeFilePath, RECIPE_TEXT);

    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    const loadModel = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.buildRecipeViewModel(workspaceRoot);

    const buildActivePanelState = (recipeViewModel = loadModel()): IRecipeCockpitPanelState => {
        const panelState = RecipeCockpitService.buildInitialPanelState(workspaceRoot);
        panelState.recipeDataMessage = { command: 'recipeData', recipe: recipeViewModel, renderSequence: 1 };
        panelState.pendingWireableLookupTargets = RecipeCockpitService.collectWireableLookupTargets(recipeViewModel, new Map([[TREE_KEY, recipeFilePath]]));
        panelState.wireableLookupTargets = panelState.pendingWireableLookupTargets;
        return panelState;
    };

    const WIRE_CONTACT_MESSAGE = { command: 'wireLookup', treeKey: TREE_KEY, objectApiName: 'Contact', fieldApiName: 'AccountId' };
    const WIRE_RELATED_MESSAGE = { command: 'wireLookup', treeKey: TREE_KEY, objectApiName: 'Case', fieldApiName: 'Related__c' };
    const WIRE_ALL_MESSAGE = { command: 'wireAllLookups', treeKey: TREE_KEY };
    const NOTHING_RUNS = { kind: 'postWireLookupState', hostMessage: { command: 'wireLookupState', isRunning: false } };

    describe('the model', () => {

        it('lists every TODO lookup with a parent inserted before it, and leaves the self-lookups out', () => {

            expect(loadModel().trees.map(tree => [tree.treeKey, tree.lookupWirings])).toEqual([[TREE_KEY, [
                ...SINGLE_CANDIDATE_WIRINGS,
                { objectApiName: 'Case', fieldApiName: 'Related__c', candidateNicknames: ['Account_NickName', 'Opportunity_NickName'] }
            ]]]);

        });

        it('posts no lookupWirings on a card whose recipe has none left', () => {

            fs.writeFileSync(recipeFilePath, RECIPE_TEXT.split(TODO).join('Already_Filled'));

            expect(loadModel().trees[0]).not.toHaveProperty('lookupWirings');

        });

        it('builds the writer\'s context from the card\'s own lookups, with levels only when the run has them', () => {

            const tree = loadModel().trees[0];

            expect(RecipeCockpitService.buildLookupWiringContext(tree, undefined)).toEqual({
                parentLookupsByObjectApiName: new Map(tree.objects.map(treeObject => [treeObject.objectApiName, treeObject.parentLookups]))
            });
            expect(RecipeCockpitService.buildLookupWiringContext(tree, new Map([['Account', 0]])).levelsByObjectApiName).toEqual(new Map([['Account', 0]]));

        });

        it('maps each drawn "Wire to…" to the card\'s recipe file, host-only', () => {

            const targets = RecipeCockpitService.collectWireableLookupTargets(loadModel(), new Map([[TREE_KEY, recipeFilePath]]));

            expect([...targets.keys()]).toEqual([
                `${TREE_KEY}\nContact\n\nAccountId`,
                `${TREE_KEY}\nOpportunity\n\nAccountId`,
                `${TREE_KEY}\nCase\n\nContactId`,
                `${TREE_KEY}\nCase\n\nRelated__c`
            ]);
            expect([...targets.values()].map(target => target.recipeFilePath)).toEqual([recipeFilePath, recipeFilePath, recipeFilePath, recipeFilePath]);

        });

    });

    describe('routePanelMessage', () => {

        it('routes "Wire to…" by names to the host-only recipe file, never a path or nickname the message carries', () => {

            expect(RecipeCockpitService.routePanelMessage({ ...WIRE_CONTACT_MESSAGE, filePath: '/etc/passwd', nickname: 'Evil' }, buildActivePanelState())).toEqual({
                kind: 'wireLookups',
                treeKey: TREE_KEY,
                recipeFilePath: recipeFilePath,
                wirings: [SINGLE_CANDIDATE_WIRINGS[0]],
                isWireAll: false
            });

        });

        it('routes "Wire TODO lookups" to every lookup of the card with exactly one record to choose from', () => {

            expect(RecipeCockpitService.routePanelMessage(WIRE_ALL_MESSAGE, buildActivePanelState())).toEqual({
                kind: 'wireLookups',
                treeKey: TREE_KEY,
                recipeFilePath: recipeFilePath,
                wirings: SINGLE_CANDIDATE_WIRINGS,
                isWireAll: true
            });

        });

        it('refuses until the panel has confirmed drawing the model, and answers that nothing runs', () => {

            const panelState = buildActivePanelState();
            panelState.wireableLookupTargets = new Map();

            expect(RecipeCockpitService.routePanelMessage(WIRE_CONTACT_MESSAGE, panelState)).toEqual(NOTHING_RUNS);
            expect(RecipeCockpitService.routePanelMessage(WIRE_ALL_MESSAGE, panelState)).toEqual(NOTHING_RUNS);

        });

        it.each([
            ['a self-lookup', { objectApiName: 'Contact', fieldApiName: 'ReportsToId' }],
            ['a field that is not a lookup', { objectApiName: 'Contact', fieldApiName: 'LastName' }],
            ['an occurrence nickname the row does not draw', { objectNickname: 'Contact_NickName' }],
            ['another card', { treeKey: 'Lead-ONLY' }],
            ['a field that is not a string', { fieldApiName: ['AccountId'] }],
            ['a nickname that is not a string', { objectNickname: 7 }],
            ['no tree', { treeKey: undefined }]
        ])('refuses %s', (_description, override) => {

            expect(RecipeCockpitService.routePanelMessage({ ...WIRE_CONTACT_MESSAGE, ...override }, buildActivePanelState())).toEqual(NOTHING_RUNS);

        });

        it('refuses "Wire TODO lookups" for a card with no single-choice lookup', () => {

            const panelState = buildActivePanelState();
            panelState.wireableLookupTargets = new Map([...panelState.wireableLookupTargets].filter(([, target]) => target.wiring.candidateNicknames.length > 1));

            expect(RecipeCockpitService.routePanelMessage(WIRE_ALL_MESSAGE, panelState)).toEqual(NOTHING_RUNS);
            expect(RecipeCockpitService.routePanelMessage({ ...WIRE_ALL_MESSAGE, treeKey: 'Lead-ONLY' }, buildActivePanelState())).toEqual(NOTHING_RUNS);

        });

        it('admits one write at a time, waits for an Add friend in flight, and a reload replays the one in flight', () => {

            const panelState = buildActivePanelState();
            panelState.wireLookupStateMessage = { command: 'wireLookupState', isRunning: true };

            expect(RecipeCockpitService.routePanelMessage(WIRE_CONTACT_MESSAGE, panelState)).toBeUndefined();
            expect(RecipeCockpitService.buildReplayMessages(panelState).map(hostMessage => hostMessage.command)).toEqual(['recipeData', 'wireLookupState']);
            // A "+" WAITS FOR THE WIRING, WHICH WRITES THE SAME FILE
            expect(RecipeCockpitService.routePanelMessage({ command: 'addIterationFriend', treeKey: TREE_KEY, objectApiName: 'Account', objectNickname: 'X', friendObjectApiName: 'Contact' }, panelState))
                .toEqual({ kind: 'postAddFriendState', hostMessage: { command: 'addFriendState', isRunning: false } });

            panelState.wireLookupStateMessage = undefined;
            panelState.addFriendStateMessage = { command: 'addFriendState', isRunning: true };
            expect(RecipeCockpitService.routePanelMessage(WIRE_CONTACT_MESSAGE, panelState)).toEqual(NOTHING_RUNS);

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
        const fieldsOf = (recipeText: string, objectApiName: string) => (yaml.load(recipeText) as { object: string; fields: Record<string, unknown> }[])
            .find(loadedObject => loadedObject.object === objectApiName).fields;

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

        it('on confirmation writes the one nickname a lookup can name, then reloads with the card open on its Treecipe tab', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL);

            await openRenderedCockpit();
            await receivedMessageHandler(WIRE_CONTACT_MESSAGE);

            const writtenText = fs.readFileSync(recipeFilePath, 'utf-8');
            expect(writtenText).toBe(RECIPE_TEXT.replace(`    AccountId: ${TODO}\n    ReportsToId`, '    AccountId: Account_NickName\n    ReportsToId'));
            expect(fieldsOf(writtenText, 'Contact').AccountId).toBe('Account_NickName');
            expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0]).toEqual([
                'Wire Contact.AccountId to Account_NickName?',
                { modal: true, detail: expect.stringContaining(path.basename(recipeFilePath)) },
                RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL
            ]);
            expect(showInformationMessageSpy).toHaveBeenCalledWith(expect.stringContaining('Wired Contact.AccountId to Account_NickName'));
            expect(postedCommands().filter(command => ['wireLookupState', 'recipeData'].includes(command))).toEqual(['wireLookupState', 'recipeData', 'wireLookupState']);
            expect(postedPanelMessages.filter(hostMessage => hostMessage.command === 'wireLookupState').map(hostMessage => hostMessage.isRunning)).toEqual([true, false]);
            expect(postedPanelMessages.find(hostMessage => hostMessage.command === 'recipeData').focusTree).toEqual({ treeKey: TREE_KEY, tab: 'treecipe' });

            // THE WIRED LOOKUP IS NO LONGER OFFERED, AND THE FIELD ROW SHOWS ITS NICKNAME
            const reloadedModel = lastModel();
            expect(reloadedModel.trees[0].lookupWirings.map(wiring => `${wiring.objectApiName}.${wiring.fieldApiName}`)).toEqual(['Opportunity.AccountId', 'Case.ContactId', 'Case.Related__c']);
            const reloadedContactFields = reloadedModel.objects.find(objectViewModel => objectViewModel.objectApiName === 'Contact').fields;
            expect(reloadedContactFields.find(field => field.fieldApiName === 'AccountId').recipeValue).toBe('Account_NickName');
            expect(reloadedContactFields.find(field => field.fieldApiName === 'ReportsToId').recipeValue).toBe(TODO);

            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            expect(RecipeCockpitService.routePanelMessage(WIRE_CONTACT_MESSAGE, (RecipeCockpitService as any).recipeCockpitPanelState)).toEqual(NOTHING_RUNS);

        });

        it('asks which record a lookup with more than one points at, and writes the one chosen', async () => {

            (vscode.window.showQuickPick as jest.Mock).mockResolvedValue('Opportunity_NickName');
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL);

            await openRenderedCockpit();
            await receivedMessageHandler(WIRE_RELATED_MESSAGE);

            expect((vscode.window.showQuickPick as jest.Mock).mock.calls[0][0]).toEqual(['Account_NickName', 'Opportunity_NickName']);
            expect(fieldsOf(fs.readFileSync(recipeFilePath, 'utf-8'), 'Case').Related__c).toBe('Opportunity_NickName');

        });

        it('on a dismissed pick writes nothing and asks nothing more', async () => {

            (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

            await openRenderedCockpit();
            await receivedMessageHandler(WIRE_RELATED_MESSAGE);

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(RECIPE_TEXT);
            expect(postedPanelMessages).toEqual([{ command: 'wireLookupState', isRunning: true }, { command: 'wireLookupState', isRunning: false }]);

        });

        it('"Wire TODO lookups" writes every single-choice lookup in one write and leaves the rest', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL);

            await openRenderedCockpit();
            await receivedMessageHandler(WIRE_ALL_MESSAGE);

            const writtenText = fs.readFileSync(recipeFilePath, 'utf-8');
            const [title, options] = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0];

            expect(title).toBe('Wire 3 TODO lookups?');
            expect(options.detail).toContain('Contact.AccountId → Account_NickName\nOpportunity.AccountId → Account_NickName\nCase.ContactId → Contact_NickName');
            expect(options.detail).toContain('A lookup with more than one record to choose from is left as it is');
            expect(fieldsOf(writtenText, 'Contact').AccountId).toBe('Account_NickName');
            expect(fieldsOf(writtenText, 'Opportunity').AccountId).toBe('Account_NickName');
            expect(fieldsOf(writtenText, 'Case').ContactId).toBe('Contact_NickName');
            expect(fieldsOf(writtenText, 'Case').Related__c).toBeNull();
            expect(fieldsOf(writtenText, 'Contact').ReportsToId).toBeNull();
            expect(showInformationMessageSpy).toHaveBeenCalledWith(expect.stringContaining('Wired 3 lookups'));
            expect(lastModel().trees[0].lookupWirings.map(wiring => wiring.fieldApiName)).toEqual(['Related__c']);

        });

        it('on cancel writes nothing, reloads nothing and gives the buttons back', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            await openRenderedCockpit();
            await receivedMessageHandler(WIRE_ALL_MESSAGE);

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(RECIPE_TEXT);
            expect(postedPanelMessages).toEqual([{ command: 'wireLookupState', isRunning: true }, { command: 'wireLookupState', isRunning: false }]);
            expect(showInformationMessageSpy).not.toHaveBeenCalled();

        });

        it('given a lookup filled in by hand since the draw, says why and writes none of the batch', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL);

            await openRenderedCockpit();

            const editedText = RECIPE_TEXT.replace(`    ContactId: ${TODO}`, '    ContactId: 003000000000001');
            fs.writeFileSync(recipeFilePath, editedText);

            await receivedMessageHandler(WIRE_ALL_MESSAGE);

            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(editedText);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('Nothing was wired'));
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('Case.ContactId is no longer'));
            expect(postedCommands()).not.toContain('recipeData');

        });

        it('given the recipe file removed while the confirmation was open, writes nothing', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async () => {
                fs.rmSync(recipeFilePath);
                return RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL;
            });

            await openRenderedCockpit();
            await receivedMessageHandler(WIRE_CONTACT_MESSAGE);

            expect(fs.existsSync(recipeFilePath)).toBe(false);
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('so nothing was wired.'));
            expect(postedCommands()).toEqual(['wireLookupState', 'wireLookupState']);

        });

        it('given the recipe file gone since the draw, says so before asking anything', async () => {

            await openRenderedCockpit();
            fs.rmSync(recipeFilePath);

            await receivedMessageHandler(WIRE_RELATED_MESSAGE);

            expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('no longer exists in this workspace, so nothing was wired. Re-open'));
            expect(postedCommands()).toEqual(['wireLookupState', 'wireLookupState']);

        });

        // THE RUN'S ONLY TREE BECOMES THIS ONE, IN THE FOLDER ITS OBJECTS NAME -- WHICH IS ITS CARD'S KEY
        const replaceRun = (wrapper: { ObjectToObjectInfoMap: object; RecipeFiles: { objects: string[] }[] }, recipeText: string): string => {
            const runFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', RUN_FOLDER_NAME);
            const treeKey = RelationshipService.buildRecipeTreeFolderName(wrapper.RecipeFiles[0].objects);
            fs.rmSync(path.join(runFolderPath, TREE_KEY), { recursive: true });
            fs.mkdirSync(path.join(runFolderPath, treeKey));
            recipeFilePath = path.join(runFolderPath, treeKey, `recipe--${treeKey}-2026-10-01T00-00-00.yml`);
            fs.writeFileSync(path.join(runFolderPath, 'treecipeObjectsWrapper-2026-10-01T00-00-00.json'), JSON.stringify(wrapper));
            fs.writeFileSync(recipeFilePath, recipeText);
            return treeKey;
        };

        const SELF_LOOKUP_RECIPE = [
            '- object: Account',
            '  nickname: Account_NickName',
            '  count: 1',
            '  fields:',
            '    Name: ${{ faker.company.name() }}',
            `    ParentId: ${TODO} -- Account`,
            '  friends:',
            '    - object: Account',
            '      nickname: Account_child_NickName',
            '      count: 1',
            '      fields:',
            '        Name: ${{ faker.company.name() }}',
            `        ParentId: ${TODO}`,
            ''
        ].join('\n');

        const SELF_LOOKUP_WRAPPER = {
            ObjectToObjectInfoMap: {
                Account: {
                    Fields: [buildWrapperField('Account', 'Name', 'Text'), buildWrapperField('Account', 'ParentId', 'Lookup')],
                    RelationshipDetail: { level: 0, parentObjectToFieldReferences: { Account: ['ParentId'] } }
                }
            },
            RecipeFiles: [{ objects: ['Account'] }]
        };

        it.each([
            ['"Wire to…"', { command: 'wireLookup', objectApiName: 'Account', objectNickname: 'Account_child_NickName', fieldApiName: 'ParentId' }],
            ['"Wire TODO lookups"', { command: 'wireAllLookups' }]
        ])('%s on a self-lookup iteration names the occurrence, and wires only it to the Account above', async (_label, wireMessage) => {

            const treeKey = replaceRun(SELF_LOOKUP_WRAPPER, SELF_LOOKUP_RECIPE);
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL);

            await openRenderedCockpit();
            await receivedMessageHandler({ ...wireMessage, treeKey: treeKey });

            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0]).toBe('Wire Account (Account_child_NickName).ParentId to Account_NickName?');
            // THE TOP ACCOUNT'S ParentId NAMES NO RECORD INSERTED BEFORE IT, SO IT STAYS THE TODO
            expect(fs.readFileSync(recipeFilePath, 'utf-8')).toBe(SELF_LOOKUP_RECIPE.replace(`        ParentId: ${TODO}`, '        ParentId: Account_NickName'));
            expect(lastModel().trees[0]).not.toHaveProperty('lookupWirings');

        });

        it('"Wire TODO lookups" names the first 12 lookups in its confirmation and counts the rest', async () => {

            const childObjectApiNames = Array.from({ length: 13 }, (_unused, childIndex) => `Child${childIndex + 1}__c`);
            const objectInfoMap: Record<string, object> = {
                Account: { Fields: [buildWrapperField('Account', 'Name', 'Text')], RelationshipDetail: { level: 0, parentObjectToFieldReferences: {} } }
            };
            childObjectApiNames.forEach(childObjectApiName => {
                objectInfoMap[childObjectApiName] = {
                    Fields: [buildWrapperField(childObjectApiName, 'Account__c', 'Lookup')],
                    RelationshipDetail: { level: 1, parentObjectToFieldReferences: { Account: ['Account__c'] } }
                };
            });
            const treeKey = replaceRun(
                { ObjectToObjectInfoMap: objectInfoMap, RecipeFiles: [{ objects: ['Account', ...childObjectApiNames] }] },
                [
                    '- object: Account', '  nickname: Account_NickName', '  fields:', '    Name: Acme', '',
                    ...childObjectApiNames.flatMap(childObjectApiName => [`- object: ${childObjectApiName}`, `  nickname: ${childObjectApiName}_NickName`, '  fields:', `    Account__c: ${TODO}`, ''])
                ].join('\n')
            );
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_WIRE_LOOKUP_CONFIRM_LABEL);

            await openRenderedCockpit();
            await receivedMessageHandler({ command: 'wireAllLookups', treeKey: treeKey });

            const [title, options] = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0];
            expect(title).toBe('Wire 13 TODO lookups?');
            expect(options.detail).toContain('Child12__c.Account__c → Account_NickName\n…and 1 more');
            expect(options.detail).not.toContain('Child13__c.Account__c');
            expect(fs.readFileSync(recipeFilePath, 'utf-8')).not.toContain(TODO);

        });

        it('answers a refused message with the buttons back, and asks nothing', async () => {

            await openRenderedCockpit();
            await receivedMessageHandler({ ...WIRE_CONTACT_MESSAGE, fieldApiName: 'ReportsToId' });

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
            expect(postedPanelMessages).toEqual([{ command: 'wireLookupState', isRunning: false }]);

        });

    });

    describe('the panel script', () => {

        const renderModel = () => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadModel(), renderSequence: 1 });
            panel.expandAllTrees();
            panel.objectElements().forEach((objectElement: any) => panel.expandObject(objectElement));
            return panel;
        };

        const wireButtonsOf = (panel: any) => panel.findAll(panel.cockpitBodyElement, 'treeWireLookup');
        const wireButtonFieldLabels = (panel: any) => wireButtonsOf(panel).map((buttonElement: any) => buttonElement.attributes['aria-label']);

        it('draws "Wire to…" on each TODO lookup with a parent inserted first, and on no other row', () => {

            const panel = renderModel();

            expect(wireButtonFieldLabels(panel)).toEqual(['Wire Contact.AccountId', 'Wire Opportunity.AccountId', 'Wire Case.ContactId', 'Wire Case.Related__c']);
            expect(panel.findAll(panel.fieldRowNamed(panel.objectElements()[1], 'AccountId'), 'treeWireLookup')).toHaveLength(1);
            expect(panel.findAll(panel.fieldRowNamed(panel.objectElements()[1], 'ReportsToId'), 'treeWireLookup')).toHaveLength(0);

        });

        it('draws "Wire TODO lookups" with the count of single-choice lookups', () => {

            const panel = renderModel();

            expect(panel.findAll(panel.cockpitBodyElement, 'treeWireAllLookups').map((buttonElement: any) => buttonElement.textContent)).toEqual(['Wire TODO lookups (3)']);

        });

        it('posts names only, disables every wire button until the host answers, and posts nothing on a second click', () => {

            const panel = renderModel();
            const everyWireButton = () => [...wireButtonsOf(panel), ...panel.findAll(panel.cockpitBodyElement, 'treeWireAllLookups')];
            const postedWires = () => panel.postedHostMessages.filter((hostMessage: any) => ['wireLookup', 'wireAllLookups'].includes(hostMessage.command));

            wireButtonsOf(panel)[0].dispatch('click');
            wireButtonsOf(panel)[0].dispatch('click');
            panel.findAll(panel.cockpitBodyElement, 'treeWireAllLookups')[0].dispatch('click');

            expect(postedWires()).toEqual([WIRE_CONTACT_MESSAGE]);
            expect(everyWireButton().every((buttonElement: any) => buttonElement.disabled)).toBe(true);

            panel.postToPanel({ command: 'wireLookupState', isRunning: false });

            expect(everyWireButton().some((buttonElement: any) => buttonElement.disabled)).toBe(false);

            panel.findAll(panel.cockpitBodyElement, 'treeWireAllLookups')[0].dispatch('click');
            expect(postedWires()).toEqual([WIRE_CONTACT_MESSAGE, WIRE_ALL_MESSAGE]);

        });

        it('names the occurrence when the object is written twice', () => {

            const recipeViewModel = loadModel();
            recipeViewModel.trees[0].lookupWirings = [{ objectApiName: 'Account', objectNickname: 'Account_child_NickName', fieldApiName: 'ParentId', candidateNicknames: ['Account_NickName'] }];
            recipeViewModel.trees[0].objects.push({ objectApiName: 'Account', parentLookups: [], iterationNickname: 'Account_child_NickName' });
            const accountObject = recipeViewModel.objects.find(objectViewModel => objectViewModel.objectApiName === 'Account');
            accountObject.nickname = 'Account_NickName';
            accountObject.iterations = [{ nickname: 'Account_child_NickName', lineNumber: 40, parentObjectApiName: 'Account', parentNickname: 'Account_NickName', fields: [{ fieldApiName: 'ParentId', lineNumber: 43, recipeValue: TODO }] }];

            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipeViewModel, renderSequence: 1 });
            panel.expandAllTrees();
            panel.objectElements().forEach((objectElement: any) => panel.expandObject(objectElement));

            // THE TOP ACCOUNT'S ParentId HAS NO WIRING; THE ITERATION'S DOES
            expect(wireButtonFieldLabels(panel)).toEqual(['Wire Account (Account_child_NickName).ParentId']);

            wireButtonsOf(panel)[0].dispatch('click');

            expect(panel.postedHostMessages.filter((hostMessage: any) => hostMessage.command === 'wireLookup')).toEqual([
                { command: 'wireLookup', treeKey: TREE_KEY, objectApiName: 'Account', fieldApiName: 'ParentId', objectNickname: 'Account_child_NickName' }
            ]);

        });

        it('draws a model the host posts while a wiring is in flight with its buttons already disabled', () => {

            const panel = runPanelScript();
            panel.postToPanel({ command: 'wireLookupState', isRunning: true });
            panel.postToPanel({ command: 'recipeData', recipe: loadModel(), renderSequence: 1 });
            panel.expandAllTrees();
            panel.objectElements().forEach((objectElement: any) => panel.expandObject(objectElement));

            expect(wireButtonsOf(panel).map((buttonElement: any) => buttonElement.disabled)).toEqual([true, true, true, true]);
            expect(panel.findAll(panel.cockpitBodyElement, 'treeWireAllLookups')[0].disabled).toBe(true);

        });

    });

});
