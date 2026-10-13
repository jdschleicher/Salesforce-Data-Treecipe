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
    RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL,
    RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL
} from '../RecipeCockpitService';
import { PERMISSION_SET_MAX_PICKS, RecipeCockpitPermissionSetDeploy } from '../RecipeCockpitPermissionSetDeploy';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { ORG_OPERATIONS_FOLDER_NAME } from '../../ScratchOrgService/ScratchOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { PicklistDependencyCheckService } from '../../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const METADATA_DEPLOY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'metadataDeployWorkspace');
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

const buildDeployAnswer = (failures: Array<{ fullName: string; problem: string }> = []) => JSON.stringify({
    status: failures.length === 0 ? 0 : 1,
    ...( failures.length > 0 ? { name: 'FailedDeployError', message: 'Deploy failed.' } : {} ),
    result: {
        success: failures.length === 0,
        details: {
            componentSuccesses: [{ fullName: 'Account_Tree_Access', componentType: 'PermissionSet', success: true }],
            componentFailures: failures.map(failure => ({ ...failure, componentType: 'PermissionSet', success: false }))
        }
    }
});

const buildAssignAnswer = (successNames: string[], failures: Array<{ name?: string; message: string }> = []) => JSON.stringify({
    status: failures.length === 0 ? 0 : 1,
    result: {
        successes: successNames.map(successName => ({ name: QA_USERNAME, value: successName })),
        failures: failures
    }
});

describe('RecipeCockpitService, "Deploy & assign permission sets…" in the Treecipe tab (#274)', () => {

    describe('RecipeCockpitPermissionSetDeploy', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;

        beforeEach(() => {
            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-permission-sets-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(METADATA_DEPLOY_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        const permissionSetsFolderPath = () => path.join(workspaceRoot, 'force-app', 'main', 'default', 'permissionsets');
        const discover = (objectApiNames: string[] = ACCOUNT_TREE_OBJECTS, packageDirectoryPaths = ['force-app', 'unpackaged']) =>
            RecipeCockpitPermissionSetDeploy.discoverPermissionSets(objectApiNames, workspaceRoot, packageDirectoryPaths);

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

            expect(await RecipeCockpitPermissionSetDeploy.readGrantedObjectApiNames('<PermissionSet></PermissionSet>')).toEqual([]);
            expect(await RecipeCockpitPermissionSetDeploy.readGrantedObjectApiNames('<PermissionSet xmlns="x"/>')).toEqual([]);
            expect(await RecipeCockpitPermissionSetDeploy.readGrantedObjectApiNames('<PermissionSet><objectPermissions><object><x>1</x></object></objectPermissions><fieldPermissions><field> </field></fieldPermissions></PermissionSet>')).toEqual([]);
            expect(await RecipeCockpitPermissionSetDeploy.readGrantedObjectApiNames('<PermissionSet><objectPermissions>text</objectPermissions><objectPermissions><allowRead>true</allowRead></objectPermissions></PermissionSet>')).toEqual([]);
            expect(await RecipeCockpitPermissionSetDeploy.readGrantedObjectApiNames('')).toBeUndefined();

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

            expect(RecipeCockpitPermissionSetDeploy.describeCoverage(permissionSet, 3)).toBe('partial, 2 of 3: Account, OtherChildObject__c');
            expect(RecipeCockpitPermissionSetDeploy.describeCoverage(permissionSet, 2)).toBe('covers all 2 of the tree\'s objects: Account, OtherChildObject__c');

        });

        it('builds the deploy argv with one --metadata per pick and the assign argv with one --name per pick, the username as --target-org', () => {

            expect(RecipeCockpitPermissionSetDeploy.buildPermissionSetDeployArguments(['Account_Tree_Access', 'Contact_Reader'], QA_USERNAME)).toEqual([
                'project', 'deploy', 'start', '--json', '--target-org', QA_USERNAME,
                '--metadata', 'PermissionSet:Account_Tree_Access', '--metadata', 'PermissionSet:Contact_Reader'
            ]);
            expect(RecipeCockpitPermissionSetDeploy.buildPermissionSetAssignArguments(['Account_Tree_Access', 'Contact_Reader'], QA_USERNAME)).toEqual([
                'org', 'assign', 'permset', '--json', '--target-org', QA_USERNAME,
                '--name', 'Account_Tree_Access', '--name', 'Contact_Reader'
            ]);
            expect(RecipeCockpitPermissionSetDeploy.buildPermissionSetDeployArguments(['A'], QA_USERNAME)).not.toContain('--ignore-errors');

        });

        it('refuses a name that is not an api name, no name at all, and an org identifier that could be read as a flag, before any argv', () => {

            expect(() => RecipeCockpitPermissionSetDeploy.buildPermissionSetDeployArguments(['Ok', 'X --ignore-errors'], QA_USERNAME)).toThrow('is not a Salesforce api name');
            expect(() => RecipeCockpitPermissionSetDeploy.buildPermissionSetAssignArguments(['-onbehalfof'], QA_USERNAME)).toThrow('is not a Salesforce api name');
            expect(() => RecipeCockpitPermissionSetDeploy.buildPermissionSetAssignArguments([], QA_USERNAME)).toThrow('No permission set was named');
            expect(() => RecipeCockpitPermissionSetDeploy.buildPermissionSetDeployArguments(['Ok'], '--target-org')).toThrow();

        });

        it('reads the deploy\'s --json all or nothing, and says the CLI is required on ENOENT', () => {

            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetDeployOutput(invocation(buildDeployAnswer())))
                .toEqual({ kind: 'deployed', deployedComponentCount: 1 });
            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetDeployOutput(invocation(buildDeployAnswer([{ fullName: 'Contact_Reader', problem: 'no such field Contact.Email' }]), { exitCode: 1 })))
                .toEqual({ kind: 'failed', failureMessage: 'Contact_Reader: no such field Contact.Email' });
            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetDeployOutput(invocation('not json')).kind).toBe('failed');
            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetDeployOutput(invocation('', { spawnError: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) })))
                .toEqual({ kind: 'cliNotInstalled', failureMessage: 'The Salesforce CLI is required to deploy and assign permission sets, and "sf" is not installed or not on PATH. Install it and try again.' });

        });

        it('reads an assignment of every pick as assigned', () => {

            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetAssignOutput(invocation(buildAssignAnswer(['A', 'B'])), ['A', 'B']))
                .toEqual({ kind: 'assigned', assignedNames: ['A', 'B'], alreadyAssignedNames: [] });

        });

        it('counts a permission set the user already holds as assigned, whether or not the failure names it', () => {

            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetAssignOutput(
                invocation(buildAssignAnswer(['A'], [{ name: 'B', message: 'Duplicate PermissionSetAssignment. Assignee: 005x, PermissionSet: 0PSx' }]), { exitCode: 1 }),
                ['A', 'B']
            )).toEqual({ kind: 'assigned', assignedNames: ['A'], alreadyAssignedNames: ['B'] });

            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetAssignOutput(
                invocation(buildAssignAnswer([], [
                    { name: QA_USERNAME, message: 'Duplicate PermissionSetAssignment. Assignee: 005x, PermissionSet: 0PSa' },
                    { name: QA_USERNAME, message: 'Duplicate PermissionSetAssignment. Assignee: 005x, PermissionSet: 0PSb' }
                ]), { exitCode: 1 }),
                ['A', 'B']
            )).toEqual({ kind: 'assigned', assignedNames: [], alreadyAssignedNames: ['A', 'B'] });

        });

        it('names which picks failed in a partial assignment, and what the CLI said', () => {

            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetAssignOutput(
                invocation(buildAssignAnswer(['A'], [{ name: QA_USERNAME, message: 'Permission set "B" not found in target org.' }]), { exitCode: 1 }),
                ['A', 'B']
            )).toEqual({ kind: 'notAllAssigned', assignedNames: ['A'], alreadyAssignedNames: [], failedNames: ['B'], failureMessages: ['Permission set "B" not found in target org.'] });

            // A FAILURE NAMING NO PICK IS MATCHED TO THE PICKS NOTHING ACCOUNTED FOR, AND NEVER READ AS A SUCCESS
            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetAssignOutput(
                invocation(buildAssignAnswer(['A'], [{ name: QA_USERNAME, message: 'insufficient access' }]), { exitCode: 1 }),
                ['A', 'B', 'C']
            )).toEqual({ kind: 'notAllAssigned', assignedNames: ['A'], alreadyAssignedNames: [], failedNames: ['B', 'C'], failureMessages: ['insufficient access'] });

            // A NAME THAT ONLY PREFIXES ANOTHER IS NOT A MATCH
            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetAssignOutput(
                invocation(buildAssignAnswer([], [{ message: 'Permission set "Access_Plus" not found' }]), { exitCode: 1 }),
                ['Access', 'Access_Plus']
            )).toMatchObject({ failedNames: ['Access_Plus', 'Access'] });

        });

        it('never reads a pick the answer does not account for as assigned, nor a malformed answer as a success', () => {

            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetAssignOutput(invocation(buildAssignAnswer(['A'])), ['A', 'B']))
                .toMatchObject({ kind: 'notAllAssigned', assignedNames: ['A'], failedNames: ['B'] });
            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetAssignOutput(invocation('{"status":1,"name":"NoAuth","message":"No authorization"}', { exitCode: 1 }), ['A']))
                .toEqual({ kind: 'notAllAssigned', assignedNames: [], alreadyAssignedNames: [], failedNames: ['A'], failureMessages: ['NoAuth: No authorization'] });
            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetAssignOutput(invocation('{"status":0,"result":{"successes":[null,"A",{"value":7}],"failures":"x"}}'), ['A']))
                .toMatchObject({ kind: 'notAllAssigned', failedNames: ['A'] });
            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetAssignOutput(invocation('not json'), ['A']).kind).toBe('notAllAssigned');
            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetAssignOutput(invocation('{"status":0,"result":[]}'), ['A']).kind).toBe('notAllAssigned');
            // A FAILURE WITH NO MESSAGE STILL FAILS THE PICK IT NAMES, AND THE CLI'S OWN ERROR STANDS IN FOR THE MESSAGE
            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetAssignOutput(invocation('{"status":1,"name":"AssignError","result":{"successes":[],"failures":[{"name":"A"}]}}'), ['A']))
                .toEqual({ kind: 'notAllAssigned', assignedNames: [], alreadyAssignedNames: [], failedNames: ['A'], failureMessages: ['AssignError'] });

        });

        it('says the CLI is required on ENOENT, and that a timeout or an answer too large to read leaves the assignment unknown', () => {

            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetAssignOutput(invocation('', { spawnError: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) }), ['A']).kind).toBe('cliNotInstalled');
            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetAssignOutput(invocation('', { spawnError: Object.assign(new Error('EACCES'), { code: 'EACCES' }) }), ['A']))
                .toMatchObject({ kind: 'notAllAssigned', failedNames: ['A'], failureMessages: ['The Salesforce CLI could not be started: EACCES'] });
            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetAssignOutput(invocation('', { timedOut: true }), ['A']).kind).toBe('unconfirmed');
            expect(RecipeCockpitPermissionSetDeploy.parsePermissionSetAssignOutput(invocation('', { isOutputTooLarge: true }), ['A']).kind).toBe('unconfirmed');

        });

        it('names the tree, the org, the user and every pick with what it covers in the confirmation, each on one line', () => {

            const detail = RecipeCockpitPermissionSetDeploy.buildConfirmationDetail('Tree\nTwo', `qa · ${QA_USERNAME}`, QA_USERNAME, [
                { name: 'Account_Tree_Access', relativeFilePath: ACCOUNT_TREE_ACCESS_PATH, coveredObjectApiNames: ['Account', 'OtherChildObject__c'], grantedObjectApiNames: ['Account', 'OtherChildObject__c'] }
            ], 3);

            expect(detail).toContain('Tree: Tree Two');
            expect(detail).toContain(`Org: qa · ${QA_USERNAME}`);
            expect(detail).toContain(`Assigned to: ${QA_USERNAME}, the user this org is authorized as`);
            expect(detail).toContain('1 permission set:\n  Account_Tree_Access — partial, 2 of 3: Account, OtherChildObject__c');
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
            panelState.pendingDeployableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            panelState.deployableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            return panelState;
        };

        const permissionSetMessage = { command: 'deployTreePermissionSets', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY };

        it('refuses the selected org until its readiness was posted, since a describe taken before the assignment would put back what it removed', () => {

            const panelState = buildPanelState();
            panelState.dataOrgSelection.isReadinessPosted = false;

            expect(RecipeCockpitService.routePanelMessage(permissionSetMessage, panelState)).toMatchObject({
                kind: 'postMetadataDeployState',
                hostMessage: { command: 'metadataDeployState', isRunning: false },
                refusalText: 'Nothing was deployed or assigned: the org selected above is still being checked. Try again once that check has finished.'
            });
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreePermissionSets', treeKey: ACCOUNT_TREE_KEY }, panelState)?.kind).toBe('deployTreePermissionSets');

        });

        it('routes the tree KEY and whether the selection is the org, never anything else', () => {

            expect(RecipeCockpitService.routePanelMessage({ ...permissionSetMessage, names: ['Evil'], username: 'prod@example.com' } as any, buildPanelState()))
                .toEqual({ kind: 'deployTreePermissionSets', treeKey: ACCOUNT_TREE_KEY, isSelectedOrg: true });

        });

        it('routes a message with no org index to the host\'s own org prompt', () => {

            const panelState = buildPanelState();
            panelState.dataOrgSelection = undefined;

            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreePermissionSets', treeKey: ACCOUNT_TREE_KEY }, panelState))
                .toEqual({ kind: 'deployTreePermissionSets', treeKey: ACCOUNT_TREE_KEY, isSelectedOrg: false });

        });

        it('refuses a tree the panel has not confirmed drawing, a key that is not a string, and an org index that is not a sandbox selection', () => {

            const panelState = buildPanelState();

            expect(RecipeCockpitService.routePanelMessage({ ...permissionSetMessage, treeKey: 'Lead-ONLY' }, panelState)?.kind).toBe('postMetadataDeployState');
            expect(RecipeCockpitService.routePanelMessage({ ...permissionSetMessage, treeKey: 7 }, panelState)?.kind).toBe('postMetadataDeployState');
            expect(RecipeCockpitService.routePanelMessage({ ...permissionSetMessage, orgIndex: 1 }, panelState)).toEqual({
                kind: 'postMetadataDeployState',
                hostMessage: { command: 'metadataDeployState', isRunning: false },
                refusalText: expect.stringContaining('has not answered that it is a sandbox')
            });

            panelState.dataOrgSelection.orgTypeDetail = { isSandbox: false, organizationType: 'Enterprise Edition' };
            expect(RecipeCockpitService.routePanelMessage(permissionSetMessage, panelState)?.kind).toBe('postMetadataDeployState');

            panelState.deployableTreeKeys = new Set();
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreePermissionSets', treeKey: ACCOUNT_TREE_KEY }, panelState)?.kind).toBe('postMetadataDeployState');

        });

        it('answers a refusal with an idle state and no text of its own, and refuses a selection that has not answered its org type', () => {

            const panelState = buildPanelState();
            panelState.metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: false };

            expect(RecipeCockpitService.routePanelMessage({ ...permissionSetMessage, treeKey: 'Lead-ONLY' }, panelState)).toEqual({ kind: 'postMetadataDeployState', hostMessage: { command: 'metadataDeployState', isRunning: false } });

            panelState.dataOrgSelection.orgTypeDetail = undefined;
            expect(RecipeCockpitService.routePanelMessage(permissionSetMessage, panelState)?.kind).toBe('postMetadataDeployState');

        });

        it('shares the metadata deploy\'s lock: refused while a deploy, a scratch org run or an insert holds it, and holding them all while it runs', () => {

            const panelState = buildPanelState();

            panelState.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true };
            expect(RecipeCockpitService.routePanelMessage(permissionSetMessage, panelState)?.kind).toBe('postMetadataDeployState');

            panelState.scratchOrgStateMessage = undefined;
            panelState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };
            expect(RecipeCockpitService.routePanelMessage(permissionSetMessage, panelState)?.kind).toBe('postMetadataDeployState');

            panelState.insertStateMessage = undefined;
            panelState.metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: true };
            panelState.dataOrgObjectApiNames = new Set(['Account']);
            panelState.insertableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.set(ACCOUNT_TREE_KEY, '/workspace/account.yml');

            expect(RecipeCockpitService.routePanelMessage(permissionSetMessage, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeMetadata', treeKey: ACCOUNT_TREE_KEY }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'insertTree', treeKey: ACCOUNT_TREE_KEY }, panelState)?.kind).toBe('postInsertState');
            expect(RecipeCockpitService.routePanelMessage({ command: 'createScratchOrg' }, panelState)?.kind).toBe('postScratchOrgState');
            expect(RecipeCockpitService.routePanelMessage({ command: 'selectDataOrg', orgIndex: 0 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'openDataOrg', orgIndex: 0 }, panelState)).toEqual({ kind: 'postOrgOpenState', hostMessage: { command: 'orgOpenState', isRunning: false } });

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
        let deployHandler: (argumentList: string[]) => { stdout: string; error?: unknown } | 'hold';
        let assignHandler: (argumentList: string[]) => { stdout: string; error?: unknown } | 'hold';
        let heldCallbacks: Array<() => void>;
        let cancellationListeners: Array<() => void>;
        let cancellationToken: { isCancellationRequested: boolean; onCancellationRequested: (listener: () => void) => void };
        let notificationWarningSpy: jest.SpyInstance;
        let notificationInformationSpy: jest.SpyInstance;
        let describeCalls: string[];
        let childKill: jest.Mock;
        let workspaceState: { get: jest.Mock; update: jest.Mock };

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const deployCalls = () => cliCalls.filter(argumentList => argumentList[0] === 'project');
        const assignCalls = () => cliCalls.filter(argumentList => argumentList[0] === 'org' && argumentList[1] === 'assign');
        const lastDeployState = () => postedNamed('metadataDeployState').at(-1);
        // HOW A RUN ENDED (#301): THE NOTIFICATIONS THAT ARE NOT A MODAL, AS [text, ...buttons]
        const runNotifications = (notify: unknown) => ( notify as jest.Mock ).mock.calls.filter(notificationCall => !notificationCall[1]?.modal);
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
        const quickPick = () => vscode.window.showQuickPick as jest.Mock;
        const modalCalls = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.filter(([, options]) => options?.modal);

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

        const deployPermissionSets = async (treeKey: string = ACCOUNT_TREE_KEY, orgIndex: number | null = 0) => {
            await receivedMessageHandler({ command: 'deployTreePermissionSets', treeKey: treeKey, ...( orgIndex === null ? {} : { orgIndex: orgIndex } ) });
            await flushAsyncWork();
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-permission-sets-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(TREE_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.cpSync(METADATA_DEPLOY_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
            fs.mkdirSync(path.join(temporaryRoot, 'installed', 'bin'), { recursive: true });
            ['sf', 'sf.cmd'].forEach(executableName => fs.writeFileSync(path.join(temporaryRoot, 'installed', 'bin', executableName), ''));
            savedPathVariable = process.env.PATH;
            process.env.PATH = path.join(temporaryRoot, 'installed', 'bin');

            SalesforceOrgService.clearConnectedOrgStatusCache();
            SalesforceOrgService.clearDescribeCache();
            (RecipeCockpitService as any).isMetadataDeployInFlight = false;
            (RecipeCockpitService as any).metadataDeployRunStateMessage = undefined;
            (RecipeCockpitService as any).isScratchOrgSetupInFlight = false;
            (RecipeCockpitService as any).scratchOrgRunStateMessage = undefined;

            postedPanelMessages = [];
            cliCalls = [];
            describeCalls = [];
            heldCallbacks = [];
            cancellationListeners = [];
            organizationAnswers = [];
            childKill = jest.fn();
            workspaceState = { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) };
            deployHandler = () => ({ stdout: buildDeployAnswer() });
            assignHandler = argumentList => ({ stdout: buildAssignAnswer(argumentList.filter((_argument, argumentIndex) => argumentList[argumentIndex - 1] === '--name')) });

            (execFile as unknown as jest.Mock).mockReset();
            (execFile as unknown as jest.Mock).mockImplementation((_command: string, argumentList: string[], _options: unknown, callback: any) => {
                cliCalls.push(argumentList);
                const answerWith = (cliAnswer: { stdout: string; error?: unknown }) => setImmediate(() => callback(cliAnswer.error ?? null, cliAnswer.stdout, ''));
                if ( argumentList[0] === 'org' && argumentList[1] === 'list' ) {
                    answerWith({ stdout: JSON.stringify(SF_ORG_LIST) });
                } else {
                    const cliAnswer = argumentList[0] === 'project' ? deployHandler(argumentList) : assignHandler(argumentList);
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
            notificationWarningSpy = jest.spyOn(VSCodeWorkspaceService, 'showWarningMessage').mockImplementation(() => undefined);
            notificationInformationSpy = jest.spyOn(VSCodeWorkspaceService, 'showInformationMessage').mockImplementation(() => undefined);
            jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            jest.spyOn(SalesforceOrgService, 'getConnection').mockImplementation(async () => ({
                describe: jest.fn().mockImplementation(async (objectApiName: string) => {
                    describeCalls.push(objectApiName);
                    return { name: objectApiName, createable: true, fields: [] };
                }),
                query: jest.fn().mockImplementation(async (soql: string) => (
                    soql.includes('FROM Organization')
                        ? { records: [organizationAnswers.shift() ?? { IsSandbox: true, OrganizationType: 'Developer Edition' }] }
                        : Promise.reject(new Error(`A query was sent that should not have been: ${soql}`))
                )),
                sobject: jest.fn()
            }) as any);

            (RecipeCockpitService as any).recipeCockpitPanel = undefined;
            (RecipeCockpitService as any).recipeCockpitMessageSubscription = undefined;

        });

        afterEach(() => {
            process.env.PATH = savedPathVariable;
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        it('offers the covering permission sets in a multi-select pick, names the org and every pick in an escaped modal, deploys them, then assigns them to the org\'s user', async () => {

            await openCockpitWithQaSelected();
            const clearSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');
            const describesBefore = describeCalls.length;

            await deployPermissionSets();

            const [pickItems, pickOptions] = quickPick().mock.calls[0];
            expect(pickOptions).toMatchObject({ canPickMany: true });
            expect(pickItems.map((pickItem: any) => [pickItem.label, pickItem.description, pickItem.detail])).toEqual([
                ['Account_Tree_Access', 'partial, 2 of 3: Account, OtherChildObject__c', ACCOUNT_TREE_ACCESS_PATH],
                ['Contact_Reader', 'partial, 1 of 3: Contact', CONTACT_READER_PATH]
            ]);

            const [modalMessage, modalOptions, modalAction] = modalCalls()[0];
            expect(modalMessage).toBe(`Deploy and assign 2 permission sets for Relationship Tree 1 in qa · ${QA_USERNAME}?`);
            expect(modalOptions.detail).toContain(`Org: qa · ${QA_USERNAME}`);
            expect(modalOptions.detail).toContain('  Account_Tree_Access — partial, 2 of 3: Account, OtherChildObject__c');
            expect(modalOptions.detail).toContain('  Contact_Reader — partial, 1 of 3: Contact');
            expect(modalAction).toBe(RECIPE_COCKPIT_PERMISSION_SET_CONFIRM_LABEL);

            expect(deployCalls()).toEqual([[
                'project', 'deploy', 'start', '--json', '--target-org', QA_USERNAME,
                '--metadata', 'PermissionSet:Account_Tree_Access', '--metadata', 'PermissionSet:Contact_Reader'
            ]]);
            expect(assignCalls()).toEqual([[
                'org', 'assign', 'permset', '--json', '--target-org', QA_USERNAME,
                '--name', 'Account_Tree_Access', '--name', 'Contact_Reader'
            ]]);
            expect(cliCalls.indexOf(deployCalls()[0])).toBeLessThan(cliCalls.indexOf(assignCalls()[0]));
            // PROJECT MODE: THE WORKSPACE IS THE WORKING DIRECTORY, AND sf IS RUN BY ITS ABSOLUTE PATH FROM PATH
            const projectCalls = (execFile as unknown as jest.Mock).mock.calls.filter(([, argumentList]) => argumentList[0] !== 'org' || argumentList[1] !== 'list');
            projectCalls.forEach(([command, , execOptions]) => {
                expect(execOptions.cwd).toBe(path.resolve(workspaceRoot));
                expect(path.isAbsolute(String(command).replace(/^"|"$/g, ''))).toBe(true);
            });

            const doneText = `Deployed and assigned 2 permission sets for Relationship Tree 1 to ${QA_USERNAME} in qa · ${QA_USERNAME}.`;
            // THE NOTIFICATION IS ALL THE READER IS TOLD, AND ITS "View output" OPENS THE ASSIGNMENT'S RESULT (#301)
            expect(runNotifications(vscode.window.showInformationMessage)).toEqual([[doneText, RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL]]);
            expect(postedNamed('metadataDeployState')).toEqual([{ command: 'metadataDeployState', isRunning: true }, { command: 'metadataDeployState', isRunning: false }]);

            const operationsFolderPath = path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, QA_USERNAME);
            const resultFiles = fs.readdirSync(operationsFolderPath);
            expect(resultFiles.filter(fileName => fileName.endsWith('-permission-set-deploy.json'))).toHaveLength(1);
            expect(resultFiles.filter(fileName => fileName.endsWith('-permission-set-assign.json'))).toHaveLength(1);

            // FIELD-LEVEL SECURITY CHANGES WHAT A DESCRIBE ANSWERS: THE COVERED OBJECTS ARE DESCRIBED AFRESH FOR THE CARD
            ACCOUNT_TREE_OBJECTS.forEach(objectApiName => expect(clearSpy).toHaveBeenCalledWith(QA_USERNAME, objectApiName));
            expect(describeCalls.slice(describesBefore)).toEqual(expect.arrayContaining(['Account', 'OtherChildObject__c']));
            expect(postedPanelMessages.indexOf(lastDeployState())).toBeGreaterThan(postedPanelMessages.indexOf(postedNamed('dataOrgReadiness').at(-1)));

        });

        it('drops and re-checks the describes of every object a pick grants on, another card\'s included, matched case-insensitively', async () => {

            const accessFilePath = path.join(workspaceRoot, ACCOUNT_TREE_ACCESS_PATH);
            fs.writeFileSync(accessFilePath, fs.readFileSync(accessFilePath, 'utf-8').replace('<label>', '<objectPermissions><allowRead>true</allowRead><object>lead</object></objectPermissions>\n    <label>'));
            await openCockpitWithQaSelected();
            const clearSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');
            const describesBefore = describeCalls.length;

            await deployPermissionSets();

            expect(clearSpy).toHaveBeenCalledWith(QA_USERNAME, 'lead');
            expect(clearSpy).not.toHaveBeenCalledWith(QA_USERNAME, 'User');
            // THE Lead CARD IS CHECKED AGAIN, SO ITS OBJECT IS DESCRIBED AFRESH
            expect(describeCalls.slice(describesBefore)).toContain('Lead');

        });

        it('deploys and assigns only what the reader picked', async () => {

            await openCockpitWithQaSelected();
            quickPick().mockImplementation(async (items: any[]) => items.filter(item => item.label === 'Contact_Reader'));

            await deployPermissionSets();

            expect(modalCalls()[0][0]).toBe(`Deploy and assign 1 permission set for Relationship Tree 1 in qa · ${QA_USERNAME}?`);
            expect(deployCalls()[0]).toEqual(['project', 'deploy', 'start', '--json', '--target-org', QA_USERNAME, '--metadata', 'PermissionSet:Contact_Reader']);
            expect(assignCalls()[0].slice(-2)).toEqual(['--name', 'Contact_Reader']);

        });

        it('escapes every repository text in the modal', async () => {

            await openCockpitWithQaSelected();
            panelState().recipeDataMessage.recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY).customName = 'Run [me](command:evil)';

            await deployPermissionSets();

            const [modalMessage, modalOptions] = modalCalls()[0];
            expect(modalMessage).not.toMatch(/[[\]()]/);
            expect(modalOptions.detail).not.toMatch(/[[\]()]/);
            expect(modalOptions.detail).toContain('Tree: Run \\u005bme\\u005d\\u0028command:evil\\u0029');
            const progressTitles = (vscode.window.withProgress as jest.Mock).mock.calls.map(([progressOptions]) => progressOptions.title);
            expect(progressTitles).toHaveLength(2);
            progressTitles.forEach(progressTitle => expect(progressTitle).not.toMatch(/[[\]()]/));

        });

        it('with no org selected, asks for one from the Treecipe tab\'s list after the pick, and makes it the selection once confirmed', async () => {

            await openCockpit();
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockImplementation(async (orgListing: Promise<any>) => {
                expect(quickPick()).toHaveBeenCalledTimes(1);
                const listing = await orgListing;
                return listing.orgDetails.find((orgDetail: any) => orgDetail.username === QA_USERNAME);
            });

            await deployPermissionSets(ACCOUNT_TREE_KEY, null);
            await flushAsyncWork();

            expect(promptSpy.mock.calls[0][1]).toBe(RECIPE_COCKPIT_PERMISSION_SET_ORG_PLACEHOLDER);
            expect(assignCalls()).toHaveLength(1);
            expect(workspaceState.update).toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, QA_USERNAME);
            expect(panelState().dataOrgSelection?.orgDetail.username).toBe(QA_USERNAME);
            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false });

        });

        it('says so and runs nothing when no permission set in source covers the tree, opening no pick and no org prompt', async () => {

            fs.rmSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'permissionsets'), { recursive: true });
            fs.rmSync(path.join(workspaceRoot, 'unpackaged', 'permissionsets'), { recursive: true });
            await openCockpit();
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed');

            await deployPermissionSets(ACCOUNT_TREE_KEY, null);

            expect(notificationInformationSpy).toHaveBeenCalledWith('No permission set in this workspace\'s source grants access to any object of Relationship Tree 1, so nothing was deployed or assigned.');
            expect(quickPick()).not.toHaveBeenCalled();
            expect(promptSpy).not.toHaveBeenCalled();
            expect(cliCalls.filter(argumentList => argumentList[1] !== 'list')).toEqual([]);
            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false });

        });

        it('warns about a permission set file it cannot parse, and still offers the rest', async () => {

            fs.writeFileSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'permissionsets', 'Broken.permissionset-meta.xml'), '<PermissionSet><');
            await openCockpitWithQaSelected();

            await deployPermissionSets();

            expect(notificationWarningSpy).toHaveBeenCalledWith('Skipped 1 permission set file that could not be read as a permission set with an api name: force-app/main/default/permissionsets/Broken.permissionset-meta.xml.');
            expect(quickPick().mock.calls[0][0].map((pickItem: any) => pickItem.label)).toEqual(['Account_Tree_Access', 'Contact_Reader']);
            expect(assignCalls()).toHaveLength(1);

        });

        it('runs nothing when the pick is dismissed or left empty, or the confirmation is cancelled', async () => {

            await openCockpitWithQaSelected();

            quickPick().mockResolvedValueOnce(undefined);
            await deployPermissionSets();
            quickPick().mockResolvedValueOnce([]);
            await deployPermissionSets();
            expect(modalCalls()).toEqual([]);

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);
            await deployPermissionSets();

            expect(modalCalls()).toHaveLength(1);
            expect(deployCalls()).toEqual([]);
            expect(assignCalls()).toEqual([]);
            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false });

        });

        it('refuses more picks than the command line can carry', async () => {

            await openCockpitWithQaSelected();
            quickPick().mockImplementation(async (items: any[]) => Array.from({ length: PERMISSION_SET_MAX_PICKS + 1 }, () => items[0]));

            await deployPermissionSets();

            expect(modalCalls()).toEqual([]);
            expect(deployCalls()).toEqual([]);
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining(`at most ${PERMISSION_SET_MAX_PICKS} can be deployed and assigned at once`));

        });

        it('asks the Organization row again after the confirmation, and runs nothing in an org that does not answer it is a sandbox', async () => {

            await openCockpitWithQaSelected();
            organizationAnswers.push({ IsSandbox: false, OrganizationType: 'Enterprise Edition' });

            await deployPermissionSets();

            expect(deployCalls()).toEqual([]);
            expect(assignCalls()).toEqual([]);
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining('Permission sets are deployed and assigned only in a sandbox or scratch org.'));
            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false });

        });

        it('neither runs nor selects anything for a PROMPTED org that answers it is production', async () => {

            await openCockpit();
            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockResolvedValueOnce({ targetOrgIdentifier: 'qa', username: QA_USERNAME, alias: 'qa' });
            organizationAnswers.push({ IsSandbox: false, OrganizationType: 'Enterprise Edition' });

            await deployPermissionSets(ACCOUNT_TREE_KEY, null);

            expect(deployCalls()).toEqual([]);
            expect(workspaceState.update).not.toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, expect.anything());

        });

        it('runs no assign when the deploy fails, and shows the CLI\'s problem as an error', async () => {

            deployHandler = () => ({ stdout: buildDeployAnswer([{ fullName: 'Contact_Reader', problem: 'In field: field - no CustomField named Contact.Email found' }]), error: Object.assign(new Error('exit 1'), { code: 1 }) });
            await openCockpitWithQaSelected();

            await deployPermissionSets();

            expect(deployCalls()).toHaveLength(1);
            expect(assignCalls()).toEqual([]);
            expect((vscode.window.showErrorMessage as jest.Mock).mock.calls[0][0]).toContain('failed, so nothing was assigned: Contact_Reader: In field: field - no CustomField named Contact.Email found');
            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false });

        });

        it('says the Salesforce CLI is required when sf is not installed', async () => {

            process.env.PATH = path.join(temporaryRoot, 'nowhere');
            await openCockpitWithQaSelected();

            await deployPermissionSets();

            expect((vscode.window.showErrorMessage as jest.Mock).mock.calls[0][0]).toContain('The Salesforce CLI is required to deploy and assign permission sets, and "sf" is not installed or not on PATH.');
            expect(deployCalls()).toEqual([]);
            expect(assignCalls()).toEqual([]);

        });

        it('on Windows deploys and assigns nothing from a UNC project folder, which cmd.exe would swap for the Windows folder (#285)', async () => {

            await openCockpitWithQaSelected();
            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(true);
            jest.spyOn(PicklistDependencyCheckService, 'isUncPath').mockReturnValue(true);

            await deployPermissionSets();

            expect(deployCalls()).toEqual([]);
            expect(assignCalls()).toEqual([]);
            expect((vscode.window.showErrorMessage as jest.Mock).mock.calls[0][0]).toContain('is a network UNC path');
            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false });

        });

        // #301: THE RESULT FILE IS THE SUCCESS NOTIFICATION'S BUTTON, NOT A LINK IN THE PANEL
        it('opens the assignment\'s saved result from the success notification\'s View output', async () => {

            (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL);
            await openCockpitWithQaSelected();

            await deployPermissionSets();
            await flushAsyncWork();

            const operationsFolderPath = path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, QA_USERNAME);
            const assignResultFileName = fs.readdirSync(operationsFolderPath).find(fileName => fileName.endsWith('-permission-set-assign.json'));
            expect(VSCodeWorkspaceService.openFileInEditor).toHaveBeenCalledWith(path.join(operationsFolderPath, assignResultFileName));
            expect(postedNamed('metadataDeployState').at(-1)).toEqual({ command: 'metadataDeployState', isRunning: false });

        });

        it('counts a permission set the user already holds as a success', async () => {

            assignHandler = () => ({
                stdout: buildAssignAnswer(['Account_Tree_Access'], [{ name: QA_USERNAME, message: 'Duplicate PermissionSetAssignment. Assignee: 005x, PermissionSet: 0PSx' }]),
                error: Object.assign(new Error('exit 1'), { code: 1 })
            });
            await openCockpitWithQaSelected();

            await deployPermissionSets();

            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(runNotifications(vscode.window.showInformationMessage).at(-1)[0]).toContain('Contact_Reader was already assigned.');
            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false });

        });

        it('names which permission sets failed in a partial assignment', async () => {

            assignHandler = () => ({
                stdout: buildAssignAnswer(['Account_Tree_Access'], [{ name: QA_USERNAME, message: 'Permission set "Contact_Reader" not found in target org.' }]),
                error: Object.assign(new Error('exit 1'), { code: 1 })
            });
            await openCockpitWithQaSelected();

            await deployPermissionSets();

            const errorText = (vscode.window.showErrorMessage as jest.Mock).mock.calls[0][0];
            expect(errorText).toContain(`but Contact_Reader could not be assigned to ${QA_USERNAME}`);
            expect(errorText).toContain('Assigned: Account_Tree_Access.');
            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false });

        });

        it('kills the process tree on cancel, assigns nothing, and refuses a metadata deploy meanwhile', async () => {

            deployHandler = () => 'hold';
            await openCockpitWithQaSelected();
            const killSpy = jest.spyOn(PicklistDependencyCheckService, 'killProcessTree');

            const runInFlight = deployPermissionSets();
            await flushAsyncWork();
            await flushAsyncWork();

            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: true });

            await receivedMessageHandler({ command: 'deployTreeMetadata', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY });
            await receivedMessageHandler({ command: 'deployTreePermissionSets', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY });
            expect(deployCalls()).toHaveLength(1);

            cancellationToken.isCancellationRequested = true;
            cancellationListeners.forEach(cancellationListener => cancellationListener());
            heldCallbacks.forEach(answer => answer());
            await runInFlight;
            await flushAsyncWork();

            expect(killSpy).toHaveBeenCalled();
            expect(childKill).toHaveBeenCalled();
            expect(assignCalls()).toEqual([]);
            expect(notificationInformationSpy).toHaveBeenCalledWith(expect.stringContaining('was cancelled, so whether it applied is unknown. Nothing was assigned.'));
            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false });

        });

        it('refuses before the pick or any org prompt when the workspace has no sfdx-project.json', async () => {

            fs.rmSync(path.join(workspaceRoot, 'sfdx-project.json'));
            await openCockpit();
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed');

            await deployPermissionSets(ACCOUNT_TREE_KEY, null);

            expect(quickPick()).not.toHaveBeenCalled();
            expect(promptSpy).not.toHaveBeenCalled();
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining('Nothing was deployed or assigned: No "sfdx-project.json" found'));
            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false });

        });

        it('says so when the org list cannot be read for the prompt, and runs nothing when the prompt is dismissed', async () => {

            await openCockpit();
            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed')
                .mockRejectedValueOnce(new Error('The Salesforce CLI could not report which authorized orgs are connected.'))
                .mockResolvedValueOnce(undefined);

            await deployPermissionSets(ACCOUNT_TREE_KEY, null);
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining('Nothing was deployed or assigned: The Salesforce CLI could not report'));

            await deployPermissionSets(ACCOUNT_TREE_KEY, null);
            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false });

            expect(modalCalls()).toEqual([]);
            expect(deployCalls()).toEqual([]);

        });

        it('runs nothing when the org cannot be connected to for the second Organization check', async () => {

            await openCockpitWithQaSelected();
            (SalesforceOrgService.getConnection as jest.Mock).mockRejectedValueOnce(new Error('expired access token'));

            await deployPermissionSets();

            expect(deployCalls()).toEqual([]);
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining(`could not connect to qa · ${QA_USERNAME}: expired access token`));

        });

        it('assigns nothing after a deploy that timed out, and says whether it applied is unknown', async () => {

            await openCockpitWithQaSelected();
            const runSpy = jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli').mockResolvedValue({ stdout: '', stderr: '', exitCode: null, timedOut: true });

            await deployPermissionSets();

            expect(runSpy).toHaveBeenCalledTimes(1);
            const warningTexts = (vscode.window.showWarningMessage as jest.Mock).mock.calls.map(([warningText]) => warningText);
            expect(warningTexts.at(-1)).toContain('so whether it applied is unknown. Nothing was assigned.');
            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false });

        });

        it('says which were assigned is unknown when the assignment times out, is cancelled, or finds no CLI after the deploy', async () => {

            await openCockpitWithQaSelected();
            const runSpy = jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli');

            runSpy.mockResolvedValueOnce({ stdout: buildDeployAnswer(), stderr: '', exitCode: 0 }).mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: null, timedOut: true });
            await deployPermissionSets();
            expect(runNotifications(vscode.window.showWarningMessage).at(-1)[0]).toBe('The permission sets were deployed. The assignment did not finish in time and was stopped, so which permission sets were assigned is unknown.');

            runSpy.mockResolvedValueOnce({ stdout: buildDeployAnswer(), stderr: '', exitCode: 0 })
                .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: null, spawnError: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) });
            await deployPermissionSets();
            expect(runNotifications(vscode.window.showErrorMessage).at(-1)).toEqual([expect.stringContaining('The Salesforce CLI is required')]);

            runSpy.mockResolvedValueOnce({ stdout: buildDeployAnswer(), stderr: '', exitCode: 0 }).mockImplementationOnce(async (_argumentList, registerCancellation) => {
                cancellationToken.isCancellationRequested = true;
                registerCancellation(jest.fn());
                return { stdout: '', stderr: '', exitCode: null };
            });
            await deployPermissionSets();
            expect(notificationInformationSpy).toHaveBeenLastCalledWith(expect.stringContaining('was cancelled after they were deployed'));
            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false });

        });

        it('ends the run and rethrows when the run itself throws, so the panel is given its buttons back', async () => {

            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
            await openCockpitWithQaSelected();
            jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli').mockRejectedValue(new Error('boom'));

            await deployPermissionSets();

            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false });
            expect(handleCapturedErrorSpy).toHaveBeenCalled();

        });

        it('answers with the deploy state and runs nothing when the tree is gone by the time the action runs', async () => {

            await openCockpitWithQaSelected();

            await (RecipeCockpitService as any).deployTreePermissionSetsFromPanel((RecipeCockpitService as any).recipeCockpitPanel, 'Gone-tree', false);

            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false });
            expect(quickPick()).not.toHaveBeenCalled();

        });

        it('names an org with no alias by its username, says an org that could not answer could not say it is a sandbox, and counts more skipped files than it names', async () => {

            const permissionSetsFolderPath = path.join(workspaceRoot, 'force-app', 'main', 'default', 'permissionsets');
            Array.from({ length: 11 }, (_unused, fileIndex) => fileIndex).forEach(fileIndex => fs.writeFileSync(path.join(permissionSetsFolderPath, `Broken_${String(fileIndex).padStart(2, '0')}.permissionset-meta.xml`), '<'));
            await openCockpit();
            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockResolvedValueOnce({ targetOrgIdentifier: QA_USERNAME, username: QA_USERNAME });
            jest.spyOn(SalesforceOrgService, 'queryOrganizationType').mockResolvedValueOnce(undefined);

            await deployPermissionSets(ACCOUNT_TREE_KEY, null);

            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringMatching(/^Skipped 11 permission set files .* and 1 more\.$/));
            expect(modalCalls()[0][0]).toBe(`Deploy and assign 2 permission sets for Relationship Tree 1 in ${QA_USERNAME}?`);
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining(`${QA_USERNAME} could not say whether it is a sandbox`));
            expect(deployCalls()).toEqual([]);

        });

        it('says every pick was already assigned in the plural, and names none assigned when every pick failed', async () => {

            await openCockpitWithQaSelected();

            assignHandler = () => ({ stdout: buildAssignAnswer([], [{ message: 'Duplicate PermissionSetAssignment' }]), error: Object.assign(new Error('exit 1'), { code: 1 }) });
            await deployPermissionSets();
            expect(runNotifications(vscode.window.showInformationMessage).at(-1)[0]).toContain('Account_Tree_Access, Contact_Reader were already assigned.');

            assignHandler = () => ({ stdout: buildAssignAnswer([], [{ message: 'insufficient access' }]), error: Object.assign(new Error('exit 1'), { code: 1 }) });
            await deployPermissionSets();
            expect(runNotifications(vscode.window.showErrorMessage).at(-1)).toEqual([
                `The permission sets were deployed, but Account_Tree_Access, Contact_Reader could not be assigned to ${QA_USERNAME}: insufficient access`,
                RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL
            ]);

        });

        it('is refused while a metadata deploy runs', async () => {

            await openCockpitWithQaSelected();
            (RecipeCockpitService as any).isMetadataDeployInFlight = true;

            await deployPermissionSets();

            expect(quickPick()).not.toHaveBeenCalled();
            expect(deployCalls()).toEqual([]);

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

        it('draws the button beside the deploy on every card with a folder, and posts the tree key alone', () => {

            const panel = renderTrees();
            const permissionSetButton = permissionSetButtonOf(panel);

            expect(permissionSetButton.textContent).toBe(RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL);
            expect(panel.isHidden(permissionSetButton)).toBe(false);
            expect(panel.isHidden(permissionSetButtonOf(panel, 'Lead'))).toBe(false);

            permissionSetButton.dispatch('click');

            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'deployTreePermissionSets', treeKey: ACCOUNT_TREE_KEY });
            expect(permissionSetButton.disabled).toBe(true);
            expect(panel.findAll(cardOf(panel, 'OtherChildObject__c'), 'treeDeploy')[0].disabled).toBe(true);

            permissionSetButton.dispatch('click');
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'deployTreePermissionSets')).toHaveLength(1);

        });

        it('posts the index of the org chosen above, and is held with every deploy while one runs', () => {

            const panel = renderTrees();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', hiddenOrgCount: 0, hiddenOrgNote: '', forgottenOrgNotice: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Sandbox', isSandbox: true, failureMessage: '', requestSequence: 5, renderSequence: 1 });

            panel.postToPanel({ command: 'metadataDeployState', isRunning: true });
            expect(permissionSetButtonOf(panel).disabled).toBe(true);
            expect(permissionSetButtonOf(panel, 'Lead').disabled).toBe(true);

            panel.postToPanel({ command: 'metadataDeployState', isRunning: false });
            expect(permissionSetButtonOf(panel).disabled).toBe(false);

            permissionSetButtonOf(panel).dispatch('click');
            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'deployTreePermissionSets', treeKey: ACCOUNT_TREE_KEY, orgIndex: 0 });

        });

        it('is named in the preview warning', () => {

            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('"Deploy & assign permission sets…", beside it, deploys the permission sets you pick');

        });

    });

});
