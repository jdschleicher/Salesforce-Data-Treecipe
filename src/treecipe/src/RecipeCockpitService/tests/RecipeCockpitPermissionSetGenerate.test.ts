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
    env: { openExternal: jest.fn(), clipboard: { writeText: jest.fn() } },
    window: {
        createWebviewPanel: jest.fn(),
        createQuickPick: jest.fn(),
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
    RecipeCockpitService,
    RECIPE_COCKPIT_GENERATE_PERMISSION_SET_ACTION_LABEL,
    RECIPE_COCKPIT_GENERATE_PERMISSION_SET_CONFIRM_LABEL,
    RECIPE_COCKPIT_GENERATE_PERMISSION_SET_COPY_LABEL,
    RECIPE_COCKPIT_GENERATE_PERMISSION_SET_OPEN_LABEL,
    RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL,
    RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL
} from '../RecipeCockpitService';
import { IPermissionSetGeneratePlan, PERMISSION_SET_GENERATED_FOLDER_NAME, RecipeCockpitPermissionSetGenerate } from '../RecipeCockpitPermissionSetGenerate';
import { RecipeCockpitPermissionSetAssign } from '../RecipeCockpitPermissionSetAssign';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { SfdxProjectService } from '../../SfdxProjectService/SfdxProjectService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const GENERATE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'permissionSetGenerateWorkspace');
const OBJECTS_PATH = './force-app/main/default/objects';

const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const ACCOUNT_TREE_PERMISSION_SET_NAME = 'SDT_Account_thru_OtherChildObject_c';
const ACCOUNT_TREE_FILE_PATH = `force-app/main/default/permissionsets/SDT_Treecipe/${ACCOUNT_TREE_PERMISSION_SET_NAME}.permissionset-meta.xml`;

// WHAT THE ACCOUNT TREE'S WRAPPER FIELDS ARE, AGAINST THE FIXTURE'S SOURCE XML
const ACCOUNT_TREE_OBJECTS = [
    { objectApiName: 'OtherChildObject__c', fieldApiNames: ['Score__c', 'Ratio__c', 'Contact__c'] },
    { objectApiName: 'Account', fieldApiNames: ['Legacy_Code__c', 'Annual_Budget__c', 'Rating__c', 'Sub_Rating__c', 'Regions__c', 'ParentId', 'OwnerId'] },
    { objectApiName: 'Contact', fieldApiNames: ['LastName', 'AccountId'] }
];

const ACCOUNT_TREE_PLAN: IPermissionSetGeneratePlan = {
    objectApiNames: ['Account', 'Contact', 'OtherChildObject__c'],
    fieldPermissions: [
        { field: 'Account.Annual_Budget__c', isEditable: false },
        { field: 'Account.Legacy_Code__c', isEditable: true },
        { field: 'Account.ParentId', isEditable: true },
        { field: 'Account.Rating__c', isEditable: true },
        { field: 'Account.Regions__c', isEditable: true },
        { field: 'OtherChildObject__c.Ratio__c', isEditable: true },
        { field: 'OtherChildObject__c.Score__c', isEditable: false }
    ],
    skippedNameCount: 0,
    unreadableFieldCount: 2,
    notGrantableFieldCount: 2,
    requiredUnknownFieldCount: 1
};

describe('RecipeCockpitService, "Generate permission set…" in the Treecipe tab (#306)', () => {

    describe('RecipeCockpitPermissionSetGenerate', () => {

        const objectsDirectoryPath = path.join(GENERATE_WORKSPACE_ROOT, 'force-app', 'main', 'default', 'objects');

        it('names the permission set SDT_ and the folder name with every other character made one underscore, ends trimmed', () => {

            expect(RecipeCockpitPermissionSetGenerate.buildPermissionSetName('Account-thru-OtherChildObject__c')).toBe('SDT_Account_thru_OtherChildObject_c');
            expect(RecipeCockpitPermissionSetGenerate.buildPermissionSetName('Lead-ONLY')).toBe('SDT_Lead_ONLY');
            expect(RecipeCockpitPermissionSetGenerate.buildPermissionSetName('__1st tree--')).toBe('SDT_1st_tree');
            expect(RecipeCockpitPermissionSetGenerate.buildPermissionSetName('../<x>"\n')).toBe('SDT_x');

        });

        it('cuts the name to 80 characters without leaving a trailing underscore, and refuses a folder name with nothing usable', () => {

            const longName = RecipeCockpitPermissionSetGenerate.buildPermissionSetName(`${'A'.repeat(75)}_B${'C'.repeat(20)}`);
            expect(longName).toBe(`SDT_${'A'.repeat(75)}`);
            expect(longName!.length).toBeLessThanOrEqual(80);

            expect(RecipeCockpitPermissionSetGenerate.buildPermissionSetName(`${'A'.repeat(76)}-B`)).toBe(`SDT_${'A'.repeat(76)}`);
            expect(RecipeCockpitPermissionSetGenerate.buildPermissionSetName('')).toBeUndefined();
            expect(RecipeCockpitPermissionSetGenerate.buildPermissionSetName('---')).toBeUndefined();
            expect(RecipeCockpitPermissionSetGenerate.buildPermissionSetName('éé')).toBeUndefined();

        });

        it('answers only names Salesforce takes, whatever the folder name', () => {

            const hostileFolderNames = ['a', '9', '_a_', 'a__b', '__proto__', 'a\u2028b', 'x'.repeat(200), `${'a'.repeat(75)}__b`, '..', 'ä-b', ' Account - thru - Contact ', 'A'.repeat(76) + '_'];
            hostileFolderNames.forEach(folderName => {
                const permissionSetName = RecipeCockpitPermissionSetGenerate.buildPermissionSetName(folderName);
                expect(permissionSetName === undefined || RecipeCockpitPermissionSetGenerate.isPermissionSetName(permissionSetName)).toBe(true);
            });
            expect(RecipeCockpitPermissionSetGenerate.buildPermissionSetName('..')).toBeUndefined();

        });

        it('accepts only names Salesforce takes: an api name with no "__", no trailing "_", at most 80 characters', () => {

            expect(RecipeCockpitPermissionSetGenerate.isPermissionSetName('SDT_Lead_ONLY')).toBe(true);
            expect(RecipeCockpitPermissionSetGenerate.isPermissionSetName('SDT__Lead')).toBe(false);
            expect(RecipeCockpitPermissionSetGenerate.isPermissionSetName('SDT_Lead_')).toBe(false);
            expect(RecipeCockpitPermissionSetGenerate.isPermissionSetName(`S${'a'.repeat(80)}`)).toBe(false);
            expect(RecipeCockpitPermissionSetGenerate.isPermissionSetName(7)).toBe(false);

        });

        it('labels it on one line, cut to 80, falling back to the name', () => {

            expect(RecipeCockpitPermissionSetGenerate.buildPermissionSetLabel('My\ntree  <one>', 'SDT_X')).toBe('My tree <one>');
            expect(RecipeCockpitPermissionSetGenerate.buildPermissionSetLabel('  \n ', 'SDT_X')).toBe('SDT_X');
            expect(RecipeCockpitPermissionSetGenerate.buildPermissionSetLabel('x'.repeat(100), 'SDT_X')).toHaveLength(80);

        });

        it('writes into an SDT_Treecipe folder under permissionsets, never at its first level, and offers a deploy command it never runs', () => {

            expect(PERMISSION_SET_GENERATED_FOLDER_NAME).toBe('SDT_Treecipe');
            expect(RecipeCockpitPermissionSetGenerate.getPermissionSetFilePath(path.join('/w', 'force-app'), 'SDT_X'))
                .toBe(path.join('/w', 'force-app', 'main', 'default', 'permissionsets', 'SDT_Treecipe', 'SDT_X.permissionset-meta.xml'));
            expect(RecipeCockpitPermissionSetGenerate.buildDeployCommand('SDT_X')).toBe('sf project deploy start --metadata PermissionSet:SDT_X');

        });

        it('resolves the package directory sfdx-project.json marks default, and throws for a project it cannot read', () => {

            expect(RecipeCockpitPermissionSetGenerate.resolveDefaultPackageDirectoryPath(GENERATE_WORKSPACE_ROOT)).toBe(path.join(GENERATE_WORKSPACE_ROOT, 'force-app'));
            expect(() => RecipeCockpitPermissionSetGenerate.resolveDefaultPackageDirectoryPath(path.join(GENERATE_WORKSPACE_ROOT, 'force-app'))).toThrow('No "sfdx-project.json" found');

            const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-generate-project-'));
            try {
                fs.mkdirSync(path.join(temporaryRoot, 'first'));
                fs.mkdirSync(path.join(temporaryRoot, 'second'));
                fs.writeFileSync(path.join(temporaryRoot, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'first' }, { path: 'second' }] }));
                expect(RecipeCockpitPermissionSetGenerate.resolveDefaultPackageDirectoryPath(temporaryRoot)).toBe(path.join(temporaryRoot, 'first'));

                fs.writeFileSync(path.join(temporaryRoot, 'sfdx-project.json'), '{ "packageDirectories": [');
                expect(() => RecipeCockpitPermissionSetGenerate.resolveDefaultPackageDirectoryPath(temporaryRoot)).toThrow('Could not parse');
            } finally {
                fs.rmSync(temporaryRoot, { recursive: true, force: true });
            }

        });

        it('reads each field\'s access from its XML: required and master-detail are not grantable, formula, roll-up and auto number are read-only', async () => {

            const access = (body: string) => RecipeCockpitPermissionSetGenerate.readFieldAccess(`<CustomField>${body}</CustomField>`, 'Custom__c');

            expect(await access('<type>Text</type>')).toBe('editable');
            expect(await access('<type>Text</type><required>true</required>')).toBe('notGrantable');
            expect(await access('<required> TRUE </required>')).toBe('notGrantable');
            expect(await access('<type>MasterDetail</type>')).toBe('notGrantable');
            expect(await access('<type>Number</type><formula>1</formula>')).toBe('readOnly');
            expect(await access('<type>Summary</type>')).toBe('readOnly');
            expect(await access('<type>AutoNumber</type>')).toBe('readOnly');
            expect(await RecipeCockpitPermissionSetGenerate.readFieldAccess('<CustomField></CustomField>', 'Custom__c')).toBe('editable');
            expect(await RecipeCockpitPermissionSetGenerate.readFieldAccess('<CustomField></CustomField>', 'ns__Person__pc')).toBe('editable');
            expect(await RecipeCockpitPermissionSetGenerate.readFieldAccess('<CustomObject><type>Text</type></CustomObject>', 'Custom__c')).toBe('unreadable');
            expect(await RecipeCockpitPermissionSetGenerate.readFieldAccess('<CustomField><type>', 'Custom__c')).toBe('unreadable');
            expect(await RecipeCockpitPermissionSetGenerate.readFieldAccess('', 'Custom__c')).toBe('unreadable');

        });

        it('grants a STANDARD field only when its XML says it is not required, since a retrieve leaves <required> out of a standard field the org requires', async () => {

            const standardAccess = (body: string) => RecipeCockpitPermissionSetGenerate.readFieldAccess(`<CustomField>${body}</CustomField>`, 'LastName');

            expect(await RecipeCockpitPermissionSetGenerate.readFieldAccess('<CustomField></CustomField>', 'LastName')).toBe('requiredUnknown');
            expect(await standardAccess('<fullName>LastName</fullName>')).toBe('requiredUnknown');
            expect(await standardAccess('<type>Picklist</type>')).toBe('requiredUnknown');
            expect(await standardAccess('<required>true</required>')).toBe('notGrantable');
            expect(await standardAccess('<required>false</required><type>Hierarchy</type>')).toBe('editable');
            expect(await standardAccess('<required>false</required><type>AutoNumber</type>')).toBe('readOnly');
            expect(await standardAccess('<required>false</required><type>MasterDetail</type>')).toBe('notGrantable');

        });

        it('grants every object and each grantable field, sorted, and counts what it left out', async () => {

            expect(await RecipeCockpitPermissionSetGenerate.buildPermissionSetPlan(objectsDirectoryPath, ACCOUNT_TREE_OBJECTS)).toEqual(ACCOUNT_TREE_PLAN);

        });

        it('skips and counts a name that is not an api name, and counts every field of an object with no source folder as unreadable', async () => {

            const plan = await RecipeCockpitPermissionSetGenerate.buildPermissionSetPlan(objectsDirectoryPath, [
                { objectApiName: 'Account', fieldApiNames: ['Rating__c', '../Rating__c', 'Rating__c'] },
                { objectApiName: 'Bad Object', fieldApiNames: ['X__c'] },
                { objectApiName: 'Gadget__c', fieldApiNames: ['Size__c'] },
                { objectApiName: 'Account', fieldApiNames: ['Rating__c'] }
            ]);

            expect(plan).toEqual({
                objectApiNames: ['Account', 'Gadget__c'],
                fieldPermissions: [{ field: 'Account.Rating__c', isEditable: true }],
                skippedNameCount: 2,
                unreadableFieldCount: 1,
                notGrantableFieldCount: 0,
                requiredUnknownFieldCount: 0
            });

        });

        it('finds an object folder only within its search depth, and finds nothing under an objects path that is not there', () => {

            const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-generate-walk-'));
            try {
                const deepFolderPath = path.join(temporaryRoot, ...Array.from({ length: 9 }, (_unused, depth) => `level${depth}`), 'Deep__c', 'fields');
                fs.mkdirSync(deepFolderPath, { recursive: true });
                fs.mkdirSync(path.join(temporaryRoot, 'level0', 'Shallow__c', 'fields'), { recursive: true });
                ['zeta', 'alpha', 'mid'].forEach(siblingName => fs.mkdirSync(path.join(temporaryRoot, siblingName)));

                expect([...RecipeCockpitPermissionSetGenerate.findObjectFieldsDirectoryPaths(temporaryRoot, ['Deep__c', 'Shallow__c']).entries()])
                    .toEqual([['Shallow__c', path.join(temporaryRoot, 'level0', 'Shallow__c', 'fields')]]);
                expect(RecipeCockpitPermissionSetGenerate.findObjectFieldsDirectoryPaths(path.join(temporaryRoot, 'missing'), ['Shallow__c']).size).toBe(0);
                expect(RecipeCockpitPermissionSetGenerate.findObjectFieldsDirectoryPaths(temporaryRoot, []).size).toBe(0);

                // AN OBJECT FOLDER IS NEVER WALKED INTO, SO A FOLDER NESTED IN ONE IS NOT AN OBJECT
                fs.mkdirSync(path.join(temporaryRoot, 'level0', 'Shallow__c', 'Nested__c', 'fields'), { recursive: true });
                const readdirSpy = jest.spyOn(fs, 'readdirSync');
                expect(RecipeCockpitPermissionSetGenerate.findObjectFieldsDirectoryPaths(temporaryRoot, ['Nested__c']).size).toBe(0);
                expect(readdirSpy.mock.calls.map(([folderPath]) => String(folderPath))).not.toContain(path.join(temporaryRoot, 'level0', 'Shallow__c', 'Nested__c'));
            } finally {
                fs.rmSync(temporaryRoot, { recursive: true, force: true });
            }

        });

        it('builds the same XML byte for byte whatever order the objects and fields arrive in', async () => {

            const reversedObjects = [...ACCOUNT_TREE_OBJECTS].reverse().map(generateObject => ({ ...generateObject, fieldApiNames: [...generateObject.fieldApiNames].reverse() }));
            const firstXml = RecipeCockpitPermissionSetGenerate.buildPermissionSetXml('Accounts', ACCOUNT_TREE_KEY, await RecipeCockpitPermissionSetGenerate.buildPermissionSetPlan(objectsDirectoryPath, ACCOUNT_TREE_OBJECTS));
            const secondXml = RecipeCockpitPermissionSetGenerate.buildPermissionSetXml('Accounts', ACCOUNT_TREE_KEY, await RecipeCockpitPermissionSetGenerate.buildPermissionSetPlan(objectsDirectoryPath, reversedObjects));

            expect(secondXml).toBe(firstXml);

        });

        it('writes Create and Read only, escapes the label, and parses back as a permission set granting the tree\'s objects', async () => {

            const permissionSetXml = RecipeCockpitPermissionSetGenerate.buildPermissionSetXml('Tom & Jerry <"tree">', ACCOUNT_TREE_KEY, ACCOUNT_TREE_PLAN);

            expect(permissionSetXml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">\n')).toBe(true);
            expect(permissionSetXml).toContain('<label>Tom &amp; Jerry &lt;&quot;tree&quot;&gt;</label>');
            expect(permissionSetXml).toContain([
                '    <objectPermissions>',
                '        <allowCreate>true</allowCreate>',
                '        <allowDelete>false</allowDelete>',
                '        <allowEdit>false</allowEdit>',
                '        <allowRead>true</allowRead>',
                '        <modifyAllRecords>false</modifyAllRecords>',
                '        <object>Account</object>',
                '        <viewAllRecords>false</viewAllRecords>',
                '    </objectPermissions>'
            ].join('\n'));
            expect(permissionSetXml).toContain('        <editable>false</editable>\n        <field>Account.Annual_Budget__c</field>\n        <readable>true</readable>');
            expect(permissionSetXml).not.toContain('Sub_Rating__c');
            expect(permissionSetXml).not.toContain('Contact__c');
            expect(permissionSetXml).not.toContain('LastName');
            expect(permissionSetXml.endsWith('</PermissionSet>\n')).toBe(true);

            expect(await RecipeCockpitPermissionSetAssign.readGrantedObjectApiNames(permissionSetXml)).toIncludeSameMembers([
                'Account', 'Contact', 'OtherChildObject__c', 'Account', 'Account', 'Account', 'Account', 'Account', 'OtherChildObject__c', 'OtherChildObject__c'
            ]);

        });

    });

    describe('routePanelMessage', () => {

        const buildPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            const recipe = loadTreeRecipe();
            panelState.recipeDataMessage = { command: 'recipeData', recipe: recipe, renderSequence: 3 };
            panelState.acknowledgedRenderSequence = 3;
            panelState.treeHistoryAllowLists.nameableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            return panelState;
        };

        const generateMessage = { command: 'generateTreePermissionSet', treeKey: ACCOUNT_TREE_KEY };

        it('routes the tree key alone, and nothing a forged message adds', () => {

            expect(RecipeCockpitService.routePanelMessage(generateMessage, buildPanelState())).toEqual({ kind: 'generateTreePermissionSet', treeKey: ACCOUNT_TREE_KEY });
            expect(RecipeCockpitService.routePanelMessage({ ...generateMessage, filePath: '/etc/passwd', name: 'Evil' } as any, buildPanelState()))
                .toEqual({ kind: 'generateTreePermissionSet', treeKey: ACCOUNT_TREE_KEY });

        });

        it('routes nothing for a key no drawn card names, a non-string key, or no model on screen', () => {

            expect(RecipeCockpitService.routePanelMessage({ ...generateMessage, treeKey: 'Lead-ONLY' }, buildPanelState())).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ ...generateMessage, treeKey: 7 } as any, buildPanelState())).toBeUndefined();

            const panelState = buildPanelState();
            panelState.recipeDataMessage = undefined;
            expect(RecipeCockpitService.routePanelMessage(generateMessage, panelState)).toBeUndefined();

            const notDrawn = buildPanelState();
            notDrawn.treeHistoryAllowLists.nameableTreeKeys = new Set();
            expect(RecipeCockpitService.routePanelMessage(generateMessage, notDrawn)).toBeUndefined();

        });

        it('routes nothing while a recipe write or a permission set assignment holds the window, and is not held by a scratch org run (#358)', () => {

            const writing = buildPanelState();
            writing.wireLookupStateMessage = { command: 'wireLookupState', isRunning: true };
            expect(RecipeCockpitService.routePanelMessage(generateMessage, writing)).toBeUndefined();

            const creating = buildPanelState();
            creating.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true };
            expect(RecipeCockpitService.routePanelMessage(generateMessage, creating)).toEqual({ kind: 'generateTreePermissionSet', treeKey: ACCOUNT_TREE_KEY });

            const assigning = buildPanelState();
            assigning.permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };
            expect(RecipeCockpitService.routePanelMessage(generateMessage, assigning)).toBeUndefined();

        });

        it('routes nothing for a tree whose every object is excluded', () => {

            const panelState = buildPanelState();
            const tree = panelState.recipeDataMessage!.recipe.trees.find(recipeTree => recipeTree.treeKey === ACCOUNT_TREE_KEY)!;
            jest.spyOn(RecipeCockpitService, 'listTreeInsertObjectApiNames').mockImplementation((_recipe, recipeTree) => recipeTree === tree ? [] : ['Account']);

            expect(RecipeCockpitService.routePanelMessage(generateMessage, panelState)).toBeUndefined();

        });

    });

    describe('the host', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let modalAnswer: string | undefined;
        let informationAnswer: string | undefined;
        let workspaceState: { get: jest.Mock; update: jest.Mock };

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const generatedFilePath = () => path.join(workspaceRoot, ...ACCOUNT_TREE_FILE_PATH.split('/'));
        const modalCalls = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.filter(([, options]) => options?.modal);
        const warningTexts = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.filter(([, options]) => !options?.modal).map(([warningText]) => warningText as string);
        const informationCalls = () => (vscode.window.showInformationMessage as jest.Mock).mock.calls;

        const openCockpit = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
        };

        const generate = async (treeKey: string = ACCOUNT_TREE_KEY) => {
            await receivedMessageHandler({ command: 'generateTreePermissionSet', treeKey: treeKey });
            await flushAsyncWork();
            await flushAsyncWork();
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-generate-permission-set-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.cpSync(GENERATE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });

            postedPanelMessages = [];
            modalAnswer = RECIPE_COCKPIT_GENERATE_PERMISSION_SET_CONFIRM_LABEL;
            informationAnswer = undefined;
            workspaceState = { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) };
            (RecipeCockpitService as any).isPermissionSetGenerateInFlight = false;
            (RecipeCockpitService as any).isPermissionSetAssignInFlight = false;
            (RecipeCockpitService as any).permissionSetAssignRunStateMessage = undefined;
            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

            (execFile as unknown as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_message: string, options: any) => options?.modal ? modalAnswer : undefined);
            (vscode.window.showInformationMessage as jest.Mock).mockReset();
            (vscode.window.showInformationMessage as jest.Mock).mockImplementation(async () => informationAnswer);
            (vscode.env.clipboard.writeText as jest.Mock).mockReset();

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

            jest.spyOn(ConfigurationService, 'getObjectsPathFromTreecipeJSONConfiguration').mockReturnValue(OBJECTS_PATH);
            jest.spyOn(VSCodeWorkspaceService, 'createStatusBarPhaseItem').mockImplementation(() => ({ text: '', dispose: jest.fn() }) as any);
            jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation((warningText: string) => { vscode.window.showWarningMessage(warningText); });
            jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);

        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('asks in a modal that names the file and says nothing is deployed, then writes the permission set into the default package directory', async () => {

            await openCockpit();
            await generate();

            expect(modalCalls()).toHaveLength(1);
            const [modalText, modalOptions, confirmLabel] = modalCalls()[0];
            expect(modalText).toContain(`Write the permission set ${ACCOUNT_TREE_PERMISSION_SET_NAME}`);
            expect(modalOptions.detail).toContain(`File: ${ACCOUNT_TREE_FILE_PATH}`);
            expect(modalOptions.detail).toContain('Grants Create and Read on 3 objects and access to 7 fields');
            expect(modalOptions.detail).toContain('It will not be deployed');
            expect(confirmLabel).toBe(RECIPE_COCKPIT_GENERATE_PERMISSION_SET_CONFIRM_LABEL);

            const writtenXml = fs.readFileSync(generatedFilePath(), 'utf8');
            expect(writtenXml).toBe(RecipeCockpitPermissionSetGenerate.buildPermissionSetXml(
                RecipeCockpitPermissionSetGenerate.buildPermissionSetLabel(writtenXml.match(/<label>(.*)<\/label>/)![1], ''),
                ACCOUNT_TREE_KEY,
                ACCOUNT_TREE_PLAN
            ));
            expect(fs.existsSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'permissionsets', `${ACCOUNT_TREE_PERMISSION_SET_NAME}.permissionset-meta.xml`))).toBe(false);
            expect(fs.existsSync(path.join(workspaceRoot, 'unpackaged', 'main'))).toBe(false);

            expect(informationCalls()).toHaveLength(1);
            const [informationText, ...actions] = informationCalls()[0];
            expect(informationText).toContain(`Wrote ${ACCOUNT_TREE_PERMISSION_SET_NAME} to ${ACCOUNT_TREE_FILE_PATH}`);
            expect(informationText).toContain('2 required or master-detail fields, which Salesforce does not take in a permission set');
            expect(informationText).toContain('2 fields whose source file could not be read');
            expect(informationText).toContain('1 standard field without <required>false</required> in its source file');
            expect(actions).toEqual([RECIPE_COCKPIT_GENERATE_PERMISSION_SET_OPEN_LABEL, RECIPE_COCKPIT_GENERATE_PERMISSION_SET_COPY_LABEL, RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL]);

            expect(execFile).not.toHaveBeenCalled();

        });

        it('writes a file the assign button then offers, from the package directories it reads', async () => {

            await openCockpit();
            await generate();

            const discovery = await RecipeCockpitPermissionSetAssign.discoverPermissionSets(['Account'], workspaceRoot, ['unpackaged', 'force-app']);
            expect(discovery.permissionSets.map(permissionSet => [permissionSet.name, permissionSet.relativeFilePath])).toEqual([[ACCOUNT_TREE_PERMISSION_SET_NAME, ACCOUNT_TREE_FILE_PATH]]);

        });

        it('says it will overwrite a file that is already there, and writes nothing on Cancel', async () => {

            fs.mkdirSync(path.dirname(generatedFilePath()), { recursive: true });
            fs.writeFileSync(generatedFilePath(), 'hand edited');
            modalAnswer = undefined;

            await openCockpit();
            await generate();

            expect(modalCalls()[0][0]).toContain('Overwrite the permission set');
            expect(modalCalls()[0][1].detail).toContain('will be overwritten');
            expect(fs.readFileSync(generatedFilePath(), 'utf8')).toBe('hand edited');
            expect(informationCalls()).toHaveLength(0);

        });

        it('copies the deploy command and runs nothing, and opens the file it wrote', async () => {

            informationAnswer = RECIPE_COCKPIT_GENERATE_PERMISSION_SET_COPY_LABEL;
            await openCockpit();
            await generate();

            expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(`sf project deploy start --metadata PermissionSet:${ACCOUNT_TREE_PERMISSION_SET_NAME}`);
            expect(execFile).not.toHaveBeenCalled();

            informationAnswer = RECIPE_COCKPIT_GENERATE_PERMISSION_SET_OPEN_LABEL;
            await generate();

            expect(VSCodeWorkspaceService.openFileInEditor).toHaveBeenCalledWith(generatedFilePath());

        });

        it('starts the assign flow through the router when its button is chosen', async () => {

            informationAnswer = RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL;
            const assignSpy = jest.spyOn(RecipeCockpitService as any, 'assignTreePermissionSetsFromPanel').mockResolvedValue(undefined);
            const routeSpy = jest.spyOn(RecipeCockpitService, 'routePanelMessage');

            await openCockpit();
            (RecipeCockpitService as any).recipeCockpitPanelState.assignableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            await generate();

            expect(routeSpy).toHaveBeenCalledWith({ command: 'assignTreePermissionSets', treeKey: ACCOUNT_TREE_KEY }, expect.anything());
            expect(assignSpy).toHaveBeenCalledWith(expect.anything(), ACCOUNT_TREE_KEY, false);

        });

        it('refuses with a warning and writes nothing when sfdx-project.json is missing', async () => {

            fs.rmSync(path.join(workspaceRoot, 'sfdx-project.json'));
            await openCockpit();
            await generate();

            expect(warningTexts().at(-1)).toContain('No permission set was written for');
            expect(warningTexts().at(-1)).toContain('No "sfdx-project.json" found');
            expect(modalCalls()).toHaveLength(0);
            expect(fs.existsSync(generatedFilePath())).toBe(false);

        });

        it('refuses with a warning and writes nothing when sfdx-project.json cannot be parsed', async () => {

            fs.writeFileSync(path.join(workspaceRoot, 'sfdx-project.json'), '{ "packageDirectories": [');
            await openCockpit();
            await generate();

            expect(warningTexts().at(-1)).toContain('No permission set was written for');
            expect(warningTexts().at(-1)).toContain('Could not parse');
            expect(modalCalls()).toHaveLength(0);
            expect(fs.existsSync(generatedFilePath())).toBe(false);

        });

        it('refuses an objects path outside the workspace before reading anything', async () => {

            (ConfigurationService.getObjectsPathFromTreecipeJSONConfiguration as jest.Mock).mockReturnValue('../../elsewhere');
            await openCockpit();
            await generate();

            expect(warningTexts().at(-1)).toContain('"salesforceObjectsPath" in treecipe.config.json is "../../elsewhere", which is outside this workspace');
            expect(fs.existsSync(generatedFilePath())).toBe(false);

        });

        it('refuses to write through a permissionsets folder linked out of the workspace', async () => {

            const outsideFolderPath = path.join(temporaryRoot, 'outside');
            fs.mkdirSync(outsideFolderPath);
            fs.mkdirSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'permissionsets'), { recursive: true });
            fs.symlinkSync(outsideFolderPath, path.join(workspaceRoot, 'force-app', 'main', 'default', 'permissionsets', 'SDT_Treecipe'), 'dir');

            await openCockpit();
            await generate();

            expect(warningTexts().at(-1)).toContain('is not inside this workspace');
            expect(fs.readdirSync(outsideFolderPath)).toEqual([]);

        });

        it('refuses a folder name that makes no permission set name, and writes nothing', async () => {

            jest.spyOn(RecipeCockpitPermissionSetGenerate, 'buildPermissionSetName').mockReturnValue(undefined);
            await openCockpit();
            await generate();

            expect(warningTexts().at(-1)).toContain('does not make a permission set name');
            expect(modalCalls()).toHaveLength(0);

        });

        it('refuses a tree none of whose objects has an api name', async () => {

            jest.spyOn(RecipeCockpitPermissionSetGenerate, 'buildPermissionSetPlan').mockResolvedValue({ objectApiNames: [], fieldPermissions: [], skippedNameCount: 3, unreadableFieldCount: 0, notGrantableFieldCount: 0, requiredUnknownFieldCount: 0 });
            await openCockpit();
            await generate();

            expect(warningTexts().at(-1)).toContain('none of its objects has an api name');
            expect(modalCalls()).toHaveLength(0);

        });

        it('reports a write that fails, and ignores a second generate while one is in flight or a tree the model does not hold', async () => {

            jest.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => { throw new Error('EACCES: permission denied'); });
            await openCockpit();
            await generate();

            expect(warningTexts().at(-1)).toContain('EACCES: permission denied');
            expect(informationCalls()).toHaveLength(0);

            (RecipeCockpitService as any).isPermissionSetGenerateInFlight = true;
            await (RecipeCockpitService as any).generateTreePermissionSetFromPanel((RecipeCockpitService as any).recipeCockpitPanel, ACCOUNT_TREE_KEY);
            (RecipeCockpitService as any).isPermissionSetGenerateInFlight = false;
            await (RecipeCockpitService as any).generateTreePermissionSetFromPanel((RecipeCockpitService as any).recipeCockpitPanel, 'Not-A-Tree');

            expect(modalCalls()).toHaveLength(1);

        });

        it('makes no folder at all under a permissionsets folder linked out of the workspace', async () => {

            const outsideFolderPath = path.join(temporaryRoot, 'outside');
            fs.mkdirSync(outsideFolderPath);
            fs.symlinkSync(outsideFolderPath, path.join(workspaceRoot, 'force-app', 'main', 'default', 'permissionsets'), 'dir');

            await openCockpit();
            await generate();

            expect(warningTexts().at(-1)).toContain('is not inside this workspace');
            expect(fs.readdirSync(outsideFolderPath)).toEqual([]);

        });

        it('checks the folder again once it is made, and writes nothing if it then resolves out of the workspace', async () => {

            const permissionSetFolderPath = path.dirname(generatedFilePath());
            const isContained = SfdxProjectService.isPathContainedInWorkspace.bind(SfdxProjectService);
            jest.spyOn(SfdxProjectService, 'isPathContainedInWorkspace').mockImplementation((candidatePath, ...rest) => candidatePath === permissionSetFolderPath ? false : isContained(candidatePath, ...rest));

            await openCockpit();
            await generate();

            expect(warningTexts().at(-1)).toContain('is not inside this workspace');
            expect(fs.existsSync(generatedFilePath())).toBe(false);

        });

        it('leaves alone a folder, or a link, that sits where the file goes', async () => {

            fs.mkdirSync(generatedFilePath(), { recursive: true });
            await openCockpit();
            await generate();

            expect(warningTexts().at(-1)).toContain('exists and is not a file');
            expect(fs.lstatSync(generatedFilePath()).isDirectory()).toBe(true);

        });

        it('writes nothing when an assignment started while the modal was open', async () => {

            await openCockpit();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_message: string, options: any) => {
                if ( options?.modal ) {
                    (RecipeCockpitService as any).recipeCockpitPanelState.permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };
                    return modalAnswer;
                }
                return undefined;
            });
            await generate();

            expect(warningTexts().at(-1)).toContain('started meanwhile');
            expect(fs.existsSync(generatedFilePath())).toBe(false);

        });

        it('words its counts for one and for none, and says nothing was left out when nothing was', async () => {

            const buildPlan = jest.spyOn(RecipeCockpitPermissionSetGenerate, 'buildPermissionSetPlan');
            buildPlan.mockResolvedValueOnce({ objectApiNames: ['Account'], fieldPermissions: [{ field: 'Account.Rating__c', isEditable: true }], skippedNameCount: 1, unreadableFieldCount: 1, notGrantableFieldCount: 1, requiredUnknownFieldCount: 1 });
            buildPlan.mockResolvedValueOnce({ objectApiNames: ['Account', 'Contact'], fieldPermissions: [], skippedNameCount: 0, unreadableFieldCount: 0, notGrantableFieldCount: 0, requiredUnknownFieldCount: 0 });

            await openCockpit();
            await generate();
            await generate();

            expect(informationCalls()[0][0]).toContain('Create and Read on 1 object, access to 1 field. Left out: 1 required or master-detail field, which Salesforce does not take in a permission set; 1 standard field without <required>false</required> in its source file; 1 field whose source file could not be read; 1 invalid api name.');
            expect(informationCalls()[1][0]).toContain('Create and Read on 2 objects, access to 0 fields. Deploy it, then assign it.');

        });

        it('does nothing with no model on screen', async () => {

            await openCockpit();
            (RecipeCockpitService as any).recipeCockpitPanelState.recipeDataMessage = undefined;
            await (RecipeCockpitService as any).generateTreePermissionSetFromPanel((RecipeCockpitService as any).recipeCockpitPanel, ACCOUNT_TREE_KEY);

            expect(modalCalls()).toHaveLength(0);
            expect(warningTexts()).toEqual([]);

        });

        it('hands the assign flow the org selected above, when there is one', async () => {

            informationAnswer = RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL;
            const routePanelMessage = RecipeCockpitService.routePanelMessage.bind(RecipeCockpitService);
            const routeSpy = jest.spyOn(RecipeCockpitService, 'routePanelMessage')
                .mockImplementation((panelMessage, panelState) => panelMessage.command === 'assignTreePermissionSets' ? undefined : routePanelMessage(panelMessage, panelState));

            await openCockpit();
            (RecipeCockpitService as any).recipeCockpitPanelState.dataOrgSelection = { orgIndex: 2 };
            await generate();

            expect(routeSpy).toHaveBeenCalledWith({ command: 'assignTreePermissionSets', treeKey: ACCOUNT_TREE_KEY, orgIndex: 2 }, expect.anything());

        });

        it('writes nothing when an assignment or a recipe write started while the modal was open', async () => {

            for ( const startedState of [
                { permissionSetAssignStateMessage: { command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY } },
                { wireLookupStateMessage: { command: 'wireLookupState', isRunning: true } }
            ] ) {
                (RecipeCockpitService as any).recipeCockpitPanel = undefined;
                await openCockpit();
                (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_message: string, options: any) => {
                    if ( options?.modal ) {
                        Object.assign((RecipeCockpitService as any).recipeCockpitPanelState, startedState);
                        return modalAnswer;
                    }
                    return undefined;
                });
                await generate();

                expect(warningTexts().at(-1)).toContain('started meanwhile');
                expect(fs.existsSync(generatedFilePath())).toBe(false);
            }

        });

        it('still writes when a field\'s source file cannot be read, and counts it', async () => {

            fs.writeFileSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields', 'Rating__c.field-meta.xml'), '<CustomField><type>');
            await openCockpit();
            await generate();

            expect(fs.readFileSync(generatedFilePath(), 'utf8')).not.toContain('Account.Rating__c');
            expect(informationCalls()[0][0]).toContain('3 fields whose source file could not be read');

        });

    });

    describe('the panel script', () => {

        const cardOf = (panel: ReturnType<typeof runPanelScript>, objectApiName: string) => panel.treeCards()
            .find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes(objectApiName)));

        const renderTrees = (recipe = loadTreeRecipe()) => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: recipe, renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            return panel;
        };

        const generateButtonOf = (panel: ReturnType<typeof runPanelScript>, objectApiName = 'OtherChildObject__c') => panel.findAll(cardOf(panel, objectApiName), 'treeGeneratePermissionSet')[0];

        it('draws the button beside the assign button on every card with a folder, and posts the tree key alone', () => {

            const panel = renderTrees();
            const generateButton = generateButtonOf(panel);

            expect(RECIPE_COCKPIT_GENERATE_PERMISSION_SET_ACTION_LABEL).toBe('Generate permission set…');
            expect(generateButton.textContent).toBe('Generate permission set…');
            expect(generateButton.disabled).toBe(false);
            expect(generateButtonOf(panel, 'Lead')).toBeDefined();
            const controlChildren = panel.findAll(cardOf(panel, 'OtherChildObject__c'), 'treePermissionSetControls')[0].children;
            // THE ASSIGN BUTTON, THIS ONE, THEN "Retrieve validation rules…" (#326)
            expect(controlChildren).toHaveLength(3);
            expect(controlChildren[0] === panel.findAll(cardOf(panel, 'OtherChildObject__c'), 'treePermissionSets')[0]).toBe(true);
            expect(controlChildren[1] === generateButton).toBe(true);
            expect(controlChildren[2].className).toBe('treeRetrieveValidationRules');

            generateButton.dispatch('click');

            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'generateTreePermissionSet', treeKey: ACCOUNT_TREE_KEY });

        });

        it('is disabled while permission sets are assigned or a scratch org is set up', () => {

            const panel = renderTrees();

            panel.postToPanel({ command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY });
            expect(generateButtonOf(panel).disabled).toBe(true);
            expect(generateButtonOf(panel).attributes.title).toBe('Permission sets are being assigned.');

            panel.postToPanel({ command: 'permissionSetAssignState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });
            expect(generateButtonOf(panel).disabled).toBe(false);

        });

        it('is disabled, with the reason, when every object of the tree is excluded', () => {

            const recipe = loadTreeRecipe();
            const tree = recipe.trees.find(recipeTree => recipeTree.treeKey === 'Lead-ONLY')!;
            tree.objectSelection = {
                exclusions: [{ objectApiName: 'Lead', kind: 'excluded' }],
                disabledLookups: [],
                includedObjectCount: 0,
                objectCount: 1
            } as any;
            const panel = renderTrees(recipe);

            expect(generateButtonOf(panel, 'Lead').disabled).toBe(true);
            expect(generateButtonOf(panel, 'Lead').attributes.title).toBe('Every object of this tree is excluded, so there is nothing to grant.');
            expect(generateButtonOf(panel).disabled).toBe(false);

        });

        it('is named in the preview warning, which still says nothing is deployed', () => {

            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('"Generate permission set…" writes a permission set granting Create and Read');
            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('deploys nothing either');

        });

    });

    it('builds no deploy argv anywhere on the generate path', () => {

        const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitService.ts'), 'utf8');
        const generateSource = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitPermissionSetGenerate.ts'), 'utf8');
        const generatePath = serviceSource.slice(serviceSource.indexOf('private static async generateTreePermissionSetFromPanel'), serviceSource.indexOf('private static async promptForPermissionSetOrg'));

        expect(generatePath.length).toBeGreaterThan(0);
        [generatePath, generateSource].forEach(source => {
            expect(source).not.toMatch(/['"]deploy['"]/);
            expect(source).not.toContain('runSalesforceCli');
            expect(source).not.toContain('runCancellableCli');
        });

    });

});

function loadTreeRecipe() {
    const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
    return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, 'recipe-2026-09-20T10-00-00').recipeViewModel;
}
