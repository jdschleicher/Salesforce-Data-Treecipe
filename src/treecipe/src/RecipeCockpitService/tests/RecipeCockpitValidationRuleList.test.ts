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

import { execFile } from 'child_process';

import {
    IRecipeCockpitPanelState,
    IRecipeCockpitRecipeViewModel,
    RecipeCockpitService,
    RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT,
    RECIPE_COCKPIT_NO_LOCAL_VALIDATION_RULES_NOTE,
    RECIPE_COCKPIT_OBJECT_NO_VALIDATION_RULES_NOTE,
    RECIPE_COCKPIT_VALIDATION_RULE_FILE_MISSING_NOTE,
    RECIPE_COCKPIT_VALIDATION_RULE_NOT_IN_RUN_NOTE,
    RECIPE_COCKPIT_VALIDATION_RULES_LOADING_NOTE
} from '../RecipeCockpitService';
import {
    IValidationRuleListObject,
    RecipeCockpitValidationRuleList,
    VALIDATION_RULE_LIST_MAX_ERROR_MESSAGE_LENGTH,
    VALIDATION_RULE_LIST_MAX_FILE_BYTES,
    VALIDATION_RULE_LIST_MAX_NAME_LENGTH,
    VALIDATION_RULE_LIST_YIELD_EVERY_FILES,
    VALIDATION_RULE_LIST_OBJECT_SEARCH_DEPTH,
    VALIDATION_RULE_LIST_MAX_RULES_PER_OBJECT,
    VALIDATION_RULE_LIST_TRUNCATION_MARK
} from '../RecipeCockpitValidationRuleList';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { runPanelScript } from './RecipeCockpitPanelHarness';

/*
    #327: the Troubleshooting tab's Validation Rules sub-tab lists, per tree object, each rule the
    project holds and what Generate Treecipe did with it. The workspace is #324's real pipeline
    output (validationRuleWorkspace) over the DirectoryProcessor's Gadget__c / Widget__c metadata.
*/

const VALIDATION_RULE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'validationRuleWorkspace');
const OBJECTS_FIXTURE_PATH = path.join(__dirname, '..', '..', 'DirectoryProcessingService', 'tests', 'mocks', 'ValidationRuleSalesforceMetadataDirectory', 'objects');
const FAKERJS_RUN_FOLDER_NAME = 'recipe-fakerjs-2026-10-01T09-00-00';
const FAKERJS_RUN_FOLDER_PATH = path.join(VALIDATION_RULE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes', FAKERJS_RUN_FOLDER_NAME);
const WRAPPER_FILE_PATH = path.join(FAKERJS_RUN_FOLDER_PATH, fs.readdirSync(FAKERJS_RUN_FOLDER_PATH).find(fileName => fileName.startsWith('treecipeObjectsWrapper-')) as string);
const GADGET_TREE_KEY = 'Gadget__c-thru-Widget__c';
const OBJECTS_RELATIVE_PATH = 'force-app/main/default/objects';

const readWrapper = (): any => JSON.parse(fs.readFileSync(WRAPPER_FILE_PATH, 'utf-8'));
const runRules = (parsedWrapper: unknown = readWrapper()) => RecipeCockpitValidationRuleList.readRunValidationRulesByObject(parsedWrapper);

const ruleXml = (fullName: string, active: string, formula: string, errorMessage: string) => [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata">',
    `    <fullName>${fullName}</fullName>`,
    `    <active>${active}</active>`,
    `    <errorConditionFormula>${formula}</errorConditionFormula>`,
    `    <errorMessage>${errorMessage}</errorMessage>`,
    '</ValidationRule>'
].join('\n');

const ruleNamed = (objects: IValidationRuleListObject[], objectApiName: string, ruleName: string) =>
    objects.find(object => object.objectApiName === objectApiName)?.rules.find(rule => rule.ruleName === ruleName);

describe('RecipeCockpitValidationRuleList (#327)', () => {

    let temporaryRoot: string;
    let objectsPath: string;

    beforeEach(() => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-validation-rule-list-'));
        objectsPath = path.join(temporaryRoot, 'objects');
        fs.cpSync(OBJECTS_FIXTURE_PATH, objectsPath, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    });

    it('lists every rule file of each tree object, in file order, with what the run did with it', async () => {

        const objects = await RecipeCockpitValidationRuleList.buildTreeValidationRules(objectsPath, ['Gadget__c', 'Widget__c', 'Gadget__c'], runRules());

        expect(objects.map(object => object.objectApiName)).toEqual(['Gadget__c', 'Widget__c']);

        const gadgetRuleNames = objects[0].rules.map(rule => rule.ruleName);
        const ruleFileNames = fs.readdirSync(path.join(objectsPath, 'Gadget__c', 'validationRules')).sort().map(fileName => fileName.replace('.validationRule-meta.xml', ''));
        expect(gadgetRuleNames).toEqual(ruleFileNames);

        expect(ruleNamed(objects, 'Gadget__c', 'Require_Amount_Maximum')).toEqual({
            ruleName: 'Require_Amount_Maximum',
            status: 'applied',
            isActive: true,
            errorMessage: expect.any(String),
            formula: expect.stringContaining('Amount__c'),
            fieldApiNames: ['Amount__c'],
            reasons: []
        });
        expect(ruleNamed(objects, 'Gadget__c', 'Score_High')).toMatchObject({
            status: 'notApplied',
            isActive: true,
            errorMessage: 'Score High failed.',
            formula: 'Score__c > 5',
            fieldApiNames: ['Score__c'],
            reasons: ['Score__c: together these rules leave no value to generate: The minimum 10 is greater than the maximum 5.']
        });
        expect(ruleNamed(objects, 'Gadget__c', 'Complex_Formula')).toMatchObject({
            status: 'notApplied',
            fieldApiNames: [],
            reasons: ['its formula is not one of the single-field shapes Treecipe applies']
        });
        expect(ruleNamed(objects, 'Gadget__c', 'Missing_Field')?.reasons).toEqual([expect.stringContaining('Nonexistent__c')]);
        expect(ruleNamed(objects, 'Gadget__c', 'Inactive_Rule')).toEqual({
            ruleName: 'Inactive_Rule',
            status: 'inactive',
            isActive: false,
            errorMessage: 'Inactive Rule failed.',
            formula: 'ISBLANK(Code__c)',
            fieldApiNames: [],
            reasons: []
        });

        // WIDGET HAS NO validationRules FOLDER, AND THE RUN RECORDS NONE
        expect(objects[1]).toEqual({ objectApiName: 'Widget__c', rules: [] });

    });

    it('says a rule added since the run is not in it, and a rule the run recorded whose file is gone', async () => {

        const rulesFolderPath = path.join(objectsPath, 'Gadget__c', 'validationRules');
        fs.writeFileSync(path.join(rulesFolderPath, 'Added_Later.validationRule-meta.xml'), ruleXml('Added_Later', 'true', 'Quantity__c &gt; 1000', 'Too many.'));
        fs.rmSync(path.join(rulesFolderPath, 'Code_Format.validationRule-meta.xml'));

        const objects = await RecipeCockpitValidationRuleList.buildTreeValidationRules(objectsPath, ['Gadget__c'], runRules());

        expect(ruleNamed(objects, 'Gadget__c', 'Added_Later')).toMatchObject({ status: 'notInRun', isActive: true, fieldApiNames: [], reasons: [] });
        expect(ruleNamed(objects, 'Gadget__c', 'Code_Format')).toEqual({ ruleName: 'Code_Format', status: 'applied', fieldApiNames: ['Code__c'], reasons: [], isFileMissing: true });
        // A FILE GONE IS LISTED AFTER EVERY FILE THE PROJECT HOLDS
        expect(objects[0].rules.at(-1)?.ruleName).toBe('Code_Format');

    });

    it('reads a rule deactivated since the run as inactive, and a file that is not a rule as unreadable', async () => {

        const rulesFolderPath = path.join(objectsPath, 'Gadget__c', 'validationRules');
        fs.writeFileSync(path.join(rulesFolderPath, 'Code_Format.validationRule-meta.xml'), ruleXml('Code_Format', 'false', 'x', 'off now'));
        fs.writeFileSync(path.join(rulesFolderPath, 'Broken.validationRule-meta.xml'), '<ValidationRule><unclosed>');
        fs.writeFileSync(path.join(rulesFolderPath, 'Not_A_Rule.validationRule-meta.xml'), '<CustomField><fullName>x</fullName></CustomField>');

        const objects = await RecipeCockpitValidationRuleList.buildTreeValidationRules(objectsPath, ['Gadget__c'], runRules());

        expect(ruleNamed(objects, 'Gadget__c', 'Code_Format')).toMatchObject({ status: 'inactive', isActive: false, fieldApiNames: ['Code__c'] });
        expect(ruleNamed(objects, 'Gadget__c', 'Broken')).toEqual({ ruleName: 'Broken', status: 'unreadable', fieldApiNames: [], reasons: ['the file could not be read as a validation rule'] });
        expect(ruleNamed(objects, 'Gadget__c', 'Not_A_Rule')?.status).toBe('unreadable');

    });

    it('bounds what a file says, and keeps markup and template text as text', async () => {

        const rulesFolderPath = path.join(objectsPath, 'Gadget__c', 'validationRules');
        const longMessage = 'm'.repeat(VALIDATION_RULE_LIST_MAX_ERROR_MESSAGE_LENGTH + 10);
        fs.writeFileSync(path.join(rulesFolderPath, 'Hostile.validationRule-meta.xml'), ruleXml('Hostile', 'true', '&lt;img src=x onerror=alert(1)&gt; ${{ 1 }}', longMessage));

        const objects = await RecipeCockpitValidationRuleList.buildTreeValidationRules(objectsPath, ['Gadget__c'], runRules());
        const hostileRule = ruleNamed(objects, 'Gadget__c', 'Hostile');

        expect(hostileRule?.formula).toBe('<img src=x onerror=alert(1)> ${{ 1 }}');
        expect(hostileRule?.errorMessage).toBe('m'.repeat(VALIDATION_RULE_LIST_MAX_ERROR_MESSAGE_LENGTH) + VALIDATION_RULE_LIST_TRUNCATION_MARK);

    });

    it('reads at most the rules an object may have and counts the rest, and follows no link', async () => {

        const manyRulesPath = path.join(objectsPath, 'Widget__c', 'validationRules');
        fs.mkdirSync(manyRulesPath);
        for ( let ruleIndex = 0; ruleIndex < VALIDATION_RULE_LIST_MAX_RULES_PER_OBJECT + 3; ruleIndex++ ) {
            const ruleName = `Rule_${String(ruleIndex).padStart(4, '0')}`;
            fs.writeFileSync(path.join(manyRulesPath, `${ruleName}.validationRule-meta.xml`), ruleXml(ruleName, 'false', 'x', 'y'));
        }

        const outsidePath = path.join(temporaryRoot, 'outside');
        fs.mkdirSync(path.join(outsidePath, 'validationRules'), { recursive: true });
        fs.writeFileSync(path.join(outsidePath, 'validationRules', 'Outside.validationRule-meta.xml'), ruleXml('Outside', 'true', 'x', 'y'));
        fs.mkdirSync(path.join(objectsPath, 'Linked__c'));
        fs.mkdirSync(path.join(objectsPath, 'Linked__c', 'fields'));
        fs.symlinkSync(path.join(outsidePath, 'validationRules'), path.join(objectsPath, 'Linked__c', 'validationRules'));
        fs.symlinkSync(path.join(outsidePath, 'validationRules', 'Outside.validationRule-meta.xml'), path.join(objectsPath, 'Gadget__c', 'validationRules', 'Linked.validationRule-meta.xml'));

        const objects = await RecipeCockpitValidationRuleList.buildTreeValidationRules(objectsPath, ['Widget__c', 'Linked__c', 'Gadget__c', 'not an api name'], runRules());

        expect(objects.map(object => object.objectApiName)).toEqual(['Widget__c', 'Linked__c', 'Gadget__c']);
        expect(objects[0].rules).toHaveLength(VALIDATION_RULE_LIST_MAX_RULES_PER_OBJECT);
        expect(objects[0].unreadRuleCount).toBe(3);
        expect(objects[1]).toEqual({ objectApiName: 'Linked__c', rules: [] });
        expect(ruleNamed(objects, 'Gadget__c', 'Linked')).toBeUndefined();
        expect(ruleNamed(objects, 'Gadget__c', 'Outside')).toBeUndefined();

    });

    it('does not read a file past its size limit, nor an object folder deeper than the search goes, nor one it cannot list', async () => {

        fs.writeFileSync(path.join(objectsPath, 'Gadget__c', 'validationRules', 'Huge.validationRule-meta.xml'), ' '.repeat(VALIDATION_RULE_LIST_MAX_FILE_BYTES + 1));
        expect(ruleNamed(await RecipeCockpitValidationRuleList.buildTreeValidationRules(objectsPath, ['Gadget__c'], new Map()), 'Gadget__c', 'Huge')?.status).toBe('unreadable');
        expect((await RecipeCockpitValidationRuleList.readLocalValidationRule(path.join(objectsPath, 'missing.validationRule-meta.xml'), 'missing.validationRule-meta.xml')).isReadable).toBe(false);

        const deepFolderPath = path.join(objectsPath, ...Array.from({ length: VALIDATION_RULE_LIST_OBJECT_SEARCH_DEPTH }, (_unused, depth) => `level${depth}`), 'Deep__c', 'validationRules');
        fs.mkdirSync(deepFolderPath, { recursive: true });
        fs.mkdirSync(path.join(objectsPath, 'Shallow', 'Shallow__c', 'validationRules'), { recursive: true });

        const directoryPaths = RecipeCockpitValidationRuleList.findObjectDirectoryPaths(objectsPath, ['Deep__c', 'Shallow__c']);
        expect([...directoryPaths.keys()]).toEqual(['Shallow__c']);
        expect(RecipeCockpitValidationRuleList.findObjectDirectoryPaths(path.join(objectsPath, 'nowhere'), ['Gadget__c']).size).toBe(0);

    });

    it('matches a run record by the name generation recorded: an empty fullName, a long one, and a file it could not read', async () => {

        const rulesFolderPath = path.join(objectsPath, 'Widget__c', 'validationRules');
        fs.mkdirSync(rulesFolderPath);
        const longName = 'L'.repeat(300);
        fs.writeFileSync(path.join(rulesFolderPath, 'Nameless.validationRule-meta.xml'), ruleXml('', 'true', 'Weight__c &lt; 0', 'No.'));
        fs.writeFileSync(path.join(rulesFolderPath, 'Long.validationRule-meta.xml'), ruleXml(longName, 'true', 'Weight__c &gt; 9', 'No.'));
        fs.writeFileSync(path.join(rulesFolderPath, 'Was_Unreadable.validationRule-meta.xml'), ruleXml('Was_Unreadable', 'true', 'AND(a, b)', 'No.'));

        const objects = await RecipeCockpitValidationRuleList.buildTreeValidationRules(objectsPath, ['Widget__c'], runRules({ ObjectToObjectInfoMap: { Widget__c: {
            Fields: [{ fieldName: 'Weight__c', validationRuleConstraints: [{ ruleName: '', applied: true }, { ruleName: longName, applied: false, reason: 'too narrow' }] }],
            ValidationRulesNotApplied: [{ ruleName: 'Was_Unreadable.validationRule-meta.xml', reason: 'the file could not be read' }]
        } } }));

        expect(objects[0].rules.map(rule => [rule.ruleName.slice(0, 20), rule.status, rule.isFileMissing === true])).toEqual([
            ['LLLLLLLLLLLLLLLLLLLL', 'notApplied', false],
            ['Nameless', 'applied', false],
            ['Was_Unreadable', 'notApplied', false]
        ]);
        expect(objects[0].rules[0].ruleName).toHaveLength(VALIDATION_RULE_LIST_MAX_NAME_LENGTH + 1);
        expect(objects[0].rules[2].reasons).toEqual(['the file could not be read']);

    });

    it('gives the extension host back every few hundred files, across objects', async () => {

        const manyRulesPath = path.join(objectsPath, 'Widget__c', 'validationRules');
        fs.mkdirSync(manyRulesPath);
        for ( let ruleIndex = 0; ruleIndex < VALIDATION_RULE_LIST_YIELD_EVERY_FILES; ruleIndex++ ) {
            fs.writeFileSync(path.join(manyRulesPath, `Rule_${String(ruleIndex).padStart(4, '0')}.validationRule-meta.xml`), ruleXml(`Rule_${ruleIndex}`, 'false', 'x', 'y'));
        }

        const setImmediateSpy = jest.spyOn(global, 'setImmediate');
        await RecipeCockpitValidationRuleList.buildTreeValidationRules(objectsPath, ['Widget__c'], new Map());
        expect(setImmediateSpy).toHaveBeenCalledTimes(1);

        setImmediateSpy.mockClear();
        await RecipeCockpitValidationRuleList.buildTreeValidationRules(objectsPath, ['Gadget__c', 'Widget__c'], new Map());
        expect(setImmediateSpy).toHaveBeenCalledTimes(1);

        setImmediateSpy.mockClear();
        await RecipeCockpitValidationRuleList.buildTreeValidationRules(objectsPath, ['Gadget__c'], new Map());
        expect(setImmediateSpy).not.toHaveBeenCalled();

    });

    it('skips run records that are not the shape #324 writes, and keeps a rule named __proto__ as a name', () => {

        const runRecords = RecipeCockpitValidationRuleList.readRunValidationRules(JSON.parse(JSON.stringify({
            Fields: [
                { fieldName: 'Amount__c', validationRuleConstraints: [{ ruleName: '__proto__', applied: true }, { ruleName: 'NoApplied' }, 'nope', { ruleName: '', applied: true }] },
                { fieldName: 'bad name', validationRuleConstraints: [{ ruleName: 'Elsewhere', applied: true }] },
                { fieldName: 'Code__c', validationRuleConstraints: 'nope' },
                'nope'
            ],
            ValidationRulesNotApplied: [{ ruleName: 'Object_Rule', reason: 'why' }, { ruleName: 7, reason: 'why' }, { ruleName: 'Object_Rule', reason: 'why' }]
        })));

        // AN EMPTY NAME IS KEPT: GENERATION RECORDS A RULE WITH AN EMPTY <fullName> UNDER IT
        expect([...runRecords.keys()]).toEqual(['__proto__', '', 'Object_Rule']);
        expect(runRecords.get('')).toEqual({ fieldApiNames: ['Amount__c'], isApplied: true, reasons: [] });
        expect(runRecords.get('__proto__')).toEqual({ fieldApiNames: ['Amount__c'], isApplied: true, reasons: [] });
        expect(runRecords.get('Object_Rule')).toEqual({ fieldApiNames: [], isApplied: false, reasons: ['why'] });
        expect(RecipeCockpitValidationRuleList.readRunValidationRules(undefined).size).toBe(0);

        // AN OBJECT IS READ ONLY UNDER AN API NAME, AND ONE WITH NO RECORD IS NOT KEPT
        const byObject = runRules({ ObjectToObjectInfoMap: { 'bad name': { ValidationRulesNotApplied: [{ ruleName: 'R', reason: 'x' }] }, Widget__c: { Fields: [] } } });
        expect(byObject.size).toBe(0);

    });

    it('lists an object no folder holds with the rules its run recorded, and nothing for an object the wrapper lacks', async () => {

        fs.rmSync(path.join(objectsPath, 'Gadget__c'), { recursive: true });

        const objects = await RecipeCockpitValidationRuleList.buildTreeValidationRules(objectsPath, ['Gadget__c'], runRules({ ObjectToObjectInfoMap: { Gadget__c: readWrapper().ObjectToObjectInfoMap.Gadget__c } }));
        expect(objects[0].rules.length).toBeGreaterThan(0);
        expect(objects[0].rules.every(rule => rule.isFileMissing === true)).toBe(true);

        expect(await RecipeCockpitValidationRuleList.buildTreeValidationRules(objectsPath, ['Widget__c'], runRules('not a wrapper'))).toEqual([{ objectApiName: 'Widget__c', rules: [] }]);

    });

});

describe('RecipeCockpitService, the Validation Rules list (#327)', () => {

    describe('routePanelMessage', () => {

        it('routes a load only for a card the panel confirmed drawing, on the model on screen, and reads nothing from the message but the key', () => {

            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: '' }, renderSequence: 3 };
            panelState.treeHistoryAllowLists.nameableTreeKeys = new Set([GADGET_TREE_KEY]);

            expect(RecipeCockpitService.routePanelMessage({ command: 'loadValidationRules', treeKey: GADGET_TREE_KEY, renderSequence: 3, objectApiNames: ['Account'] } as any, panelState))
                .toEqual({ kind: 'loadValidationRules', treeKey: GADGET_TREE_KEY, renderSequence: 3 });
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadValidationRules', treeKey: GADGET_TREE_KEY, renderSequence: 2 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadValidationRules', treeKey: 'Other', renderSequence: 3 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadValidationRules', treeKey: 7, renderSequence: 3 }, panelState)).toBeUndefined();

            panelState.treeHistoryAllowLists.nameableTreeKeys = new Set();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadValidationRules', treeKey: GADGET_TREE_KEY, renderSequence: 3 }, panelState)).toBeUndefined();

        });

    });

    describe('the host', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let workspaceState: { get: jest.Mock; update: jest.Mock };

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;

        const openCockpit = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
        };

        const loadRules = async () => {
            await receivedMessageHandler({ command: 'loadValidationRules', treeKey: GADGET_TREE_KEY, renderSequence: lastRenderSequence() });
            await flushAsyncWork();
            return postedNamed('treeValidationRules').at(-1);
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-validation-rules-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(VALIDATION_RULE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.cpSync(OBJECTS_FIXTURE_PATH, path.join(workspaceRoot, OBJECTS_RELATIVE_PATH), { recursive: true });

            RecipeCockpitService.clearTreeValidationRuleLists();
            postedPanelMessages = [];
            const storedWorkspaceState = new Map<string, unknown>();
            workspaceState = {
                get: jest.fn().mockImplementation((stateKey: string) => storedWorkspaceState.get(stateKey)),
                update: jest.fn().mockImplementation(async (stateKey: string, stateValue: unknown) => { storedWorkspaceState.set(stateKey, stateValue); })
            };

            (execFile as unknown as jest.Mock).mockReset();
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

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('posts nothing about rules until the sub-tab asks, then the tree\'s rules, contacting no org', async () => {

            const connectionSpy = jest.spyOn(SalesforceOrgService, 'getConnection');
            await openCockpit();

            expect(postedNamed('treeValidationRules')).toEqual([]);
            expect(JSON.stringify(postedNamed('recipeData'))).not.toContain('Score High failed.');

            const rulesMessage = await loadRules();

            expect(rulesMessage).toMatchObject({ command: 'treeValidationRules', treeKey: GADGET_TREE_KEY, renderSequence: lastRenderSequence() });
            expect(rulesMessage.failureMessage).toBeUndefined();
            expect(rulesMessage.objects.map((object: IValidationRuleListObject) => object.objectApiName)).toEqual(['Gadget__c', 'Widget__c']);
            expect(ruleNamed(rulesMessage.objects, 'Gadget__c', 'Inactive_Rule')?.status).toBe('inactive');
            expect(ruleNamed(rulesMessage.objects, 'Gadget__c', 'Code_Format')?.status).toBe('applied');
            expect(connectionSpy).not.toHaveBeenCalled();
            expect(execFile).not.toHaveBeenCalled();

        });

        it('keeps the list per model and tree, and reads it again once cleared (a retrieve)', async () => {

            await openCockpit();
            await loadRules();

            fs.writeFileSync(path.join(workspaceRoot, OBJECTS_RELATIVE_PATH, 'Widget__c', 'Later.validationRule-meta.xml'), 'ignored: not in validationRules');
            fs.mkdirSync(path.join(workspaceRoot, OBJECTS_RELATIVE_PATH, 'Widget__c', 'validationRules'));
            fs.writeFileSync(path.join(workspaceRoot, OBJECTS_RELATIVE_PATH, 'Widget__c', 'validationRules', 'Later.validationRule-meta.xml'), ruleXml('Later', 'true', 'Weight__c &lt; 0', 'No.'));

            expect(ruleNamed((await loadRules()).objects, 'Widget__c', 'Later')).toBeUndefined();

            await (RecipeCockpitService as any).refreshTreeValidationRules(GADGET_TREE_KEY);
            expect(ruleNamed(postedNamed('treeValidationRules').at(-1).objects, 'Widget__c', 'Later')).toMatchObject({ status: 'notInRun', isActive: true });

        });

        it('says why when the objects path or the run\'s wrapper cannot be read, and reads again next time', async () => {

            await openCockpit();

            (ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration as jest.Mock).mockReturnValue('../../elsewhere');
            const outsideMessage = await loadRules();
            expect(outsideMessage.objects).toEqual([]);
            expect(outsideMessage.failureMessage).toContain('outside this workspace');

            (ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration as jest.Mock).mockReturnValue(OBJECTS_RELATIVE_PATH);
            fs.writeFileSync(panelState().objectsWrapperFilePath as string, '{ not json');
            const wrapperMessage = await loadRules();
            expect(wrapperMessage.failureMessage).toContain('could not be read again');

            fs.copyFileSync(path.join(FAKERJS_RUN_FOLDER_PATH, path.basename(WRAPPER_FILE_PATH)), panelState().objectsWrapperFilePath as string);
            expect((await loadRules()).failureMessage).toBeUndefined();

        });

        it('parses the run\'s wrapper once per model, however many times its lists are read', async () => {

            await openCockpit();
            const readSpy = jest.spyOn(fs, 'readFileSync');
            const wrapperReads = () => readSpy.mock.calls.filter(([filePath]) => filePath === panelState().objectsWrapperFilePath).length;

            await loadRules();
            expect(wrapperReads()).toBe(1);

            // A RETRIEVE READS THE RULE FILES AGAIN, NOT THE WRAPPER, WHICH IT DID NOT CHANGE
            await (RecipeCockpitService as any).refreshTreeValidationRules(GADGET_TREE_KEY);
            expect(postedNamed('treeValidationRules')).toHaveLength(2);
            expect(wrapperReads()).toBe(1);

        });

        it('posts the list again after a retrieve for every tree that drew one, not only the tree that retrieved', async () => {

            await openCockpit();
            await loadRules();

            await (RecipeCockpitService as any).refreshTreeValidationRules('Another-tree');

            expect(postedNamed('treeValidationRules').map(rulesMessage => rulesMessage.treeKey)).toEqual([GADGET_TREE_KEY, GADGET_TREE_KEY]);

        });

        it('does not keep a read that threw, so the next request reads again', async () => {

            await openCockpit();
            const buildSpy = jest.spyOn(RecipeCockpitValidationRuleList, 'buildTreeValidationRules').mockRejectedValueOnce(new Error('boom'));

            await expect((RecipeCockpitService as any).postTreeValidationRules((RecipeCockpitService as any).recipeCockpitPanel, GADGET_TREE_KEY, lastRenderSequence())).rejects.toThrow('boom');
            expect((await loadRules()).objects.length).toBe(2);
            expect(buildSpy).toHaveBeenCalledTimes(2);

        });

        it('posts nothing for a model no longer on screen, or a tree the model does not hold', async () => {

            await openCockpit();
            const renderSequence = lastRenderSequence();

            await (RecipeCockpitService as any).postTreeValidationRules((RecipeCockpitService as any).recipeCockpitPanel, 'Missing-tree', renderSequence);
            await (RecipeCockpitService as any).postTreeValidationRules((RecipeCockpitService as any).recipeCockpitPanel, GADGET_TREE_KEY, renderSequence + 1);

            expect(postedNamed('treeValidationRules')).toEqual([]);

        });

    });

    describe('the panel script', () => {

        const loadRecipe = (): IRecipeCockpitRecipeViewModel => RecipeCockpitService.loadRecipeRunByRuns(
            RecipeCockpitService.findGeneratedRecipeRuns(path.join(VALIDATION_RULE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes')),
            VALIDATION_RULE_WORKSPACE_ROOT,
            FAKERJS_RUN_FOLDER_NAME
        ).recipeViewModel;

        type Panel = ReturnType<typeof runPanelScript>;

        const drawRecipe = (savedState?: any): Panel => {
            const panel = runPanelScript(savedState ? { savedState } : {});
            panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 3 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            return panel;
        };

        const gadgetCardOf = (panel: Panel) => panel.treeCards()[0];
        const subPanelOf = (panel: Panel, treeCard: any) => panel.findAll(treeCard, 'troubleshootingSubPanel-validationRules')[0];
        const subTabOf = (panel: Panel, treeCard: any) => panel.findAll(treeCard, 'troubleshootingSubTab').find((tabElement: any) => tabElement.textContent === 'Validation Rules');
        const loadRequests = (panel: Panel) => panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'loadValidationRules');
        const textsOf = (panel: Panel, root: any, className: string) => panel.findAll(root, className).map((element: any) => element.textContent);

        const openValidationRules = (panel: Panel) => {
            const gadgetCard = gadgetCardOf(panel);
            panel.openTab(gadgetCard, 'Troubleshooting');
            subTabOf(panel, gadgetCard).dispatch('click');
            return gadgetCard;
        };

        const populatedMessage = (renderSequence = 3) => ({
            command: 'treeValidationRules',
            renderSequence: renderSequence,
            treeKey: GADGET_TREE_KEY,
            objects: [
                {
                    objectApiName: 'Gadget__c',
                    rules: [
                        { ruleName: 'Score_High', status: 'applied', isActive: true, errorMessage: 'Score High failed.', formula: 'Score__c > 5', fieldApiNames: ['Score__c'], reasons: [] },
                        { ruleName: 'Complex_Formula', status: 'notApplied', isActive: true, errorMessage: 'Complex failed.', formula: 'AND(A, B)', fieldApiNames: [], reasons: ['its formula is not one of the single-field shapes Treecipe applies'] },
                        { ruleName: 'Inactive_Rule', status: 'inactive', isActive: false, errorMessage: '<img src=x onerror=alert(1)>', formula: '<script>alert(1)</script>', fieldApiNames: [], reasons: [] },
                        { ruleName: 'Added_Later', status: 'notInRun', isActive: true, fieldApiNames: [], reasons: [] },
                        { ruleName: 'Code_Format', status: 'applied', fieldApiNames: ['Code__c'], reasons: [], isFileMissing: true }
                    ]
                },
                { objectApiName: 'Widget__c', rules: [] }
            ]
        });

        it('asks for the list only when the Validation Rules sub-tab is opened, once per model, and draws a loading note until it comes', () => {

            const panel = drawRecipe();
            const gadgetCard = gadgetCardOf(panel);

            panel.openTab(gadgetCard, 'Troubleshooting');
            expect(loadRequests(panel)).toEqual([]);

            subTabOf(panel, gadgetCard).dispatch('click');
            expect(loadRequests(panel)).toEqual([{ command: 'loadValidationRules', treeKey: GADGET_TREE_KEY, renderSequence: 3 }]);
            expect(textsOf(panel, subPanelOf(panel, gadgetCard), 'treeEmpty')).toEqual([RECIPE_COCKPIT_VALIDATION_RULES_LOADING_NOTE]);

            // OPENING IT AGAIN ASKS NOTHING MORE
            panel.findAll(gadgetCard, 'troubleshootingSubTab')[0].dispatch('click');
            subTabOf(panel, gadgetCard).dispatch('click');
            expect(loadRequests(panel)).toHaveLength(1);

            // THE RETRIEVE BUTTON STAYS FIRST IN THE SUB-TAB
            expect(panel.findAll(subPanelOf(panel, gadgetCard), 'treeRetrieveValidationRules')).toHaveLength(1);

        });

        it('asks for a sub-tab a saved place opened on once the model is acknowledged', () => {

            const panel = runPanelScript({ savedState: {
                version: 2, runFolderName: FAKERJS_RUN_FOLDER_NAME, isOrgPickerInUse: false, isFavoritesOnly: false, scrollY: 0,
                trees: [{ treeKey: GADGET_TREE_KEY, isExpanded: true, selectedTab: 'troubleshooting', troubleshootingSubTab: 'validationRules', searchQueries: { treecipe: '', datasets: '' }, expandedObjectKeys: [], openPicklistKeys: [] }]
            } });
            panel.postToPanel({ command: 'recipeData', recipe: loadRecipe(), renderSequence: 3 });
            panel.postToPanel({ command: 'rendered' });

            // ONE REQUEST, MADE ONCE THE DRAWN MODEL IS ACKNOWLEDGED, AFTER THE TAB'S COUNTS
            const loadMessages = panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'loadValidationRules' || hostMessage.command === 'loadTroubleshootingSummary' || hostMessage.command === 'rendered');
            expect(loadMessages.map(hostMessage => hostMessage.command)).toEqual(['rendered', 'loadTroubleshootingSummary', 'loadValidationRules']);
            expect(loadRequests(panel)).toEqual([{ command: 'loadValidationRules', treeKey: GADGET_TREE_KEY, renderSequence: 3 }]);

        });

        it('draws each object\'s rules with name, status, active, message, fields and reasons, every value as text, the formula collapsed', () => {

            const panel = drawRecipe();
            const gadgetCard = openValidationRules(panel);
            panel.postToPanel(populatedMessage());

            const subPanel = subPanelOf(panel, gadgetCard);
            expect(textsOf(panel, subPanel, 'validationRuleObjectName')).toEqual(['Gadget__c', 'Widget__c']);
            expect(textsOf(panel, subPanel, 'validationRuleName')).toEqual(['Score_High', 'Complex_Formula', 'Inactive_Rule', 'Added_Later', 'Code_Format']);
            expect(textsOf(panel, subPanel, 'validationRuleStatus')).toEqual(['Applied', 'Not applied', 'Inactive', 'Not in this run', 'Applied']);
            expect(textsOf(panel, subPanel, 'validationRuleActive')).toEqual(['active', 'active', 'inactive', 'active']);
            expect(textsOf(panel, subPanel, 'validationRuleMessage')).toEqual(['Error message: Score High failed.', 'Error message: Complex failed.', 'Error message: <img src=x onerror=alert(1)>']);
            expect(textsOf(panel, subPanel, 'validationRuleFields')[0]).toBe('Constrains: Score__c');
            expect(textsOf(panel, subPanel, 'validationRuleReason')).toEqual([
                'Why not applied: its formula is not one of the single-field shapes Treecipe applies',
                RECIPE_COCKPIT_VALIDATION_RULE_NOT_IN_RUN_NOTE,
                RECIPE_COCKPIT_VALIDATION_RULE_FILE_MISSING_NOTE
            ]);
            expect(textsOf(panel, subPanel, 'validationRuleEmpty')).toEqual([RECIPE_COCKPIT_OBJECT_NO_VALIDATION_RULES_NOTE]);
            expect(panel.findAll(subPanel, 'validationRuleNoLocalRules')).toEqual([]);


            // THE FORMULA IS NOT BUILT UNTIL ITS BUTTON OPENS IT; RULES WITH NONE DRAW NO BUTTON
            expect(panel.findAll(subPanel, 'validationRuleFormula')).toEqual([]);
            const toggles = panel.findAll(subPanel, 'validationRuleFormulaToggle');
            expect(toggles).toHaveLength(3);
            expect(toggles.every((toggle: any) => toggle.attributes['aria-expanded'] === 'false' && toggle.classList.contains('sdtButton-secondary'))).toBe(true);

            toggles[2].dispatch('click');
            const formulaElement = panel.findAll(subPanel, 'validationRuleFormula')[0];
            expect(formulaElement.textContent).toBe('<script>alert(1)</script>');
            expect(panel.isHidden(formulaElement)).toBe(false);
            expect(toggles[2].attributes['aria-expanded']).toBe('true');
            expect(toggles[2].textContent).toBe('Hide formula');

            toggles[2].dispatch('click');
            expect(panel.isHidden(formulaElement)).toBe(true);

        });

        it('offers the retrieve when the project holds no rule for any tree object', () => {

            const panel = drawRecipe();
            const gadgetCard = openValidationRules(panel);
            panel.postToPanel({
                command: 'treeValidationRules', renderSequence: 3, treeKey: GADGET_TREE_KEY,
                objects: [
                    { objectApiName: 'Gadget__c', rules: [{ ruleName: 'Gone', status: 'applied', fieldApiNames: ['Code__c'], reasons: [], isFileMissing: true }] },
                    { objectApiName: 'Widget__c', rules: [] }
                ]
            });

            const subPanel = subPanelOf(panel, gadgetCard);
            expect(textsOf(panel, subPanel, 'validationRuleNoLocalRules')).toEqual([RECIPE_COCKPIT_NO_LOCAL_VALIDATION_RULES_NOTE]);
            expect(RECIPE_COCKPIT_NO_LOCAL_VALIDATION_RULES_NOTE).toContain('Retrieve validation rules…');
            expect(panel.findAll(subPanel, 'treeRetrieveValidationRules')).toHaveLength(1);
            expect(textsOf(panel, subPanel, 'validationRuleEmpty')).toEqual([RECIPE_COCKPIT_OBJECT_NO_VALIDATION_RULES_NOTE]);

        });

        it('draws an empty tree as each object saying so, under the retrieve note', () => {

            const panel = drawRecipe();
            const gadgetCard = openValidationRules(panel);
            panel.postToPanel({ command: 'treeValidationRules', renderSequence: 3, treeKey: GADGET_TREE_KEY, objects: [{ objectApiName: 'Gadget__c', rules: [] }, { objectApiName: 'Widget__c', rules: [] }] });

            const subPanel = subPanelOf(panel, gadgetCard);
            expect(textsOf(panel, subPanel, 'validationRuleEmpty')).toEqual([RECIPE_COCKPIT_OBJECT_NO_VALIDATION_RULES_NOTE, RECIPE_COCKPIT_OBJECT_NO_VALIDATION_RULES_NOTE]);
            expect(panel.findAll(subPanel, 'validationRuleNoLocalRules')).toHaveLength(1);
            expect(panel.findAll(subPanel, 'tabMatchCount')[0]?.textContent ?? '').toContain('0 rules');

        });

        it('filters by rule and counts what is left, matching a formula only while it is open', () => {

            const panel = drawRecipe();
            const gadgetCard = openValidationRules(panel);
            panel.postToPanel(populatedMessage());

            const subPanel = subPanelOf(panel, gadgetCard);
            const shownRuleNames = () => panel.findAll(subPanel, 'validationRule').filter((ruleElement: any) => !panel.isHidden(ruleElement))
                .map((ruleElement: any) => panel.findAll(ruleElement, 'validationRuleName')[0].textContent);
            const typeSearch = (searchText: string) => panel.typeIntoTabSearch(gadgetCard, 'troubleshootingSubPanel-validationRules', searchText);
            const matchCount = () => panel.findAll(subPanel, 'tabMatchCount')[0].textContent;

            expect(matchCount()).toBe('5 rules');

            typeSearch('score__c');
            expect(shownRuleNames()).toEqual(['Score_High']);
            expect(matchCount()).toBe('1 of 5 rules');
            // AN OBJECT WITH NO MATCHING RULE IS HIDDEN
            expect(panel.isHidden(panel.findAll(subPanel, 'validationRuleObject')[1])).toBe(true);

            typeSearch('and(a');
            expect(shownRuleNames()).toEqual([]);
            expect(matchCount()).toBe('no matches');
            // THE SEARCH TYPED BEFORE THE FORMULA OPENED IS APPLIED AGAIN WHEN IT OPENS, AND WHEN IT CLOSES
            panel.findAll(subPanel, 'validationRuleFormulaToggle')[1].dispatch('click');
            expect(shownRuleNames()).toEqual(['Complex_Formula']);
            expect(matchCount()).toBe('1 of 5 rules');
            panel.findAll(subPanel, 'validationRuleFormulaToggle')[1].dispatch('click');
            expect(shownRuleNames()).toEqual([]);
            panel.findAll(subPanel, 'validationRuleFormulaToggle')[1].dispatch('click');

            typeSearch('widget');
            expect(panel.isHidden(panel.findAll(subPanel, 'validationRuleObject')[1])).toBe(false);

            typeSearch('');
            expect(shownRuleNames()).toHaveLength(5);

        });

        it('builds a group\'s rows only when it opens, opening groups within the auto-expand budgets', () => {

            const panel = drawRecipe();
            const gadgetCard = openValidationRules(panel);
            const subPanel = subPanelOf(panel, gadgetCard);
            const objectCount = RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT + 5;

            panel.postToPanel({
                command: 'treeValidationRules', renderSequence: 3, treeKey: GADGET_TREE_KEY,
                objects: Array.from({ length: objectCount }, (_unused, objectIndex) => ({
                    objectApiName: `Object_${objectIndex}__c`,
                    rules: [{ ruleName: `Rule_${objectIndex}`, status: 'inactive', isActive: false, fieldApiNames: [], reasons: [] }]
                }))
            });

            expect(panel.findAll(subPanel, 'validationRuleObject')).toHaveLength(objectCount);
            expect(panel.findAll(subPanel, 'validationRule')).toHaveLength(RECIPE_COCKPIT_AUTO_EXPAND_OBJECT_LIMIT);

            // A CLOSED GROUP IS STILL SEARCHED, AND OPENED WHEN IT MATCHES
            const lastName = `Rule_${objectCount - 1}`;
            panel.typeIntoTabSearch(gadgetCard, 'troubleshootingSubPanel-validationRules', lastName.toLowerCase());
            expect(textsOf(panel, subPanel, 'validationRuleName').filter((ruleName: string) => ruleName === lastName)).toEqual([lastName]);

            // A READER'S CLICK OPENS AND CLOSES A GROUP
            const toggle = panel.findAll(panel.findAll(subPanel, 'validationRuleObject')[objectCount - 1], 'validationRuleToggle')[0];
            expect(toggle.classList.contains('chevronToggle')).toBe(true);
            toggle.dispatch('click');
            expect(toggle.attributes['aria-expanded']).toBe('false');

        });

        it('drops a list for another model, and draws a failure that is asked again on the next open', () => {

            const panel = drawRecipe();
            const gadgetCard = openValidationRules(panel);
            const subPanel = subPanelOf(panel, gadgetCard);

            panel.postToPanel(populatedMessage(2));
            expect(panel.findAll(subPanel, 'validationRule')).toEqual([]);

            panel.postToPanel({ command: 'treeValidationRules', renderSequence: 3, treeKey: GADGET_TREE_KEY, objects: [], failureMessage: 'The objects wrapper could not be read again.' });
            expect(textsOf(panel, subPanel, 'treeEmpty')).toEqual(['The objects wrapper could not be read again.']);

            panel.findAll(gadgetCard, 'troubleshootingSubTab')[0].dispatch('click');
            subTabOf(panel, gadgetCard).dispatch('click');
            expect(loadRequests(panel)).toHaveLength(2);

            // A LIST POSTED AGAIN (A RETRIEVE) REPLACES THE ONE ON SCREEN
            panel.postToPanel(populatedMessage());
            panel.postToPanel(populatedMessage());
            expect(panel.findAll(subPanel, 'validationRule')).toHaveLength(5);

        });

    });

});
