import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
    workspace: {
        workspaceFolders: undefined,
        getConfiguration: jest.fn().mockReturnValue({ get: jest.fn(), update: jest.fn(), inspect: jest.fn() }),
        fs: { readDirectory: jest.fn(), readFile: jest.fn() }
    },
    env: { openExternal: jest.fn() },
    window: {
        createWebviewPanel: jest.fn(),
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
    IRecipeCockpitFieldViewModel,
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    RecipeCockpitService,
    RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_GONE_PREFIX,
    RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_LIST_LINK_LABEL,
    RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_TITLE_PREFIX
} from '../RecipeCockpitService';
import { RecipeCockpitValidationRuleList, VALIDATION_RULE_LIST_MAX_FILE_BYTES } from '../RecipeCockpitValidationRuleList';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    #560: a field a validation rule names, and each row of the Validation Rules list, links to the
    rule's .validationRule-meta.xml. The panel posts names; the host finds the file, at load and again
    at the click, only inside the workspace and never through a link.
*/

const VALIDATION_RULE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'validationRuleWorkspace');
const OBJECTS_FIXTURE_PATH = path.join(__dirname, '..', '..', 'DirectoryProcessingService', 'tests', 'mocks', 'ValidationRuleSalesforceMetadataDirectory', 'objects');
const FAKERJS_RUN_FOLDER_NAME = 'recipe-fakerjs-2026-10-01T09-00-00';
const SNOWFAKERY_RUN_FOLDER_NAME = 'recipe-2026-10-01T08-00-00';
const GADGET_TREE_KEY = 'Gadget__c-thru-Widget__c';
const OBJECTS_RELATIVE_PATH = 'force-app/main/default/objects';
const AMOUNT_RULES = ['Require_Amount_Maximum', 'Require_Amount_Minimum'];

const ruleKey = (objectApiName: string, ruleName: string) => RecipeCockpitValidationRuleList.buildRuleSourceKey(objectApiName, ruleName);
const fieldOf = (recipe: IRecipeCockpitRecipeViewModel, objectApiName: string, fieldApiName: string) =>
    recipe.objects.find(object => object.objectApiName === objectApiName)?.fields.find(field => field.fieldApiName === fieldApiName) as IRecipeCockpitFieldViewModel;

describe('RecipeCockpitValidationRuleList.resolveRuleSourceFilePaths (#560)', () => {

    let temporaryRoot: string;
    let workspaceRoot: string;
    let objectsPath: string;
    let gadgetRulesPath: string;

    beforeEach(() => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-validation-rule-source-'));
        workspaceRoot = path.join(temporaryRoot, 'workspace');
        objectsPath = path.join(workspaceRoot, OBJECTS_RELATIVE_PATH);
        gadgetRulesPath = path.join(objectsPath, 'Gadget__c', 'validationRules');
        fs.cpSync(OBJECTS_FIXTURE_PATH, objectsPath, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    });

    const resolve = (ruleNamesByObject: Record<string, string[]>, root = workspaceRoot, objects = objectsPath) =>
        RecipeCockpitValidationRuleList.resolveRuleSourceFilePaths(objects, root, new Map(Object.entries(ruleNamesByObject)));

    it('finds each named rule\'s file by its file name, and nothing for a rule, object or folder the project lacks', () => {

        const sourceFilePaths = resolve({ Gadget__c: [...AMOUNT_RULES, 'Not_A_Rule'], Widget__c: ['Anything'], Missing__c: ['Score_High'] });

        expect([...sourceFilePaths.entries()]).toEqual(AMOUNT_RULES.map(ruleName => [ruleKey('Gadget__c', ruleName), path.join(gadgetRulesPath, `${ruleName}.validationRule-meta.xml`)]));

    });

    it('matches a file by the <fullName> generation recorded, not its file name', () => {

        fs.renameSync(path.join(gadgetRulesPath, 'Score_High.validationRule-meta.xml'), path.join(gadgetRulesPath, 'Renamed.validationRule-meta.xml'));

        const sourceFilePaths = resolve({ Gadget__c: ['Score_High', 'Renamed'] });

        expect([...sourceFilePaths.entries()]).toEqual([[ruleKey('Gadget__c', 'Score_High'), path.join(gadgetRulesPath, 'Renamed.validationRule-meta.xml')]]);

    });

    it('takes the file named after the rule over another file claiming it, and links neither of two other files claiming it', () => {

        const scoreHighPath = path.join(gadgetRulesPath, 'Score_High.validationRule-meta.xml');
        fs.copyFileSync(scoreHighPath, path.join(gadgetRulesPath, 'Score_High_Copy.validationRule-meta.xml'));
        expect(resolve({ Gadget__c: ['Score_High'] }).get(ruleKey('Gadget__c', 'Score_High'))).toBe(scoreHighPath);

        fs.renameSync(scoreHighPath, path.join(gadgetRulesPath, 'Score_High_Other.validationRule-meta.xml'));
        expect(resolve({ Gadget__c: ['Score_High', 'Score_Low'] }).has(ruleKey('Gadget__c', 'Score_High'))).toBeFalse();
        expect(resolve({ Gadget__c: ['Score_High', 'Score_Low'] }).has(ruleKey('Gadget__c', 'Score_Low'))).toBeTrue();

    });

    it('reads only the named rules\' own files when each is recorded under its file name', () => {

        const readSpy = jest.spyOn(RecipeCockpitValidationRuleList, 'readRuleFileText');

        expect(resolve({ Gadget__c: AMOUNT_RULES }).size).toBe(2);
        expect(readSpy.mock.calls.map(readCall => path.basename(readCall[0])).sort()).toEqual(AMOUNT_RULES.map(ruleName => `${ruleName}.validationRule-meta.xml`));

    });

    it('reads <fullName> as generation does: a CDATA name is the rule it names, so its own file is not taken for it', () => {

        fs.writeFileSync(path.join(gadgetRulesPath, 'Score_High.validationRule-meta.xml'), '<ValidationRule><fullName><![CDATA[Score_Low]]></fullName></ValidationRule>');

        const sourceFilePaths = resolve({ Gadget__c: ['Score_High', 'Score_Low'] });

        expect(sourceFilePaths.has(ruleKey('Gadget__c', 'Score_High'))).toBeFalse();
        expect(sourceFilePaths.get(ruleKey('Gadget__c', 'Score_Low'))).toBe(path.join(gadgetRulesPath, 'Score_Low.validationRule-meta.xml'));
        expect(RecipeCockpitValidationRuleList.readRecordedRuleName(path.join(gadgetRulesPath, 'Score_High.validationRule-meta.xml'), 'Score_High')).toBe('Score_Low');

    });

    it('follows no link: a linked rule file, or a linked validationRules folder, is not a source', () => {

        const codeFormatPath = path.join(gadgetRulesPath, 'Code_Format.validationRule-meta.xml');
        const outsidePath = path.join(temporaryRoot, 'Code_Format.validationRule-meta.xml');
        fs.renameSync(codeFormatPath, outsidePath);
        fs.symlinkSync(outsidePath, codeFormatPath);

        expect(resolve({ Gadget__c: ['Code_Format', 'Score_High'] }).has(ruleKey('Gadget__c', 'Code_Format'))).toBeFalse();
        expect(resolve({ Gadget__c: ['Code_Format', 'Score_High'] }).has(ruleKey('Gadget__c', 'Score_High'))).toBeTrue();

        const realRulesPath = path.join(temporaryRoot, 'realRules');
        fs.renameSync(gadgetRulesPath, realRulesPath);
        fs.symlinkSync(realRulesPath, gadgetRulesPath);

        expect(resolve({ Gadget__c: ['Score_High'] }).size).toBe(0);

    });

    it('keeps nothing outside the workspace, and looks for no name that is not an api name', () => {

        expect(resolve({ Gadget__c: ['Score_High'] }, path.join(temporaryRoot, 'otherWorkspace')).size).toBe(0);
        expect(resolve({ Gadget__c: ['Score High', '../Score_High', ''], 'Gadget__c/..': ['Score_High'] }).size).toBe(0);

    });

    it('links no file whose text cannot be read, and records a file that does not parse, or names two <fullName>s, under its file name', () => {

        const scoreHighPath = path.join(gadgetRulesPath, 'Score_High.validationRule-meta.xml');
        jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => { throw new Error('EACCES'); });
        expect(RecipeCockpitValidationRuleList.readRecordedRuleName(scoreHighPath, 'Score_High')).toBeUndefined();

        fs.writeFileSync(scoreHighPath, 'x'.repeat(VALIDATION_RULE_LIST_MAX_FILE_BYTES + 1));
        fs.writeFileSync(path.join(gadgetRulesPath, 'Score_Low.validationRule-meta.xml'), '<ValidationRule><fullName>Score_Low</fullName><fullName>Other</fullName></ValidationRule>');
        fs.writeFileSync(path.join(gadgetRulesPath, 'Code_Format.validationRule-meta.xml'), '<ValidationRule><fullName>Code_Format');

        const sourceFilePaths = resolve({ Gadget__c: ['Score_High', 'Score_Low', 'Other', 'Code_Format'] });

        expect([...sourceFilePaths.keys()].sort()).toEqual([ruleKey('Gadget__c', 'Code_Format'), ruleKey('Gadget__c', 'Score_Low')]);

    });

    it('opens a rule at its formula line, else its first', () => {

        expect(RecipeCockpitValidationRuleList.findFormulaLineNumber('<a>\r\n  <b/>\n  <errorConditionFormula>X</errorConditionFormula>')).toBe(3);
        expect(RecipeCockpitValidationRuleList.findFormulaLineNumber('<ValidationRule/>')).toBe(1);

    });

});

describe('RecipeCockpitService, a validation rule\'s file (#560)', () => {

    describe('routePanelMessage', () => {

        it('routes an open only for a rule a drawn row named, and reads nothing but its names', () => {

            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.openableValidationRuleKeys = new Set([ruleKey('Gadget__c', 'Score_High')]);

            expect(RecipeCockpitService.routePanelMessage({ command: 'openValidationRuleSource', objectApiName: 'Gadget__c', ruleName: 'Score_High', filePath: '/etc/passwd' } as any, panelState))
                .toEqual({ kind: 'openValidationRuleSource', objectApiName: 'Gadget__c', ruleName: 'Score_High' });
            expect(RecipeCockpitService.routePanelMessage({ command: 'openValidationRuleSource', objectApiName: 'Gadget__c', ruleName: 'Score_Low' } as any, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'openValidationRuleSource', objectApiName: 'Widget__c', ruleName: 'Score_High' } as any, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'openValidationRuleSource', objectApiName: 'Gadget__c', ruleName: 7 } as any, panelState)).toBeUndefined();

        });

        it('activates a list\'s links only for the acknowledged model it was read for', () => {

            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.pendingValidationRuleListKeys.set(GADGET_TREE_KEY, { renderSequence: 3, listSequence: 5, ruleKeys: [ruleKey('Gadget__c', 'Inactive_Rule')] });
            const ack = (overrides: Record<string, unknown> = {}) => RecipeCockpitService.routePanelMessage({ command: 'validationRulesRendered', treeKey: GADGET_TREE_KEY, renderSequence: 3, listSequence: 5, ...overrides } as any, panelState);

            expect(ack()).toBeUndefined();

            panelState.acknowledgedRenderSequence = 3;
            expect(ack()).toEqual({ kind: 'activateValidationRuleList', treeKey: GADGET_TREE_KEY });
            expect(ack({ renderSequence: 2 })).toBeUndefined();
            expect(ack({ treeKey: 'Other' })).toBeUndefined();
            // THE ACK OF A LIST A RETRIEVE HAS SINCE REPLACED
            expect(ack({ listSequence: 4 })).toBeUndefined();
            expect(ack({ listSequence: undefined })).toBeUndefined();

            panelState.acknowledgedRenderSequence = 4;
            expect(ack()).toBeUndefined();

        });

    });

    describe('the host', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let openFileInEditorSpy: jest.SpyInstance;
        let warningSpy: jest.SpyInstance;

        const lastRecipeData = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData');
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
        const gadgetRulePath = (ruleFileName: string) => path.join(workspaceRoot, OBJECTS_RELATIVE_PATH, 'Gadget__c', 'validationRules', `${ruleFileName}.validationRule-meta.xml`);

        const openCockpit = async (isRendered = true) => {
            const storedWorkspaceState = new Map<string, unknown>();
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, {
                get: jest.fn().mockImplementation((stateKey: string) => storedWorkspaceState.get(stateKey)),
                update: jest.fn().mockImplementation(async (stateKey: string, stateValue: unknown) => { storedWorkspaceState.set(stateKey, stateValue); })
            } as any);
            await receivedMessageHandler({ command: 'ready' });
            if ( isRendered ) {
                await receivedMessageHandler({ command: 'rendered', renderSequence: lastRecipeData()?.renderSequence });
            }
        };

        const clickRule = async (objectApiName: string, ruleName: string) => {
            await receivedMessageHandler({ command: 'openValidationRuleSource', objectApiName: objectApiName, ruleName: ruleName });
            await flushAsyncWork();
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-validation-rule-source-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(VALIDATION_RULE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.cpSync(OBJECTS_FIXTURE_PATH, path.join(workspaceRoot, OBJECTS_RELATIVE_PATH), { recursive: true });

            RecipeCockpitService.clearTreeValidationRuleLists();
            postedPanelMessages = [];

            (vscode.window.createWebviewPanel as jest.Mock).mockImplementation(() => ({
                reveal: jest.fn(),
                onDidDispose: jest.fn(),
                webview: {
                    html: '',
                    postMessage: jest.fn().mockImplementation((hostMessage: any) => { postedPanelMessages.push(hostMessage); return Promise.resolve(true); }),
                    onDidReceiveMessage: jest.fn().mockImplementation((messageHandler: any) => {
                        receivedMessageHandler = messageHandler;
                        return { dispose: jest.fn() };
                    })
                }
            }));

            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation(() => ({ text: '', dispose: jest.fn() }) as any);
            jest.spyOn(ConfigurationService, 'getObjectsPathFromTreecipeJSONConfiguration').mockReturnValue(OBJECTS_RELATIVE_PATH);
            openFileInEditorSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            warningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined as any);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it.each([FAKERJS_RUN_FOLDER_NAME, SNOWFAKERY_RUN_FOLDER_NAME])('names on each rule-constrained field the rules whose file the project holds, applied or not (%s)', (runFolderName) => {

            const recipe = RecipeCockpitService.loadRecipeRunByRuns(
                RecipeCockpitService.findGeneratedRecipeRuns(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes')), workspaceRoot, runFolderName
            ).recipeViewModel;

            expect(fieldOf(recipe, 'Gadget__c', 'Amount__c').validationRules?.sourceRuleNames).toEqual(AMOUNT_RULES);
            expect(fieldOf(recipe, 'Gadget__c', 'Score__c').validationRules?.sourceRuleNames).toEqual(['Score_High', 'Score_Low']);
            expect(fieldOf(recipe, 'Gadget__c', 'Region__c')?.validationRules).toBeUndefined();

        });

        it('posts the model it did when the project holds no rule file, and reads no configuration for a run without rules', () => {

            fs.rmSync(path.join(workspaceRoot, OBJECTS_RELATIVE_PATH), { recursive: true, force: true });
            const recipe = RecipeCockpitService.loadRecipeRunByRuns(
                RecipeCockpitService.findGeneratedRecipeRuns(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes')), workspaceRoot, FAKERJS_RUN_FOLDER_NAME
            ).recipeViewModel;

            expect(JSON.stringify(recipe)).not.toContain('sourceRuleNames');

            const configurationSpy = ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration as jest.Mock;
            configurationSpy.mockClear();
            RecipeCockpitService.attachValidationRuleSources([{ objectApiName: 'Account', recipeFilePath: '', fields: [fieldOf(recipe, 'Gadget__c', 'Region__c')] }], workspaceRoot);
            expect(configurationSpy).not.toHaveBeenCalled();

        });

        it('opens a field\'s rule only once its model is on screen, at the rule\'s formula line', async () => {

            await openCockpit(false);
            await clickRule('Gadget__c', 'Require_Amount_Maximum');
            expect(openFileInEditorSpy).not.toHaveBeenCalled();

            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRecipeData()?.renderSequence });
            await clickRule('Gadget__c', 'Require_Amount_Maximum');

            const formulaLine = fs.readFileSync(gadgetRulePath('Require_Amount_Maximum'), 'utf-8').split('\n').findIndex(ruleLine => ruleLine.includes('<errorConditionFormula>')) + 1;
            expect(openFileInEditorSpy).toHaveBeenCalledWith(gadgetRulePath('Require_Amount_Maximum'), formulaLine);
            expect(formulaLine).toBeGreaterThan(1);

            // A RELOADED DOCUMENT HAS NOTHING ON SCREEN
            openFileInEditorSpy.mockClear();
            await receivedMessageHandler({ command: 'ready' });
            await clickRule('Gadget__c', 'Require_Amount_Maximum');
            expect(openFileInEditorSpy).not.toHaveBeenCalled();

        });

        it('finds the file again at the click: one gone, or replaced by a link, is a warning and opens nothing', async () => {

            await openCockpit();

            fs.rmSync(gadgetRulePath('Require_Amount_Maximum'));
            await clickRule('Gadget__c', 'Require_Amount_Maximum');

            const outsidePath = path.join(temporaryRoot, 'Code_Format.validationRule-meta.xml');
            fs.renameSync(gadgetRulePath('Code_Format'), outsidePath);
            fs.symlinkSync(outsidePath, gadgetRulePath('Code_Format'));
            await clickRule('Gadget__c', 'Code_Format');

            expect(openFileInEditorSpy).not.toHaveBeenCalled();
            expect(warningSpy).toHaveBeenCalledTimes(2);
            expect(warningSpy.mock.calls[0][0]).toStartWith(`${RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_GONE_PREFIX} Gadget__c.Require_Amount_Maximum.`);
            expect(warningSpy.mock.calls.flat().join(' ')).not.toContain(temporaryRoot);

        });

        it('opens a Validation Rules list row\'s rule, an inactive one included, only once the panel drew the list', async () => {

            await openCockpit();
            const renderSequence = lastRecipeData()?.renderSequence;
            const recordedNameSpy = jest.spyOn(RecipeCockpitValidationRuleList, 'readRecordedRuleName');

            await receivedMessageHandler({ command: 'loadValidationRules', treeKey: GADGET_TREE_KEY, renderSequence: renderSequence });
            await flushAsyncWork();

            // THE LIST'S LINKS COME FROM ITS OWN READ: NO RULE FILE IS READ A SECOND TIME FOR THEM
            expect(recordedNameSpy).not.toHaveBeenCalled();

            const rulesMessage = postedPanelMessages.filter(hostMessage => hostMessage.command === 'treeValidationRules').at(-1);
            expect(rulesMessage.openableRules).toContainEqual({ objectApiName: 'Gadget__c', ruleName: 'Inactive_Rule' });
            expect(rulesMessage.openableRules).toContainEqual({ objectApiName: 'Gadget__c', ruleName: 'Complex_Formula' });
            expect(rulesMessage.listSequence).toEqual(expect.any(Number));
            expect(JSON.stringify(rulesMessage)).not.toContain(workspaceRoot);

            await clickRule('Gadget__c', 'Inactive_Rule');
            expect(openFileInEditorSpy).not.toHaveBeenCalled();

            await receivedMessageHandler({ command: 'validationRulesRendered', treeKey: GADGET_TREE_KEY, renderSequence: renderSequence, listSequence: rulesMessage.listSequence });
            await clickRule('Gadget__c', 'Inactive_Rule');
            expect(openFileInEditorSpy).toHaveBeenCalledWith(gadgetRulePath('Inactive_Rule'), expect.any(Number));
            expect(panelState().pendingValidationRuleListKeys.has(GADGET_TREE_KEY)).toBeFalse();

        });

        it('lets the ack of a list a retrieve replaced activate nothing, and empties the lists on a failure to draw and a new model', async () => {

            await openCockpit();
            const renderSequence = lastRecipeData()?.renderSequence;
            const lastList = () => postedPanelMessages.filter(hostMessage => hostMessage.command === 'treeValidationRules').at(-1);

            await receivedMessageHandler({ command: 'loadValidationRules', treeKey: GADGET_TREE_KEY, renderSequence: renderSequence });
            await flushAsyncWork();
            const firstList = lastList();

            await (RecipeCockpitService as any).refreshTreeValidationRules(GADGET_TREE_KEY);
            await flushAsyncWork();
            expect(lastList().listSequence).toBeGreaterThan(firstList.listSequence);

            await receivedMessageHandler({ command: 'validationRulesRendered', treeKey: GADGET_TREE_KEY, renderSequence: renderSequence, listSequence: firstList.listSequence });
            expect(panelState().openableValidationRuleKeys.has(ruleKey('Gadget__c', 'Inactive_Rule'))).toBeFalse();

            await receivedMessageHandler({ command: 'validationRulesRendered', treeKey: GADGET_TREE_KEY, renderSequence: renderSequence, listSequence: lastList().listSequence });
            expect(panelState().openableValidationRuleKeys.has(ruleKey('Gadget__c', 'Inactive_Rule'))).toBeTrue();

            ( vscode.window.showErrorMessage as jest.Mock ).mockResolvedValue(undefined);
            await receivedMessageHandler({ command: 'renderFailed', phase: 'render', message: 'boom', stack: '' });
            expect(panelState().openableValidationRuleKeys.size).toBe(0);

            await receivedMessageHandler({ command: 'loadValidationRules', treeKey: GADGET_TREE_KEY, renderSequence: renderSequence });
            await flushAsyncWork();
            expect(panelState().pendingValidationRuleListKeys.size).toBe(0);

            (RecipeCockpitService as any).renderRecipeModel((RecipeCockpitService as any).recipeCockpitPanel, RecipeCockpitService.loadRecipeRunByRuns(
                RecipeCockpitService.findGeneratedRecipeRuns(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes')), workspaceRoot, FAKERJS_RUN_FOLDER_NAME
            ));
            expect(panelState().openableValidationRuleKeys.size).toBe(0);
            expect(panelState().pendingOpenableValidationRuleKeys.has(ruleKey('Gadget__c', 'Require_Amount_Maximum'))).toBeTrue();

        });

    });

    describe('the panel script', () => {

        type Panel = ReturnType<typeof runPanelScript>;

        const loadRecipe = (): IRecipeCockpitRecipeViewModel => {
            const recipe = RecipeCockpitService.loadRecipeRunByRuns(
                RecipeCockpitService.findGeneratedRecipeRuns(path.join(VALIDATION_RULE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes')),
                VALIDATION_RULE_WORKSPACE_ROOT,
                FAKERJS_RUN_FOLDER_NAME
            ).recipeViewModel;
            ( fieldOf(recipe, 'Gadget__c', 'Amount__c').validationRules as any ).sourceRuleNames = AMOUNT_RULES;
            ( fieldOf(recipe, 'Gadget__c', 'Score__c').validationRules as any ).sourceRuleNames = ['Score_Low'];
            return recipe;
        };

        const drawRecipe = (): Panel => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 3 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            return panel;
        };

        const gadgetOf = (panel: Panel) => {
            const gadgetElement = panel.objectElements().find(objectElement => panel.objectNameOf(objectElement) === 'Gadget__c');
            panel.expandObject(gadgetElement);
            return gadgetElement;
        };
        const linksOf = (panel: Panel, root: any, className: string) => panel.findAll(root, className);

        it('draws one link per rule with a file after the rules box or note, naming the rule, posting names only', () => {

            const panel = drawRecipe();
            const gadget = gadgetOf(panel);

            const amountLinks = linksOf(panel, panel.fieldRowNamed(gadget, 'Amount__c'), 'treeFieldRuleSource');
            expect(amountLinks.map((link: any) => link.textContent)).toEqual(AMOUNT_RULES.map(ruleName => `↗ ${ruleName}`));
            expect(amountLinks.every((link: any) => link.tagName === 'button' && link.classList.contains('sdtButton-link'))).toBeTrue();
            expect(amountLinks[0].attributes.title).toBe(`${RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_TITLE_PREFIX} Gadget__c.Require_Amount_Maximum`);
            expect(amountLinks[0].attributes['aria-label']).toBe(amountLinks[0].attributes.title);

            const header = panel.findAll(panel.fieldRowNamed(gadget, 'Amount__c'), 'treeFieldHeader')[0];
            const controlIndex = header.children.findIndex((child: any) => child.classList.contains('validationRuleControl'));
            expect(header.children.indexOf(amountLinks[0])).toBeGreaterThan(controlIndex);

            // A RULE NOT APPLIED LINKS TOO; ONE WITH NO FILE, AND A FIELD NO RULE NAMES, DO NOT
            expect(linksOf(panel, panel.fieldRowNamed(gadget, 'Score__c'), 'treeFieldRuleSource').map((link: any) => link.textContent)).toEqual(['↗ Score_Low']);
            expect(linksOf(panel, panel.fieldRowNamed(gadget, 'Region__c'), 'treeFieldRuleSource')).toEqual([]);
            expect(linksOf(panel, panel.fieldRowNamed(gadget, 'Code__c'), 'treeFieldRuleSource')).toEqual([]);

            amountLinks[1].dispatch('click');
            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'openValidationRuleSource', objectApiName: 'Gadget__c', ruleName: 'Require_Amount_Minimum' });

        });

        it('links a list row whose rule the host found a file for, and says the list is drawn only when one does', () => {

            const panel = drawRecipe();
            const gadgetCard = panel.treeCards()[0];
            panel.openTab(gadgetCard, 'Troubleshooting');
            panel.findAll(gadgetCard, 'troubleshootingSubTab').find((tabElement: any) => tabElement.textContent === 'Validation Rules').dispatch('click');

            const rules = [
                { ruleName: 'Score_High', status: 'applied', isActive: true, fieldApiNames: ['Score__c'], reasons: [] },
                { ruleName: 'Inactive_Rule', status: 'inactive', isActive: false, fieldApiNames: [], reasons: [] },
                { ruleName: 'Code_Format', status: 'applied', fieldApiNames: ['Code__c'], reasons: [], isFileMissing: true }
            ];
            panel.postToPanel({
                command: 'treeValidationRules', renderSequence: 3, treeKey: GADGET_TREE_KEY,
                objects: [{ objectApiName: 'Gadget__c', rules: rules }],
                openableRules: [{ objectApiName: 'Gadget__c', ruleName: 'Inactive_Rule' }, { objectApiName: 'Gadget__c', ruleName: 'Code_Format' }],
                listSequence: 9
            });

            const subPanel = panel.findAll(gadgetCard, 'troubleshootingSubPanel-validationRules')[0];
            panel.findAll(subPanel, 'validationRuleToggle').forEach((toggle: any) => { if ( toggle.attributes['aria-expanded'] === 'false' ) { toggle.dispatch('click'); } });

            const listLinks = linksOf(panel, subPanel, 'validationRuleSource');
            expect(listLinks.map((link: any) => link.textContent)).toEqual([RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_LIST_LINK_LABEL]);
            expect(listLinks[0].attributes.title).toBe(`${RECIPE_COCKPIT_VALIDATION_RULE_SOURCE_TITLE_PREFIX} Gadget__c.Inactive_Rule`);
            expect(panel.postedHostMessages).toContainEqual({ command: 'validationRulesRendered', treeKey: GADGET_TREE_KEY, renderSequence: 3, listSequence: 9 });

            listLinks[0].dispatch('click');
            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'openValidationRuleSource', objectApiName: 'Gadget__c', ruleName: 'Inactive_Rule' });

            const ackCount = panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'validationRulesRendered').length;
            panel.postToPanel({ command: 'treeValidationRules', renderSequence: 3, treeKey: GADGET_TREE_KEY, objects: [{ objectApiName: 'Gadget__c', rules: rules }] });
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'validationRulesRendered')).toHaveLength(ackCount);

        });

    });

});
