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

import { AuthInfo } from '@salesforce/core';
import { execFile } from 'child_process';

import {
    IRecipeCockpitPanelState,
    RecipeCockpitService,
    RECIPE_COCKPIT_DATA_ORG_STATE_KEY,
    RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL,
    RECIPE_COCKPIT_PERMISSION_SET_CONFIRM_LABEL,
    RECIPE_COCKPIT_PERMISSION_SET_ORG_PLACEHOLDER,
    RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL,
    RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL
} from '../RecipeCockpitService';
import { PERMISSION_SET_MAX_PICKS, RecipeCockpitPermissionSetAssign } from '../RecipeCockpitPermissionSetAssign';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { ORG_OPERATIONS_FOLDER_NAME } from '../../ScratchOrgService/ScratchOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { PicklistDependencyCheckService } from '../../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const PERMISSION_SET_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'permissionSetWorkspace');
const SALESFORCE_ORG_MOCKS_PATH = path.join(__dirname, '..', '..', 'SalesforceOrgService', 'tests', 'mocks');

const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, 'utf-8'));
const SF_ORG_LIST = readJson(path.join(SALESFORCE_ORG_MOCKS_PATH, 'sfOrgListVerbose.json'));
const ORG_AUTHORIZATIONS = readJson(path.join(SALESFORCE_ORG_MOCKS_PATH, 'orgAuthorizations.json'));

const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
// THE OBJECTS THE ACCOUNT CARD LISTS: User IS A LOOKUP TARGET WITH NO RECIPE
const ACCOUNT_TREE_OBJECTS = ['Account', 'Contact', 'OtherChildObject__c'];
const QA_USERNAME = 'qa@example.com.qa';

const ACCOUNT_TREE_ACCESS_PATH = 'force-app/main/default/permissionsets/Account_Tree_Access.permissionset-meta.xml';
const CONTACT_READER_PATH = 'unpackaged/permissionsets/Contact_Reader.permissionset-meta.xml';

const invocation = (stdout: string, extra: Record<string, unknown> = {}) => ({ stdout: stdout, stderr: '', exitCode: 0, ...extra });

const buildAssignAnswer = (successNames: string[], failures: Array<{ name?: string; message: string }> = []) => JSON.stringify({
    status: failures.length === 0 ? 0 : 1,
    result: {
        successes: successNames.map(successName => ({ name: QA_USERNAME, value: successName })),
        failures: failures
    }
});

describe('RecipeCockpitService, "Assign permission sets to me…" in the Treecipe tab (#274, #302)', () => {

    describe('RecipeCockpitPermissionSetAssign', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;

        beforeEach(() => {
            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-permission-sets-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(PERMISSION_SET_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        const permissionSetsFolderPath = () => path.join(workspaceRoot, 'force-app', 'main', 'default', 'permissionsets');
        const discover = (objectApiNames: string[] = ACCOUNT_TREE_OBJECTS, packageDirectoryPaths = ['force-app', 'unpackaged']) =>
            RecipeCockpitPermissionSetAssign.discoverPermissionSets(objectApiNames, workspaceRoot, packageDirectoryPaths);

        it('offers the permission sets whose object or field permissions name any of the tree\'s objects, case-insensitively, with what each covers in the tree\'s order', async () => {

            expect(await discover()).toEqual({
                permissionSets: [
                    { name: 'Account_Tree_Access', relativeFilePath: ACCOUNT_TREE_ACCESS_PATH, coveredObjectApiNames: ['Account', 'OtherChildObject__c'], grantedObjectApiNames: ['OtherChildObject__c', 'Account'] },
                    { name: 'Contact_Reader', relativeFilePath: CONTACT_READER_PATH, coveredObjectApiNames: ['Contact'], grantedObjectApiNames: ['contact'] }
                ],
                unparseableFilePaths: [],
                notApiNameFilePaths: []
            });

        });

        it('offers nothing for a tree no permission set covers, and looks only in the package directories it is given', async () => {

            expect((await discover(['Lead'])).permissionSets).toEqual([]);
            expect((await discover(ACCOUNT_TREE_OBJECTS, ['force-app'])).permissionSets.map(permissionSet => permissionSet.name)).toEqual(['Account_Tree_Access']);
            expect((await discover(['Gadget__c'])).permissionSets.map(permissionSet => permissionSet.name)).toEqual(['Gadget_Access']);

        });

        it('skips, and lists for a warning, a file that is not XML or not a PermissionSet, and a file name that is not an api name', async () => {

            fs.writeFileSync(path.join(permissionSetsFolderPath(), 'Broken.permissionset-meta.xml'), '<PermissionSet><objectPermissions>');
            fs.writeFileSync(path.join(permissionSetsFolderPath(), 'Profile_Shaped.permissionset-meta.xml'), '<Profile><objectPermissions><object>Account</object></objectPermissions></Profile>');
            fs.writeFileSync(path.join(permissionSetsFolderPath(), 'Bad-Name.permissionset-meta.xml'), '<PermissionSet><objectPermissions><object>Account</object></objectPermissions></PermissionSet>');

            const discovery = await discover();

            expect(discovery.permissionSets.map(permissionSet => permissionSet.name)).toEqual(['Account_Tree_Access', 'Contact_Reader']);
            expect(discovery.unparseableFilePaths).toEqual([
                'force-app/main/default/permissionsets/Broken.permissionset-meta.xml',
                'force-app/main/default/permissionsets/Profile_Shaped.permissionset-meta.xml'
            ]);
            expect(discovery.notApiNameFilePaths).toEqual(['force-app/main/default/permissionsets/Bad-Name.permissionset-meta.xml']);

        });

        it('reads an empty permission set as granting nothing, and malformed permission entries as nothing', async () => {

            expect(await RecipeCockpitPermissionSetAssign.readGrantedObjectApiNames('<PermissionSet></PermissionSet>')).toEqual([]);
            expect(await RecipeCockpitPermissionSetAssign.readGrantedObjectApiNames('<PermissionSet xmlns="x"/>')).toEqual([]);
            expect(await RecipeCockpitPermissionSetAssign.readGrantedObjectApiNames('<PermissionSet><objectPermissions><object><x>1</x></object></objectPermissions><fieldPermissions><field> </field></fieldPermissions></PermissionSet>')).toEqual([]);
            expect(await RecipeCockpitPermissionSetAssign.readGrantedObjectApiNames('<PermissionSet><objectPermissions>text</objectPermissions><objectPermissions><allowRead>true</allowRead></objectPermissions></PermissionSet>')).toEqual([]);
            expect(await RecipeCockpitPermissionSetAssign.readGrantedObjectApiNames('')).toBeUndefined();

        });

        it('offers a name two package directories both hold once, from the first', async () => {

            fs.mkdirSync(path.join(workspaceRoot, 'unpackaged', 'permissionsets'), { recursive: true });
            fs.copyFileSync(path.join(permissionSetsFolderPath(), 'Account_Tree_Access.permissionset-meta.xml'), path.join(workspaceRoot, 'unpackaged', 'permissionsets', 'account_tree_access.permissionset-meta.xml'));

            const discovery = await discover();

            expect(discovery.permissionSets.map(permissionSet => permissionSet.relativeFilePath)).toEqual([ACCOUNT_TREE_ACCESS_PATH, CONTACT_READER_PATH]);

        });

        it('never reads a permission set file that resolves outside the workspace, nor a package directory outside it', async () => {

            const outsideFolderPath = path.join(temporaryRoot, 'outside');
            fs.mkdirSync(outsideFolderPath);
            fs.writeFileSync(path.join(outsideFolderPath, 'Outside_Access.permissionset-meta.xml'), '<PermissionSet><objectPermissions><object>Account</object></objectPermissions></PermissionSet>');
            fs.symlinkSync(path.join(outsideFolderPath, 'Outside_Access.permissionset-meta.xml'), path.join(permissionSetsFolderPath(), 'Outside_Access.permissionset-meta.xml'));

            expect((await discover()).permissionSets.map(permissionSet => permissionSet.name)).toEqual(['Account_Tree_Access', 'Contact_Reader']);
            expect((await discover(ACCOUNT_TREE_OBJECTS, ['../outside'])).permissionSets).toEqual([]);

        });

        it('walks a package directory listed twice once, and treats one that cannot be read as holding nothing', async () => {

            expect((await discover(ACCOUNT_TREE_OBJECTS, ['force-app', 'force-app', 'missing'])).permissionSets.map(permissionSet => permissionSet.name)).toEqual(['Account_Tree_Access']);

        });

        it('marks a permission set that covers only some of the tree as partial', () => {

            const permissionSet = { name: 'Account_Tree_Access', relativeFilePath: ACCOUNT_TREE_ACCESS_PATH, coveredObjectApiNames: ['Account', 'OtherChildObject__c'], grantedObjectApiNames: ['Account', 'OtherChildObject__c'] };

            expect(RecipeCockpitPermissionSetAssign.describeCoverage(permissionSet, 3)).toBe('partial, 2 of 3: Account, OtherChildObject__c');
            expect(RecipeCockpitPermissionSetAssign.describeCoverage(permissionSet, 2)).toBe('covers all 2 of the tree\'s objects: Account, OtherChildObject__c');

        });

        it('builds the assign argv with one --name per pick and the username as --target-org, and no deploy argv at all', () => {

            expect(RecipeCockpitPermissionSetAssign.buildPermissionSetAssignArguments(['Account_Tree_Access', 'Contact_Reader'], QA_USERNAME)).toEqual([
                'org', 'assign', 'permset', '--json', '--target-org', QA_USERNAME,
                '--name', 'Account_Tree_Access', '--name', 'Contact_Reader'
            ]);
            expect(RecipeCockpitPermissionSetAssign.buildPermissionSetAssignArguments(['A'], QA_USERNAME)).not.toContain('--on-behalf-of');
            expect(RecipeCockpitPermissionSetAssign).not.toHaveProperty('buildPermissionSetDeployArguments');
            expect(RecipeCockpitPermissionSetAssign).not.toHaveProperty('parsePermissionSetDeployOutput');

        });

        it('refuses a name that is not an api name, no name at all, and an org identifier that could be read as a flag, before any argv', () => {

            expect(() => RecipeCockpitPermissionSetAssign.buildPermissionSetAssignArguments(['Ok', 'X --on-behalf-of'], QA_USERNAME)).toThrow('is not a Salesforce api name, so nothing was assigned.');
            expect(() => RecipeCockpitPermissionSetAssign.buildPermissionSetAssignArguments(['-onbehalfof'], QA_USERNAME)).toThrow('is not a Salesforce api name');
            expect(() => RecipeCockpitPermissionSetAssign.buildPermissionSetAssignArguments([], QA_USERNAME)).toThrow('No permission set was named, so nothing was assigned.');
            expect(() => RecipeCockpitPermissionSetAssign.buildPermissionSetAssignArguments(['Ok'], '--target-org')).toThrow();

        });

        it('splits the picks by whether the org holds them, case-insensitively and in the order picked', () => {

            const pick = (name: string) => ({ name: name, relativeFilePath: `${name}.permissionset-meta.xml`, coveredObjectApiNames: ['Account'], grantedObjectApiNames: ['Account'] });

            const presence = RecipeCockpitPermissionSetAssign.partitionByOrgPresence([pick('B_Set'), pick('A_Set'), pick('C_Set')], ['a_set', 'C_SET', 'Unrelated']);

            expect(presence.presentPermissionSets.map(permissionSet => permissionSet.name)).toEqual(['A_Set', 'C_Set']);
            expect(presence.missingPermissionSets.map(permissionSet => permissionSet.name)).toEqual(['B_Set']);
            expect(RecipeCockpitPermissionSetAssign.partitionByOrgPresence([pick('A_Set')], []).missingPermissionSets).toHaveLength(1);

        });

        it('tells the reader to deploy what the org does not hold, in the singular and the plural', () => {

            expect(RecipeCockpitPermissionSetAssign.buildMissingPermissionSetsMessage(['Gadget_Access'], 'qa · qa@example.com'))
                .toBe('Not in qa · qa@example.com: Gadget_Access. Deploy this permission set to the org, then assign it.');
            expect(RecipeCockpitPermissionSetAssign.buildMissingPermissionSetsMessage(['A', 'B'], 'qa'))
                .toBe('Not in qa: A, B. Deploy these permission sets to the org, then assign them.');

        });

        it('reads an assignment of every pick as assigned', () => {

            expect(RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(invocation(buildAssignAnswer(['A', 'B'])), ['A', 'B']))
                .toEqual({ kind: 'assigned', assignedNames: ['A', 'B'], alreadyAssignedNames: [] });

        });

        it('counts a permission set the user already holds as assigned, whether or not the failure names it', () => {

            expect(RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(
                invocation(buildAssignAnswer(['A'], [{ name: 'B', message: 'Duplicate PermissionSetAssignment. Assignee: 005x, PermissionSet: 0PSx' }]), { exitCode: 1 }),
                ['A', 'B']
            )).toEqual({ kind: 'assigned', assignedNames: ['A'], alreadyAssignedNames: ['B'] });

            expect(RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(
                invocation(buildAssignAnswer([], [
                    { name: QA_USERNAME, message: 'Duplicate PermissionSetAssignment. Assignee: 005x, PermissionSet: 0PSa' },
                    { name: QA_USERNAME, message: 'Duplicate PermissionSetAssignment. Assignee: 005x, PermissionSet: 0PSb' }
                ]), { exitCode: 1 }),
                ['A', 'B']
            )).toEqual({ kind: 'assigned', assignedNames: [], alreadyAssignedNames: ['A', 'B'] });

        });

        it('names which picks failed in a partial assignment, and what the CLI said', () => {

            expect(RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(
                invocation(buildAssignAnswer(['A'], [{ name: QA_USERNAME, message: 'Permission set "B" not found in target org.' }]), { exitCode: 1 }),
                ['A', 'B']
            )).toEqual({ kind: 'notAllAssigned', assignedNames: ['A'], alreadyAssignedNames: [], failedNames: ['B'], failureMessages: ['Permission set "B" not found in target org.'] });

            // A FAILURE NAMING NO PICK IS MATCHED TO THE PICKS NOTHING ACCOUNTED FOR, AND NEVER READ AS A SUCCESS
            expect(RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(
                invocation(buildAssignAnswer(['A'], [{ name: QA_USERNAME, message: 'insufficient access' }]), { exitCode: 1 }),
                ['A', 'B', 'C']
            )).toEqual({ kind: 'notAllAssigned', assignedNames: ['A'], alreadyAssignedNames: [], failedNames: ['B', 'C'], failureMessages: ['insufficient access'] });

            // A NAME THAT ONLY PREFIXES ANOTHER IS NOT A MATCH
            expect(RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(
                invocation(buildAssignAnswer([], [{ message: 'Permission set "Access_Plus" not found' }]), { exitCode: 1 }),
                ['Access', 'Access_Plus']
            )).toMatchObject({ failedNames: ['Access_Plus', 'Access'] });

        });

        it('never reads a pick the answer does not account for as assigned, nor a malformed answer as a success', () => {

            expect(RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(invocation(buildAssignAnswer(['A'])), ['A', 'B']))
                .toMatchObject({ kind: 'notAllAssigned', assignedNames: ['A'], failedNames: ['B'] });
            expect(RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(invocation('{"status":1,"name":"NoAuth","message":"No authorization"}', { exitCode: 1 }), ['A']))
                .toEqual({ kind: 'notAllAssigned', assignedNames: [], alreadyAssignedNames: [], failedNames: ['A'], failureMessages: ['NoAuth: No authorization'] });
            expect(RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(invocation('{"status":0,"result":{"successes":[null,"A",{"value":7}],"failures":"x"}}'), ['A']))
                .toMatchObject({ kind: 'notAllAssigned', failedNames: ['A'] });
            expect(RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(invocation('not json'), ['A']).kind).toBe('notAllAssigned');
            expect(RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(invocation('{"status":0,"result":[]}'), ['A']).kind).toBe('notAllAssigned');
            // A FAILURE WITH NO MESSAGE STILL FAILS THE PICK IT NAMES, AND THE CLI'S OWN ERROR STANDS IN FOR THE MESSAGE
            expect(RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(invocation('{"status":1,"name":"AssignError","result":{"successes":[],"failures":[{"name":"A"}]}}'), ['A']))
                .toEqual({ kind: 'notAllAssigned', assignedNames: [], alreadyAssignedNames: [], failedNames: ['A'], failureMessages: ['AssignError'] });

        });

        it('says the CLI is required on ENOENT, and that a timeout or an answer too large to read leaves the assignment unknown', () => {

            expect(RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(invocation('', { spawnError: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) }), ['A']).kind).toBe('cliNotInstalled');
            expect(RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(invocation('', { spawnError: Object.assign(new Error('EACCES'), { code: 'EACCES' }) }), ['A']))
                .toMatchObject({ kind: 'notAllAssigned', failedNames: ['A'], failureMessages: ['The Salesforce CLI could not be started: EACCES'] });
            expect(RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(invocation('', { timedOut: true }), ['A']).kind).toBe('unconfirmed');
            expect(RecipeCockpitPermissionSetAssign.parsePermissionSetAssignOutput(invocation('', { isOutputTooLarge: true }), ['A']).kind).toBe('unconfirmed');

        });

        it('names the tree, the org, the user and every pick with what it covers in the confirmation, each on one line', () => {

            const detail = RecipeCockpitPermissionSetAssign.buildConfirmationDetail('Tree\nTwo', `qa · ${QA_USERNAME}`, QA_USERNAME, [
                { name: 'Account_Tree_Access', relativeFilePath: ACCOUNT_TREE_ACCESS_PATH, coveredObjectApiNames: ['Account', 'OtherChildObject__c'], grantedObjectApiNames: ['Account', 'OtherChildObject__c'] }
            ], 3);

            expect(detail).toContain('Tree: Tree Two');
            expect(detail).toContain(`Org: qa · ${QA_USERNAME}`);
            expect(detail).toContain(`Assigned to: ${QA_USERNAME}, the user this org is authorized as`);
            expect(detail).toContain('1 permission set:\n  Account_Tree_Access — partial, 2 of 3: Account, OtherChildObject__c');
            expect(detail).toContain('Nothing is deployed.');
            expect(detail).not.toMatch(/[()]/);

        });

    });

    describe('routePanelMessage', () => {

        const buildPanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: '' }, renderSequence: 3 };
            panelState.acknowledgedRenderSequence = 3;
            panelState.dataOrgDetails = [{ targetOrgIdentifier: 'qa', username: QA_USERNAME, alias: 'qa' }];
            panelState.dataOrgSelection = { orgIndex: 0, orgDetail: panelState.dataOrgDetails[0], requestSequence: 7, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' }, isReadinessPosted: true };
            panelState.pendingAssignableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            panelState.assignableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            return panelState;
        };

        const permissionSetMessage = { command: 'assignTreePermissionSets', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY };
        const notRunning = (treeKey: string = ACCOUNT_TREE_KEY) => ({ command: 'permissionSetAssignState', isRunning: false, treeKey: treeKey });

        it('refuses the selected org with a warning until its readiness was posted, since a describe taken before the assignment would put back what it removed', () => {

            const panelState = buildPanelState();
            panelState.dataOrgSelection.isReadinessPosted = false;

            expect(RecipeCockpitService.routePanelMessage(permissionSetMessage, panelState)).toEqual({
                kind: 'refusePermissionSetAssign',
                refusalText: 'Nothing was assigned: the org selected above is still being checked. Try again once that check has finished.',
                hostMessage: notRunning()
            });
            expect(RecipeCockpitService.routePanelMessage({ command: 'assignTreePermissionSets', treeKey: ACCOUNT_TREE_KEY }, panelState)?.kind).toBe('assignTreePermissionSets');

        });

        it('routes the tree KEY and whether the selection is the org, never anything else', () => {

            expect(RecipeCockpitService.routePanelMessage({ ...permissionSetMessage, names: ['Evil'], username: 'prod@example.com' } as any, buildPanelState()))
                .toEqual({ kind: 'assignTreePermissionSets', treeKey: ACCOUNT_TREE_KEY, isSelectedOrg: true });

        });

        it('routes a message with no org index to the host\'s own org prompt', () => {

            const panelState = buildPanelState();
            panelState.dataOrgSelection = undefined;

            expect(RecipeCockpitService.routePanelMessage({ command: 'assignTreePermissionSets', treeKey: ACCOUNT_TREE_KEY }, panelState))
                .toEqual({ kind: 'assignTreePermissionSets', treeKey: ACCOUNT_TREE_KEY, isSelectedOrg: false });

        });

        it('refuses a tree the panel has not confirmed drawing, a key that is not a string, and an org index that is not a sandbox selection', () => {

            const panelState = buildPanelState();

            expect(RecipeCockpitService.routePanelMessage({ ...permissionSetMessage, treeKey: 'Lead-ONLY' }, panelState)).toEqual({ kind: 'refusePermissionSetAssign', hostMessage: notRunning('Lead-ONLY') });
            expect(RecipeCockpitService.routePanelMessage({ ...permissionSetMessage, treeKey: 7 }, panelState)).toEqual({ kind: 'refusePermissionSetAssign', hostMessage: notRunning('') });
            expect(RecipeCockpitService.routePanelMessage({ ...permissionSetMessage, orgIndex: 1 }, panelState)).toMatchObject({
                kind: 'refusePermissionSetAssign',
                refusalText: expect.stringContaining('has not answered that it is a sandbox'),
                hostMessage: notRunning()
            });

            panelState.dataOrgSelection.orgTypeDetail = { isSandbox: false, organizationType: 'Enterprise Edition' };
            expect(RecipeCockpitService.routePanelMessage(permissionSetMessage, panelState)?.kind).toBe('refusePermissionSetAssign');

            panelState.dataOrgSelection.orgTypeDetail = undefined;
            expect(RecipeCockpitService.routePanelMessage(permissionSetMessage, panelState)?.kind).toBe('refusePermissionSetAssign');

            panelState.assignableTreeKeys = new Set();
            expect(RecipeCockpitService.routePanelMessage({ command: 'assignTreePermissionSets', treeKey: ACCOUNT_TREE_KEY }, panelState)?.kind).toBe('refusePermissionSetAssign');

        });

        it('routes nothing for the removed metadata deploy, its Deployment Status page, the old permission set message or an inline "View output"', () => {

            const panelState = buildPanelState();

            ['deployTreeMetadata', 'openMetadataDeployStatus', 'deployTreePermissionSets', 'viewMetadataDeployOutput'].forEach(command => {
                expect(RecipeCockpitService.routePanelMessage({ command: command, orgIndex: 0, treeKey: ACCOUNT_TREE_KEY }, panelState)).toBeUndefined();
            });

        });

        it('is refused while a scratch org run or an insert holds the selection, and holds them all while it runs', () => {

            const panelState = buildPanelState();

            panelState.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true };
            expect(RecipeCockpitService.routePanelMessage(permissionSetMessage, panelState)?.kind).toBe('refusePermissionSetAssign');

            panelState.scratchOrgStateMessage = undefined;
            panelState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };
            expect(RecipeCockpitService.routePanelMessage(permissionSetMessage, panelState)?.kind).toBe('refusePermissionSetAssign');

            panelState.insertStateMessage = undefined;
            panelState.permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };
            panelState.dataOrgObjectApiNames = new Set(['Account']);
            panelState.insertableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.set(ACCOUNT_TREE_KEY, '/workspace/account.yml');

            expect(RecipeCockpitService.routePanelMessage(permissionSetMessage, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'insertTree', treeKey: ACCOUNT_TREE_KEY }, panelState)?.kind).toBe('postInsertState');
            expect(RecipeCockpitService.routePanelMessage({ command: 'createScratchOrg' }, panelState)?.kind).toBe('postScratchOrgState');
            expect(RecipeCockpitService.routePanelMessage({ command: 'selectDataOrg', orgIndex: 0 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'openDataOrg', orgIndex: 0 }, panelState)).toEqual({ kind: 'postOrgOpenState', hostMessage: { command: 'orgOpenState', isRunning: false } });

        });

        it('replays an assignment still running, so a reloaded document keeps the picker and every assign button held', () => {

            const panelState = buildPanelState();
            panelState.permissionSetAssignStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };

            expect(RecipeCockpitService.buildReplayMessages(panelState)).toContainEqual(panelState.permissionSetAssignStateMessage);

        });

    });

    describe('the host, against a faked org and Salesforce CLI', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let savedPathVariable: string | undefined;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let cliCalls: string[][];
        let organizationAnswers: Array<{ IsSandbox: boolean; OrganizationType: string }>;
        let orgPermissionSetNames: string[] | 'fail';
        let soqlQueries: string[];
        let assignHandler: (argumentList: string[]) => { stdout: string; error?: unknown } | 'hold';
        let heldCallbacks: Array<() => void>;
        let cancellationListeners: Array<() => void>;
        let cancellationToken: { isCancellationRequested: boolean; onCancellationRequested: (listener: () => void) => void };
        let notificationInformationSpy: jest.SpyInstance;
        let describeCalls: string[];
        let childKill: jest.Mock;
        let workspaceState: { get: jest.Mock; update: jest.Mock };

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const deployCalls = () => cliCalls.filter(argumentList => argumentList[0] === 'project');
        const assignCalls = () => cliCalls.filter(argumentList => argumentList[0] === 'org' && argumentList[1] === 'assign');
        const lastAssignState = () => postedNamed('permissionSetAssignState').at(-1);
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
        const quickPick = () => vscode.window.showQuickPick as jest.Mock;
        const warningCalls = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls;
        const modalCalls = () => warningCalls().filter(([, options]) => options?.modal);
        // EVERY NON-MODAL WARNING: ITS TEXT, AND THE BUTTONS IT OFFERS
        const notificationWarnings = () => warningCalls()
            .filter(([, options]) => !( options && typeof options === 'object' && options.modal ))
            .map(([warningText, ...actions]) => ({ text: warningText as string, actions: actions as string[] }));
        const lastWarning = () => notificationWarnings().at(-1);

        const openCockpit = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
        };

        const openCockpitWithQaSelected = async () => {
            await openCockpit();
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await flushAsyncWork();
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
            await flushAsyncWork();
        };

        const assignPermissionSets = async (treeKey: string = ACCOUNT_TREE_KEY, orgIndex: number | null = 0) => {
            await receivedMessageHandler({ command: 'assignTreePermissionSets', treeKey: treeKey, ...( orgIndex === null ? {} : { orgIndex: orgIndex } ) });
            await flushAsyncWork();
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-permission-sets-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.cpSync(PERMISSION_SET_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.mkdirSync(path.join(temporaryRoot, 'installed', 'bin'), { recursive: true });
            ['sf', 'sf.cmd'].forEach(executableName => fs.writeFileSync(path.join(temporaryRoot, 'installed', 'bin', executableName), ''));
            savedPathVariable = process.env.PATH;
            process.env.PATH = path.join(temporaryRoot, 'installed', 'bin');

            SalesforceOrgService.clearConnectedOrgStatusCache();
            SalesforceOrgService.clearDescribeCache();
            (RecipeCockpitService as any).isPermissionSetAssignInFlight = false;
            (RecipeCockpitService as any).permissionSetAssignRunStateMessage = undefined;
            (RecipeCockpitService as any).isScratchOrgSetupInFlight = false;
            (RecipeCockpitService as any).scratchOrgRunStateMessage = undefined;

            postedPanelMessages = [];
            cliCalls = [];
            describeCalls = [];
            soqlQueries = [];
            heldCallbacks = [];
            cancellationListeners = [];
            organizationAnswers = [];
            orgPermissionSetNames = ['Account_Tree_Access', 'Contact_Reader', 'Gadget_Access'];
            childKill = jest.fn();
            workspaceState = { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) };
            assignHandler = argumentList => ({ stdout: buildAssignAnswer(argumentList.filter((_argument, argumentIndex) => argumentList[argumentIndex - 1] === '--name')) });

            (execFile as unknown as jest.Mock).mockReset();
            (execFile as unknown as jest.Mock).mockImplementation((_command: string, argumentList: string[], _options: unknown, callback: any) => {
                cliCalls.push(argumentList);
                const answerWith = (cliAnswer: { stdout: string; error?: unknown }) => setImmediate(() => callback(cliAnswer.error ?? null, cliAnswer.stdout, ''));
                if ( argumentList[0] === 'org' && argumentList[1] === 'list' ) {
                    answerWith({ stdout: JSON.stringify(SF_ORG_LIST) });
                } else {
                    const cliAnswer = assignHandler(argumentList);
                    if ( cliAnswer === 'hold' ) {
                        heldCallbacks.push(() => answerWith({ stdout: '', error: Object.assign(new Error('killed'), { code: null, signal: 'SIGTERM' }) }));
                    } else {
                        answerWith(cliAnswer);
                    }
                }
                return { kill: childKill };
            });

            (AuthInfo.listAllAuthorizations as jest.Mock).mockImplementation(async () => ORG_AUTHORIZATIONS);

            cancellationToken = { isCancellationRequested: false, onCancellationRequested: (listener: () => void) => { cancellationListeners.push(listener); } };
            (vscode.window.withProgress as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, cancellationToken));
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_message: string, options: any) => options?.modal ? RECIPE_COCKPIT_PERMISSION_SET_CONFIRM_LABEL : undefined);
            (vscode.window.showErrorMessage as jest.Mock).mockReset();
            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined);
            (vscode.window.showInformationMessage as jest.Mock).mockReset();
            quickPick().mockReset();
            quickPick().mockImplementation(async (items: any[]) => items);

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
            // THE SHARED HELPER WARNS THROUGH vscode.window.showWarningMessage TOO, SO EVERY WARNING IS READ FROM THERE
            jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation((warningText: string) => { vscode.window.showWarningMessage(warningText); });
            notificationInformationSpy = jest.spyOn(VSCodeWorkspaceService, 'showInformationMessage').mockImplementation(() => undefined);
            jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            jest.spyOn(SalesforceOrgService, 'getConnection').mockImplementation(async () => ({
                describe: jest.fn().mockImplementation(async (objectApiName: string) => {
                    describeCalls.push(objectApiName);
                    return { name: objectApiName, createable: true, fields: [] };
                }),
                query: jest.fn().mockImplementation(async (soql: string) => {
                    soqlQueries.push(soql);
                    if ( soql.includes('FROM Organization') ) {
                        return { records: [organizationAnswers.shift() ?? { IsSandbox: true, OrganizationType: 'Developer Edition' }] };
                    }
                    if ( soql.startsWith('SELECT Name FROM PermissionSet WHERE Name IN (') ) {
                        if ( orgPermissionSetNames === 'fail' ) {
                            throw new Error('INVALID_SESSION_ID: Session expired');
                        }
                        const presentNames = orgPermissionSetNames;
                        // SOQL MATCHES A NAME CASE-INSENSITIVELY, AND ANSWERS WITH THE ORG'S OWN SPELLING
                        return { records: presentNames.filter(permissionSetName => soql.toLowerCase().includes(`'${permissionSetName.toLowerCase()}'`)).map(permissionSetName => ({ Name: permissionSetName })) };
                    }
                    throw new Error(`A query was sent that should not have been: ${soql}`);
                }),
                sobject: jest.fn()
            }) as any);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            process.env.PATH = savedPathVariable;
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('offers the covering permission sets in a multi-select pick, names the org, the user and every pick in an escaped modal, and assigns them without deploying anything', async () => {

            await openCockpitWithQaSelected();
            const clearSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');
            const describesBefore = describeCalls.length;

            await assignPermissionSets();

            const [pickItems, pickOptions] = quickPick().mock.calls[0];
            expect(pickOptions).toMatchObject({ canPickMany: true });
            expect(pickItems.map((pickItem: any) => [pickItem.label, pickItem.description, pickItem.detail])).toEqual([
                ['Account_Tree_Access', 'partial, 2 of 3: Account, OtherChildObject__c', ACCOUNT_TREE_ACCESS_PATH],
                ['Contact_Reader', 'partial, 1 of 3: Contact', CONTACT_READER_PATH]
            ]);

            const [modalMessage, modalOptions, modalAction] = modalCalls()[0];
            expect(modalMessage).toBe(`Assign 2 permission sets for Relationship Tree 1 to ${QA_USERNAME} in qa · ${QA_USERNAME}?`);
            expect(modalOptions.detail).toContain(`Org: qa · ${QA_USERNAME}`);
            expect(modalOptions.detail).toContain('  Account_Tree_Access — partial, 2 of 3: Account, OtherChildObject__c');
            expect(modalOptions.detail).toContain('Nothing is deployed.');
            expect(modalAction).toBe(RECIPE_COCKPIT_PERMISSION_SET_CONFIRM_LABEL);

            expect(soqlQueries).toContain('SELECT Name FROM PermissionSet WHERE Name IN (\'Account_Tree_Access\', \'Contact_Reader\')');
            expect(deployCalls()).toEqual([]);
            expect(assignCalls()).toEqual([[
                'org', 'assign', 'permset', '--json', '--target-org', QA_USERNAME,
                '--name', 'Account_Tree_Access', '--name', 'Contact_Reader'
            ]]);
            expect(cliCalls.some(argumentList => argumentList.includes('deploy'))).toBe(false);
            // PROJECT MODE: THE WORKSPACE IS THE WORKING DIRECTORY, AND sf IS RUN BY ITS ABSOLUTE PATH FROM PATH
            const projectCalls = (execFile as unknown as jest.Mock).mock.calls.filter(([, argumentList]) => argumentList[0] !== 'org' || argumentList[1] !== 'list');
            projectCalls.forEach(([command, , execOptions]) => {
                expect(execOptions.cwd).toBe(path.resolve(workspaceRoot));
                expect(path.isAbsolute(String(command).replace(/^"|"$/g, ''))).toBe(true);
            });

            expect(notificationInformationSpy).toHaveBeenCalledWith(`Assigned 2 permission sets for Relationship Tree 1 to ${QA_USERNAME} in qa · ${QA_USERNAME}.`);
            expect(notificationWarnings()).toEqual([]);
            // THE PANEL IS TOLD ONLY THAT IT RAN AND THAT IT ENDED: NO TEXT, NO LINE, NO OUTPUT LINK
            expect(postedNamed('permissionSetAssignState')).toEqual([
                { command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY },
                { command: 'permissionSetAssignState', isRunning: false, treeKey: ACCOUNT_TREE_KEY }
            ]);

            const operationsFolderPath = path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, QA_USERNAME);
            const resultFiles = fs.readdirSync(operationsFolderPath);
            expect(resultFiles.filter(fileName => fileName.endsWith('-permission-set-assign.json'))).toHaveLength(1);
            expect(resultFiles.filter(fileName => fileName.includes('deploy'))).toEqual([]);

            // FIELD-LEVEL SECURITY CHANGES WHAT A DESCRIBE ANSWERS: THE COVERED OBJECTS ARE DESCRIBED AFRESH FOR THE CARD
            ACCOUNT_TREE_OBJECTS.forEach(objectApiName => expect(clearSpy).toHaveBeenCalledWith(QA_USERNAME, objectApiName));
            expect(describeCalls.slice(describesBefore)).toEqual(expect.arrayContaining(['Account', 'OtherChildObject__c']));
            expect(postedPanelMessages.indexOf(lastAssignState())).toBeGreaterThan(postedPanelMessages.indexOf(postedNamed('dataOrgReadiness').at(-1)));

        });

        it('assigns the picks the org holds, and names the rest in a warning telling the reader to deploy them', async () => {

            orgPermissionSetNames = ['account_tree_access'];
            await openCockpitWithQaSelected();
            const clearSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');

            await assignPermissionSets();

            expect(assignCalls()).toEqual([['org', 'assign', 'permset', '--json', '--target-org', QA_USERNAME, '--name', 'Account_Tree_Access']]);
            expect(notificationWarnings()).toContainEqual({
                text: `Not in qa · ${QA_USERNAME}: Contact_Reader. Deploy this permission set to the org, then assign it.`,
                actions: []
            });
            expect(notificationInformationSpy).toHaveBeenCalledWith(`Assigned 1 permission set for Relationship Tree 1 to ${QA_USERNAME} in qa · ${QA_USERNAME}.`);
            // ONLY WHAT AN ASSIGNED PICK GRANTS ON IS DROPPED
            expect(clearSpy).toHaveBeenCalledWith(QA_USERNAME, 'Account');
            expect(clearSpy).not.toHaveBeenCalledWith(QA_USERNAME, 'Contact');

        });

        it('starts no CLI process when the org holds none of the picks, and only warns', async () => {

            orgPermissionSetNames = [];
            await openCockpitWithQaSelected();
            const clearSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');

            await assignPermissionSets();

            expect(cliCalls.filter(argumentList => argumentList[1] !== 'list')).toEqual([]);
            expect(notificationWarnings()).toEqual([{
                text: `Not in qa · ${QA_USERNAME}: Account_Tree_Access, Contact_Reader. Deploy these permission sets to the org, then assign them.`,
                actions: []
            }]);
            expect(notificationInformationSpy).not.toHaveBeenCalled();
            expect(clearSpy).not.toHaveBeenCalled();
            expect(lastAssignState()).toEqual({ command: 'permissionSetAssignState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

        });

        it('assigns nothing, and gives a fixed warning, when the org cannot be asked which permission sets it holds', async () => {

            orgPermissionSetNames = 'fail';
            await openCockpitWithQaSelected();

            await assignPermissionSets();

            expect(assignCalls()).toEqual([]);
            expect(lastWarning()).toEqual({ text: `Nothing was assigned: qa · ${QA_USERNAME} could not be asked which of the permission sets it holds. Try again.`, actions: [] });
            expect(lastWarning().text).not.toContain('INVALID_SESSION_ID');

        });

        it('drops and re-checks the describes of every object an assigned pick grants on, another card\'s included, matched case-insensitively', async () => {

            const accessFilePath = path.join(workspaceRoot, ACCOUNT_TREE_ACCESS_PATH);
            fs.writeFileSync(accessFilePath, fs.readFileSync(accessFilePath, 'utf-8').replace('<label>', '<objectPermissions><allowRead>true</allowRead><object>lead</object></objectPermissions>\n    <label>'));
            await openCockpitWithQaSelected();
            const clearSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');
            const describesBefore = describeCalls.length;

            await assignPermissionSets();

            expect(clearSpy).toHaveBeenCalledWith(QA_USERNAME, 'lead');
            expect(clearSpy).not.toHaveBeenCalledWith(QA_USERNAME, 'User');
            // THE Lead CARD IS CHECKED AGAIN, SO ITS OBJECT IS DESCRIBED AFRESH
            expect(describeCalls.slice(describesBefore)).toContain('Lead');

        });

        it('asks about and assigns only what the reader picked', async () => {

            await openCockpitWithQaSelected();
            quickPick().mockImplementation(async (items: any[]) => items.filter(item => item.label === 'Contact_Reader'));

            await assignPermissionSets();

            expect(modalCalls()[0][0]).toBe(`Assign 1 permission set for Relationship Tree 1 to ${QA_USERNAME} in qa · ${QA_USERNAME}?`);
            expect(soqlQueries.at(-1)).toBe('SELECT Name FROM PermissionSet WHERE Name IN (\'Contact_Reader\')');
            expect(assignCalls()[0].slice(-2)).toEqual(['--name', 'Contact_Reader']);

        });

        it('escapes every repository text in the modal, the progress title and the notifications', async () => {

            orgPermissionSetNames = ['Account_Tree_Access'];
            await openCockpitWithQaSelected();
            panelState().recipeDataMessage.recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY).customName = 'Run [me](command:evil)';

            await assignPermissionSets();

            const [modalMessage, modalOptions] = modalCalls()[0];
            expect(modalMessage).not.toMatch(/[[\]()]/);
            expect(modalOptions.detail).not.toMatch(/[[\]()]/);
            expect(modalOptions.detail).toContain('Tree: Run \\u005bme\\u005d\\u0028command:evil\\u0029');
            const progressTitles = (vscode.window.withProgress as jest.Mock).mock.calls.map(([progressOptions]) => progressOptions.title);
            expect(progressTitles).toHaveLength(1);
            progressTitles.forEach(progressTitle => expect(progressTitle).not.toMatch(/[[\]()]/));
            notificationWarnings().forEach(warning => expect(warning.text).not.toMatch(/[[\]()]/));

        });

        it('with no org selected, asks for one from the Treecipe tab\'s list after the pick, and makes it the selection once confirmed', async () => {

            await openCockpit();
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockImplementation(async (orgListing: Promise<any>) => {
                expect(quickPick()).toHaveBeenCalledTimes(1);
                const listing = await orgListing;
                return listing.orgDetails.find((orgDetail: any) => orgDetail.username === QA_USERNAME);
            });

            await assignPermissionSets(ACCOUNT_TREE_KEY, null);
            await flushAsyncWork();

            expect(promptSpy.mock.calls[0][1]).toBe(RECIPE_COCKPIT_PERMISSION_SET_ORG_PLACEHOLDER);
            expect(assignCalls()).toHaveLength(1);
            expect(workspaceState.update).toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, QA_USERNAME);
            expect(panelState().dataOrgSelection?.orgDetail.username).toBe(QA_USERNAME);
            expect(lastAssignState()).toEqual({ command: 'permissionSetAssignState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

        });

        it('warns and runs nothing when no permission set in source covers the tree, opening no pick and no org prompt', async () => {

            fs.rmSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'permissionsets'), { recursive: true });
            fs.rmSync(path.join(workspaceRoot, 'unpackaged', 'permissionsets'), { recursive: true });
            await openCockpit();
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed');

            await assignPermissionSets(ACCOUNT_TREE_KEY, null);

            expect(lastWarning()).toEqual({ text: 'No permission set in this workspace\'s source grants access to any object of Relationship Tree 1, so nothing was assigned.', actions: [] });
            expect(quickPick()).not.toHaveBeenCalled();
            expect(promptSpy).not.toHaveBeenCalled();
            expect(cliCalls.filter(argumentList => argumentList[1] !== 'list')).toEqual([]);
            expect(lastAssignState()).toMatchObject({ isRunning: false });

        });

        it('warns about a permission set file it cannot parse, and still offers the rest', async () => {

            fs.writeFileSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'permissionsets', 'Broken.permissionset-meta.xml'), '<PermissionSet><');
            await openCockpitWithQaSelected();

            await assignPermissionSets();

            expect(notificationWarnings()).toContainEqual({ text: 'Skipped 1 permission set file that could not be read as a permission set with an api name: force-app/main/default/permissionsets/Broken.permissionset-meta.xml.', actions: [] });
            expect(quickPick().mock.calls[0][0].map((pickItem: any) => pickItem.label)).toEqual(['Account_Tree_Access', 'Contact_Reader']);
            expect(assignCalls()).toHaveLength(1);

        });

        it('runs nothing, and says nothing, when the pick is dismissed or left empty, or the confirmation is cancelled', async () => {

            await openCockpitWithQaSelected();

            quickPick().mockResolvedValueOnce(undefined);
            await assignPermissionSets();
            quickPick().mockResolvedValueOnce([]);
            await assignPermissionSets();
            expect(modalCalls()).toEqual([]);

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);
            await assignPermissionSets();

            expect(modalCalls()).toHaveLength(1);
            expect(soqlQueries.filter(soql => soql.includes('PermissionSet'))).toEqual([]);
            expect(assignCalls()).toEqual([]);
            expect(notificationWarnings()).toEqual([]);
            expect(lastAssignState()).toMatchObject({ isRunning: false });

        });

        it('refuses more picks than the command line can carry', async () => {

            await openCockpitWithQaSelected();
            quickPick().mockImplementation(async (items: any[]) => Array.from({ length: PERMISSION_SET_MAX_PICKS + 1 }, () => items[0]));

            await assignPermissionSets();

            expect(modalCalls()).toEqual([]);
            expect(assignCalls()).toEqual([]);
            expect(lastWarning().text).toContain(`at most ${PERMISSION_SET_MAX_PICKS} can be assigned at once`);

        });

        it('asks the Organization row again after the confirmation, and asks nothing more of an org that does not answer it is a sandbox', async () => {

            await openCockpitWithQaSelected();
            organizationAnswers.push({ IsSandbox: false, OrganizationType: 'Enterprise Edition' });

            await assignPermissionSets();

            expect(soqlQueries.filter(soql => soql.includes('PermissionSet'))).toEqual([]);
            expect(assignCalls()).toEqual([]);
            expect(lastWarning().text).toContain('Permission sets are assigned only in a sandbox or scratch org.');

        });

        it('neither runs nor selects anything for a PROMPTED org that answers it is production', async () => {

            await openCockpit();
            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockResolvedValueOnce({ targetOrgIdentifier: 'qa', username: QA_USERNAME, alias: 'qa' });
            organizationAnswers.push({ IsSandbox: false, OrganizationType: 'Enterprise Edition' });

            await assignPermissionSets(ACCOUNT_TREE_KEY, null);

            expect(assignCalls()).toEqual([]);
            expect(workspaceState.update).not.toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, expect.anything());

        });

        it('says the Salesforce CLI is required in a warning when sf is not installed', async () => {

            process.env.PATH = path.join(temporaryRoot, 'nowhere');
            await openCockpitWithQaSelected();

            await assignPermissionSets();

            expect(lastWarning()).toEqual({ text: 'The Salesforce CLI is required to assign permission sets, and "sf" is not installed or not on PATH. Install it and try again.', actions: [] });
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(assignCalls()).toEqual([]);

        });

        it('on Windows assigns nothing from a UNC project folder, which cmd.exe would swap for the Windows folder (#285)', async () => {

            await openCockpitWithQaSelected();
            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(true);
            jest.spyOn(PicklistDependencyCheckService, 'isUncPath').mockReturnValue(true);

            await assignPermissionSets();

            expect(assignCalls()).toEqual([]);
            expect(lastWarning().text).toContain('is a network UNC path');
            expect(lastAssignState()).toMatchObject({ isRunning: false });

        });

        it('counts a permission set the user already holds as a success', async () => {

            assignHandler = () => ({
                stdout: buildAssignAnswer(['Account_Tree_Access'], [{ name: QA_USERNAME, message: 'Duplicate PermissionSetAssignment. Assignee: 005x, PermissionSet: 0PSx' }]),
                error: Object.assign(new Error('exit 1'), { code: 1 })
            });
            await openCockpitWithQaSelected();

            await assignPermissionSets();

            expect(notificationWarnings()).toEqual([]);
            expect(notificationInformationSpy).toHaveBeenCalledWith(expect.stringContaining('Contact_Reader was already assigned.'));

        });

        it('names which permission sets failed in a warning whose "View output" button opens the result file', async () => {

            assignHandler = () => ({
                stdout: buildAssignAnswer(['Account_Tree_Access'], [{ name: QA_USERNAME, message: 'Permission set "Contact_Reader" not found in target org.' }]),
                error: Object.assign(new Error('exit 1'), { code: 1 })
            });
            await openCockpitWithQaSelected();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_message: string, options: any, ...actions: string[]) => (
                options?.modal ? RECIPE_COCKPIT_PERMISSION_SET_CONFIRM_LABEL : [options, ...actions].includes(RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL) ? RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL : undefined
            ));

            await assignPermissionSets();
            await flushAsyncWork();

            const failure = lastWarning();
            expect(failure.text).toBe(`Contact_Reader could not be assigned to ${QA_USERNAME} in qa · ${QA_USERNAME}: Permission set "Contact_Reader" not found in target org. Assigned: Account_Tree_Access.`);
            expect(failure.actions).toEqual([RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL]);
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(VSCodeWorkspaceService.openFileInEditor).toHaveBeenCalledWith(expect.stringMatching(/-permission-set-assign\.json$/));
            // THE CARD DRAWS NO LINE OF ITS OWN, SO NOTHING ABOUT THE OUTCOME IS POSTED
            expect(lastAssignState()).toEqual({ command: 'permissionSetAssignState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

        });

        it('kills the process tree on cancel, warns that which were assigned is unknown, and refuses a second assignment meanwhile', async () => {

            assignHandler = () => 'hold';
            await openCockpitWithQaSelected();
            const killSpy = jest.spyOn(PicklistDependencyCheckService, 'killProcessTree');

            const runInFlight = assignPermissionSets();
            await flushAsyncWork();
            await flushAsyncWork();

            expect(lastAssignState()).toEqual({ command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY });

            await receivedMessageHandler({ command: 'assignTreePermissionSets', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY });
            expect(assignCalls()).toHaveLength(1);

            cancellationToken.isCancellationRequested = true;
            cancellationListeners.forEach(cancellationListener => cancellationListener());
            heldCallbacks.forEach(answer => answer());
            await runInFlight;
            await flushAsyncWork();

            expect(killSpy).toHaveBeenCalled();
            expect(childKill).toHaveBeenCalled();
            expect(lastWarning().text).toContain('was cancelled, so which were assigned is unknown.');
            expect(lastAssignState()).toMatchObject({ isRunning: false });

        });

        it('refuses before the pick or any org prompt when the workspace has no sfdx-project.json', async () => {

            fs.rmSync(path.join(workspaceRoot, 'sfdx-project.json'));
            await openCockpit();
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed');

            await assignPermissionSets(ACCOUNT_TREE_KEY, null);

            expect(quickPick()).not.toHaveBeenCalled();
            expect(promptSpy).not.toHaveBeenCalled();
            expect(lastWarning().text).toContain('Nothing was assigned: No "sfdx-project.json" found');

        });

        it('warns when the org list cannot be read for the prompt, and runs nothing when the prompt is dismissed', async () => {

            await openCockpit();
            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed')
                .mockRejectedValueOnce(new Error('The Salesforce CLI could not report which authorized orgs are connected.'))
                .mockResolvedValueOnce(undefined);

            await assignPermissionSets(ACCOUNT_TREE_KEY, null);
            expect(lastWarning().text).toContain('Nothing was assigned: The Salesforce CLI could not report');

            const warningsBefore = notificationWarnings().length;
            await assignPermissionSets(ACCOUNT_TREE_KEY, null);
            expect(notificationWarnings()).toHaveLength(warningsBefore);

            expect(modalCalls()).toEqual([]);
            expect(assignCalls()).toEqual([]);

        });

        it('runs nothing when the org cannot be connected to for the second Organization check', async () => {

            await openCockpitWithQaSelected();
            (SalesforceOrgService.getConnection as jest.Mock).mockRejectedValueOnce(new Error('expired access token'));

            await assignPermissionSets();

            expect(assignCalls()).toEqual([]);
            expect(lastWarning().text).toContain(`could not connect to qa · ${QA_USERNAME}: expired access token`);

        });

        it('warns that which were assigned is unknown when the assignment times out', async () => {

            await openCockpitWithQaSelected();
            const runSpy = jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli').mockResolvedValue({ stdout: '', stderr: '', exitCode: null, timedOut: true });

            await assignPermissionSets();

            expect(runSpy).toHaveBeenCalledTimes(1);
            expect(lastWarning().text).toBe('The assignment did not finish in time and was stopped, so which permission sets were assigned is unknown.');

        });

        it('gives the panel its button back and rethrows when the run itself throws', async () => {

            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
            await openCockpitWithQaSelected();
            jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli').mockRejectedValue(new Error('boom'));

            await assignPermissionSets();

            expect(lastAssignState()).toEqual({ command: 'permissionSetAssignState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });
            expect(handleCapturedErrorSpy).toHaveBeenCalled();
            expect((RecipeCockpitService as any).isPermissionSetAssignInFlight).toBe(false);

        });

        it('answers with a not-running state and runs nothing when the tree is gone by the time the action runs', async () => {

            await openCockpitWithQaSelected();

            await (RecipeCockpitService as any).assignTreePermissionSetsFromPanel((RecipeCockpitService as any).recipeCockpitPanel, 'Gone-tree', false);

            expect(lastAssignState()).toEqual({ command: 'permissionSetAssignState', isRunning: false, treeKey: 'Gone-tree' });
            expect(quickPick()).not.toHaveBeenCalled();

        });

        it('names an org with no alias by its username, says an org that could not answer could not say it is a sandbox, and counts more skipped files than it names', async () => {

            const permissionSetsFolderPath = path.join(workspaceRoot, 'force-app', 'main', 'default', 'permissionsets');
            Array.from({ length: 11 }, (_unused, fileIndex) => fileIndex).forEach(fileIndex => fs.writeFileSync(path.join(permissionSetsFolderPath, `Broken_${String(fileIndex).padStart(2, '0')}.permissionset-meta.xml`), '<'));
            await openCockpit();
            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockResolvedValueOnce({ targetOrgIdentifier: QA_USERNAME, username: QA_USERNAME });
            jest.spyOn(SalesforceOrgService, 'queryOrganizationType').mockResolvedValueOnce(undefined);

            await assignPermissionSets(ACCOUNT_TREE_KEY, null);

            expect(notificationWarnings().map(warning => warning.text)).toContainEqual(expect.stringMatching(/^Skipped 11 permission set files .* and 1 more\.$/));
            expect(modalCalls()[0][0]).toBe(`Assign 2 permission sets for Relationship Tree 1 to ${QA_USERNAME} in ${QA_USERNAME}?`);
            expect(lastWarning().text).toContain(`${QA_USERNAME} could not say whether it is a sandbox`);
            expect(assignCalls()).toEqual([]);

        });

        it('says every pick was already assigned in the plural, and names none assigned when every pick failed', async () => {

            await openCockpitWithQaSelected();

            assignHandler = () => ({ stdout: buildAssignAnswer([], [{ message: 'Duplicate PermissionSetAssignment' }]), error: Object.assign(new Error('exit 1'), { code: 1 }) });
            await assignPermissionSets();
            expect(notificationInformationSpy).toHaveBeenLastCalledWith(expect.stringContaining('Account_Tree_Access, Contact_Reader were already assigned.'));

            assignHandler = () => ({ stdout: buildAssignAnswer([], [{ message: 'insufficient access' }]), error: Object.assign(new Error('exit 1'), { code: 1 }) });
            await assignPermissionSets();
            expect(lastWarning().text).toBe(`Account_Tree_Access, Contact_Reader could not be assigned to ${QA_USERNAME} in qa · ${QA_USERNAME}: insufficient access`);

        });

        it('is refused while another assignment runs', async () => {

            await openCockpitWithQaSelected();
            (RecipeCockpitService as any).isPermissionSetAssignInFlight = true;
            (RecipeCockpitService as any).permissionSetAssignRunStateMessage = { command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };

            await (RecipeCockpitService as any).assignTreePermissionSetsFromPanel((RecipeCockpitService as any).recipeCockpitPanel, ACCOUNT_TREE_KEY, true);

            expect(quickPick()).not.toHaveBeenCalled();
            expect(assignCalls()).toEqual([]);
            expect(lastAssignState()).toMatchObject({ isRunning: true });

        });

        it('carries a running assignment into a panel reopened mid-run, so its router still refuses what the run holds', async () => {

            assignHandler = () => 'hold';
            await openCockpitWithQaSelected();

            const runInFlight = assignPermissionSets();
            await flushAsyncWork();
            await flushAsyncWork();

            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            expect(panelState().permissionSetAssignStateMessage).toEqual({ command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY });
            expect(RecipeCockpitService.buildReplayMessages(panelState())).toContainEqual({ command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY });

            heldCallbacks.forEach(answer => answer());
            await runInFlight;
            await flushAsyncWork();

            expect(panelState().permissionSetAssignStateMessage).toEqual({ command: 'permissionSetAssignState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

        });

        it('says the result file is gone when "View output" is chosen after it was removed, and swallows an editor that fails to open it', async () => {

            assignHandler = () => ({ stdout: buildAssignAnswer([], [{ message: 'insufficient access' }]), error: Object.assign(new Error('exit 1'), { code: 1 }) });
            await openCockpitWithQaSelected();
            let chooseViewOutput: (choice: string) => void = () => undefined;
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation((_message: string, options: any) => (
                options?.modal ? Promise.resolve(RECIPE_COCKPIT_PERMISSION_SET_CONFIRM_LABEL) : new Promise(resolve => { chooseViewOutput = resolve; })
            ));

            await assignPermissionSets();
            fs.rmSync(path.join(workspaceRoot, 'treecipe', ORG_OPERATIONS_FOLDER_NAME), { recursive: true, force: true });
            chooseViewOutput(RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL);
            await flushAsyncWork();

            expect(VSCodeWorkspaceService.openFileInEditor).not.toHaveBeenCalled();
            expect(lastWarning().text).toBe('The permission set result file no longer exists in this workspace.');

            (VSCodeWorkspaceService.openFileInEditor as jest.Mock).mockRejectedValueOnce(new Error('editor closed'));
            await assignPermissionSets();
            chooseViewOutput(RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL);
            await flushAsyncWork();

            expect(VSCodeWorkspaceService.openFileInEditor).toHaveBeenCalledTimes(1);

        });

        it('kills the process at once when the cancel came before the CLI registered it', async () => {

            await openCockpitWithQaSelected();
            const killChildProcess = jest.fn();
            jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli').mockImplementation(async (_argumentList, registerCancellation) => {
                cancellationToken.isCancellationRequested = true;
                registerCancellation(killChildProcess);
                return { stdout: '', stderr: '', exitCode: null };
            });

            await assignPermissionSets();

            expect(killChildProcess).toHaveBeenCalled();
            expect(lastWarning().text).toContain('was cancelled, so which were assigned is unknown.');

        });

        it('lets the assignment run once a selection whose objects could not be described has posted that as its readiness', async () => {

            jest.spyOn(RecipeCockpitService as any, 'collectCreateTargets').mockRejectedValueOnce(new Error('REQUEST_LIMIT_EXCEEDED'));
            await openCockpitWithQaSelected();

            const readiness = postedNamed('dataOrgReadiness').at(-1);
            expect(readiness.objects).toContainEqual({
                objectApiName: 'Account',
                disabledReason: 'The objects could not be described in this org (REQUEST_LIMIT_EXCEEDED), so nothing is inserted into it.',
                requiredLookups: []
            });
            expect(panelState().dataOrgSelection.isReadinessPosted).toBe(true);

            await assignPermissionSets();

            expect(assignCalls()).toHaveLength(1);

        });

        it('re-checks the cards after an assignment and refuses a card whose recipe file can no longer be read', async () => {

            await openCockpitWithQaSelected();
            const recipeFilePath = panelState().treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.get(ACCOUNT_TREE_KEY);
            fs.rmSync(recipeFilePath);
            const readinessBefore = postedNamed('dataOrgReadiness').length;

            await assignPermissionSets();

            const recheck = postedNamed('dataOrgReadiness').slice(readinessBefore).at(-1);
            expect(recheck.createTargets).toContainEqual(expect.objectContaining({
                treeKey: ACCOUNT_TREE_KEY,
                objectApiName: 'Account',
                disabledReason: 'The recipe file for this tree could not be read, so its Account records could not be prepared.'
            }));

        });

        it('warns, and gives the button back, when the router refuses the selected org before its check has finished', async () => {

            await openCockpitWithQaSelected();
            panelState().dataOrgSelection.isReadinessPosted = false;

            await assignPermissionSets();

            expect(lastWarning()).toEqual({ text: 'Nothing was assigned: the org selected above is still being checked. Try again once that check has finished.', actions: [] });
            expect(lastAssignState()).toEqual({ command: 'permissionSetAssignState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });
            expect(quickPick()).not.toHaveBeenCalled();

        });

    });

    describe('the panel script', () => {

        const loadTreeRecipe = () => {
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, 'recipe-2026-09-20T10-00-00').recipeViewModel;
        };

        const cardOf = (panel: ReturnType<typeof runPanelScript>, objectApiName: string) => panel.treeCards()
            .find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes(objectApiName)));

        const renderTrees = () => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            return panel;
        };

        const permissionSetButtonOf = (panel: ReturnType<typeof runPanelScript>, objectApiName = 'OtherChildObject__c') => panel.findAll(cardOf(panel, objectApiName), 'treePermissionSets')[0];

        it('draws the assign button, and no deploy button, status line or output link, on every card with a folder, and posts the tree key alone', () => {

            const panel = renderTrees();
            const permissionSetButton = permissionSetButtonOf(panel);
            const accountCard = cardOf(panel, 'OtherChildObject__c');

            expect(permissionSetButton.textContent).toBe('Assign permission sets to me…');
            expect(RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL).toBe('Assign permission sets to me…');
            expect(panel.isHidden(permissionSetButton)).toBe(false);
            expect(panel.isHidden(permissionSetButtonOf(panel, 'Lead'))).toBe(false);
            ['treeDeploy', 'metadataDeployStatus', 'metadataDeployViewOutput', 'metadataDeployOpenStatus'].forEach(className => {
                expect(panel.findAll(accountCard, className)).toEqual([]);
            });
            // THE ASSIGN BUTTON, THEN "Generate permission set…" (#306), AND NOTHING ELSE
            const controlChildren = panel.findAll(accountCard, 'treePermissionSetControls')[0].children;
            expect(controlChildren).toHaveLength(2);
            expect(controlChildren[0] === permissionSetButton).toBe(true);
            expect(controlChildren[1].className).toBe('treeGeneratePermissionSet');

            permissionSetButton.dispatch('click');

            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'assignTreePermissionSets', treeKey: ACCOUNT_TREE_KEY });
            expect(permissionSetButton.disabled).toBe(true);
            expect(permissionSetButtonOf(panel, 'Lead').disabled).toBe(true);

            permissionSetButton.dispatch('click');
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'assignTreePermissionSets')).toHaveLength(1);

        });

        it('posts the index of the org chosen above, and is held with every assign button while one runs', () => {

            const panel = renderTrees();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', hiddenOrgCount: 0, hiddenOrgNote: '', forgottenOrgNotice: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Sandbox', isSandbox: true, failureMessage: '', requestSequence: 5, renderSequence: 1 });

            panel.postToPanel({ command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY });
            expect(permissionSetButtonOf(panel).disabled).toBe(true);
            expect(permissionSetButtonOf(panel, 'Lead').disabled).toBe(true);

            panel.postToPanel({ command: 'permissionSetAssignState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });
            expect(permissionSetButtonOf(panel).disabled).toBe(false);

            permissionSetButtonOf(panel).dispatch('click');
            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'assignTreePermissionSets', treeKey: ACCOUNT_TREE_KEY, orgIndex: 0 });

        });

        it('is named in the preview warning, which no longer offers a metadata deploy', () => {

            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('"Assign permission sets to me…", on every tree\'s Treecipe tab, assigns the permission sets you pick');
            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('It deploys nothing');
            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).not.toContain('Deploy this metadata');

        });

    });

});
