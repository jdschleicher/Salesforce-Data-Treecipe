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

import { AuthInfo, Org } from '@salesforce/core';
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
import { PERMISSION_SET_ASSIGN_TIMEOUT_MILLISECONDS, PERMISSION_SET_MAX_PICKS, RecipeCockpitPermissionSetAssign } from '../RecipeCockpitPermissionSetAssign';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { answerOrgConnectionPings } from '../../SalesforceOrgService/tests/OrgConnectionPings';
import { ORG_OPERATIONS_FOLDER_NAME } from '../../ScratchOrgService/ScratchOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { PicklistDependencyCheckService } from '../../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';
import { answerInPanelConfirmationsThroughWarningMock } from './RecipeCockpitConfirmationAnswers';

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const PERMISSION_SET_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'permissionSetWorkspace');
const SALESFORCE_ORG_MOCKS_PATH = path.join(__dirname, '..', '..', 'SalesforceOrgService', 'tests', 'mocks');

const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, 'utf-8'));
const ORG_AUTHORIZATIONS = readJson(path.join(SALESFORCE_ORG_MOCKS_PATH, 'orgAuthorizations.json'));

const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
// THE OBJECTS THE ACCOUNT CARD LISTS: User IS A LOOKUP TARGET WITH NO RECIPE
const ACCOUNT_TREE_OBJECTS = ['Account', 'Contact', 'OtherChildObject__c'];
const QA_USERNAME = 'qa@example.com.qa';

const ACCOUNT_TREE_ACCESS_PATH = 'force-app/main/default/permissionsets/Account_Tree_Access.permissionset-meta.xml';
const CONTACT_READER_PATH = 'unpackaged/permissionsets/Contact_Reader.permissionset-meta.xml';

const USER_ID = '005000000000001AAA';
const PS_ACCOUNT_ID = '0PS000000000001AAA';
const PS_CONTACT_ID = '0PS000000000002AAA';
const PS_GADGET_ID = '0PS000000000003AAA';
const PS_IDS_BY_NAME: Record<string, string> = { Account_Tree_Access: PS_ACCOUNT_ID, Contact_Reader: PS_CONTACT_ID, Gadget_Access: PS_GADGET_ID };

let savedRecordCount = 0;
const saved = () => ({ success: true, id: `0Pa${String(++savedRecordCount).padStart(12, '0')}AAA`, errors: [] });
const refused = (statusCode: string, message: string) => ({ success: false, errors: [{ statusCode: statusCode, message: message, fields: [] }] });

const planFor = (permissionSetNames: string[]) => ({
    sentNames: permissionSetNames,
    records: permissionSetNames.map((_permissionSetName, nameIndex) => ({ AssigneeId: USER_ID, PermissionSetId: `0PS${String(nameIndex + 1).padStart(12, '0')}AAA` })),
    unresolvedNames: [],
    unresolvedMessages: []
});

answerInPanelConfirmationsThroughWarningMock();

beforeEach(() => {
    jest.spyOn(SalesforceOrgService, 'readScratchOrgDetail').mockResolvedValue(undefined);
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

        it('plans one row per pick the org holds, assigned to the one user given and in the order picked, and never another assignee', () => {

            const plan = RecipeCockpitPermissionSetAssign.planAssignments(USER_ID, ['Contact_Reader', 'Account_Tree_Access'], [
                { id: PS_ACCOUNT_ID, name: 'account_tree_access' },
                { id: PS_CONTACT_ID, name: 'Contact_Reader' }
            ]);

            expect(plan).toEqual({
                sentNames: ['Contact_Reader', 'Account_Tree_Access'],
                records: [{ AssigneeId: USER_ID, PermissionSetId: PS_CONTACT_ID }, { AssigneeId: USER_ID, PermissionSetId: PS_ACCOUNT_ID }],
                unresolvedNames: [],
                unresolvedMessages: []
            });
            plan.records.forEach(assignmentRecord => expect(Object.keys(assignmentRecord)).toEqual(['AssigneeId', 'PermissionSetId']));

        });

        it('picks the project\'s unmanaged permission set beside a packaged one of the same name, and sends nothing for a name it cannot place', () => {

            const plan = RecipeCockpitPermissionSetAssign.planAssignments(USER_ID, ['Account_Tree_Access', 'Packaged_Only', 'Twice_Packaged', 'Not_Answered'], [
                { id: '0PS000000000009AAA', name: 'Account_Tree_Access', namespacePrefix: 'pkg' },
                { id: PS_ACCOUNT_ID, name: 'Account_Tree_Access' },
                { id: '0PS000000000010AAA', name: 'Packaged_Only', namespacePrefix: 'pkg' },
                { id: '0PS000000000011AAA', name: 'Twice_Packaged', namespacePrefix: 'one' },
                { id: '0PS000000000012AAA', name: 'Twice_Packaged', namespacePrefix: 'two' }
            ]);

            expect(plan.sentNames).toEqual(['Account_Tree_Access', 'Packaged_Only']);
            expect(plan.records.map(assignmentRecord => assignmentRecord.PermissionSetId)).toEqual([PS_ACCOUNT_ID, '0PS000000000010AAA']);
            expect(plan.unresolvedNames).toEqual(['Twice_Packaged', 'Not_Answered']);
            expect(plan.unresolvedMessages).toEqual(['the org holds more than one permission set named Twice_Packaged', 'the org did not name an Id for Not_Answered']);

        });

        it('refuses an assignee with no Salesforce Id, no pick, more picks than one request carries, and a name that is not an api name', () => {

            expect(() => RecipeCockpitPermissionSetAssign.planAssignments('not an id', ['A'], [])).toThrow('has no Salesforce Id');
            expect(() => RecipeCockpitPermissionSetAssign.planAssignments(USER_ID, [], [])).toThrow('No permission set was named, so nothing was assigned.');
            expect(() => RecipeCockpitPermissionSetAssign.planAssignments(USER_ID, Array.from({ length: PERMISSION_SET_MAX_PICKS + 1 }, (_unused, nameIndex) => `P${nameIndex}`), []))
                .toThrow(`At most ${PERMISSION_SET_MAX_PICKS} permission sets`);
            expect(() => RecipeCockpitPermissionSetAssign.planAssignments(USER_ID, ['Ok', 'X Y'], [])).toThrow('is not a Salesforce api name, so nothing was assigned.');
            expect(PERMISSION_SET_MAX_PICKS).toBe(200);

        });

        it('inserts every row in ONE PermissionSetAssignment request, each row landing on its own, and refuses more rows than one request carries', async () => {

            const create = jest.fn().mockResolvedValue([]);
            const sobject = jest.fn().mockReturnValue({ create: create });
            const records = [{ AssigneeId: USER_ID, PermissionSetId: PS_ACCOUNT_ID }];

            await RecipeCockpitPermissionSetAssign.insertAssignments({ sobject: sobject }, records);

            expect(sobject).toHaveBeenCalledWith('PermissionSetAssignment');
            expect(create).toHaveBeenCalledWith(records, { allowRecursive: false, allOrNone: false });
            await expect(RecipeCockpitPermissionSetAssign.insertAssignments({ sobject: sobject }, Array.from({ length: PERMISSION_SET_MAX_PICKS + 1 }, () => records[0])))
                .rejects.toThrow(`at most ${PERMISSION_SET_MAX_PICKS} rows`);
            expect(create).toHaveBeenCalledTimes(1);

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

            expect(RecipeCockpitPermissionSetAssign.readAssignmentSaveResults(planFor(['A', 'B']), [saved(), saved()]))
                .toEqual({ kind: 'assigned', assignedNames: ['A', 'B'], alreadyAssignedNames: [] });

        });

        it('counts a permission set the user already holds as assigned, by its DUPLICATE_VALUE code or its message', () => {

            expect(RecipeCockpitPermissionSetAssign.readAssignmentSaveResults(planFor(['A', 'B', 'C']), [
                saved(),
                refused('DUPLICATE_VALUE', 'duplicate value found: <unknown> duplicates value on record with id: <unknown>'),
                refused('', 'Duplicate PermissionSetAssignment. Assignee: 005x, PermissionSet: 0PSx')
            ])).toEqual({ kind: 'assigned', assignedNames: ['A'], alreadyAssignedNames: ['B', 'C'] });

        });

        it('names which picks failed in a partial assignment, and what the org said', () => {

            expect(RecipeCockpitPermissionSetAssign.readAssignmentSaveResults(planFor(['A', 'B', 'C']), [
                saved(),
                refused('FIELD_INTEGRITY_EXCEPTION', 'The user license doesn\'t allow the permission: Modify All Data'),
                refused('INSUFFICIENT_ACCESS_OR_READONLY', '')
            ])).toEqual({
                kind: 'notAllAssigned',
                assignedNames: ['A'],
                alreadyAssignedNames: [],
                failedNames: ['B', 'C'],
                failureMessages: ['The user license doesn\'t allow the permission: Modify All Data', 'INSUFFICIENT_ACCESS_OR_READONLY']
            });

        });

        it('never reads a pick the answer does not account for as assigned, nor a malformed answer as a success', () => {

            // ONE RESULT FOR TWO ROWS: NOTHING CAN BE PAIRED, SO NOTHING IS ASSIGNED
            expect(RecipeCockpitPermissionSetAssign.readAssignmentSaveResults(planFor(['A', 'B']), [saved()]))
                .toEqual({ kind: 'notAllAssigned', assignedNames: [], alreadyAssignedNames: [], failedNames: ['A', 'B'], failureMessages: ['The org\'s answer could not be matched to the permission sets sent.'] });
            expect(RecipeCockpitPermissionSetAssign.readAssignmentSaveResults(planFor(['A']), undefined)).toMatchObject({ kind: 'notAllAssigned', failedNames: ['A'] });
            expect(RecipeCockpitPermissionSetAssign.readAssignmentSaveResults(planFor(['A']), 'x')).toMatchObject({ kind: 'notAllAssigned', failedNames: ['A'] });
            // A SINGLE RESULT OBJECT FOR A SINGLE ROW IS READ AS THAT ROW'S
            expect(RecipeCockpitPermissionSetAssign.readAssignmentSaveResults(planFor(['A']), saved())).toMatchObject({ kind: 'assigned', assignedNames: ['A'] });
            [null, 'A', { success: true }, { success: true, id: 'bad' }, { success: 'true', id: '0Pa000000000001AAA' }, { success: false, errors: 'x' }, { errors: [{ statusCode: 'DUPLICATE_VALUE' }] }]
                .forEach(saveResult => expect(RecipeCockpitPermissionSetAssign.readAssignmentSaveResults(planFor(['A']), [saveResult])).toMatchObject({ kind: 'notAllAssigned', failedNames: ['A'] }));
            expect(RecipeCockpitPermissionSetAssign.readAssignmentSaveResults(planFor(['A']), [{ success: false, errors: [null, {}] }]))
                .toMatchObject({ failureMessages: ['the org gave no reason for A'] });

        });

        it('fails the picks the plan sent no row for, with its reason, beside what the org answered', () => {

            const plan = { ...planFor(['A']), unresolvedNames: ['B'], unresolvedMessages: ['the org holds more than one permission set named B'] };

            expect(RecipeCockpitPermissionSetAssign.readAssignmentSaveResults(plan, [saved()])).toEqual({
                kind: 'notAllAssigned',
                assignedNames: ['A'],
                alreadyAssignedNames: [],
                failedNames: ['B'],
                failureMessages: ['the org holds more than one permission set named B']
            });

        });

        it('names the tree, the org, the user and every pick with what it covers in the confirmation, each on one line', () => {

            const detail = RecipeCockpitService.flattenConfirmContent(RecipeCockpitPermissionSetAssign.buildConfirmationContent('Tree\nTwo', { alias: 'qa', username: QA_USERNAME }, [
                { name: 'Account_Tree_Access', relativeFilePath: ACCOUNT_TREE_ACCESS_PATH, coveredObjectApiNames: ['Account', 'OtherChildObject__c'], grantedObjectApiNames: ['Account', 'OtherChildObject__c'] }
            ], 3));

            expect(detail).toContain('Tree: Tree Two');
            expect(detail).toContain(`Org: qa · ${QA_USERNAME}`);
            expect(detail).toContain(`Assigned to: ${QA_USERNAME}, the user this org is authorized as`);
            expect(detail).toContain('Permission set · 1\n  Account_Tree_Access — partial, 2 of 3: Account, OtherChildObject__c');
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

    describe('the host, against a faked org connection', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let savedPathVariable: string | undefined;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let cliCalls: string[][];
        let organizationAnswers: Array<{ IsSandbox: boolean; OrganizationType: string }>;
        let orgPermissionSetNames: string[] | 'fail';
        let soqlQueries: string[];
        let insertCalls: Array<{ objectApiName: string; records: Array<{ AssigneeId: string; PermissionSetId: string }>; options: unknown }>;
        let insertHandler: (records: Array<{ AssigneeId: string; PermissionSetId: string }>) => unknown | Promise<unknown>;
        let userAnswer: unknown;
        let heldCallbacks: Array<() => void>;
        let notificationInformationSpy: jest.SpyInstance;
        let describeCalls: string[];
        let childKill: jest.Mock;
        let workspaceState: { get: jest.Mock; update: jest.Mock };

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const deployCalls = () => cliCalls.filter(argumentList => argumentList[0] === 'project');
        // THE PERMISSION SET NAMES EACH INSERT ASSIGNED, READ BACK FROM THE IDS IT SENT
        const assignCalls = () => insertCalls.map(insertCall => insertCall.records.map(assignmentRecord => Object.keys(PS_IDS_BY_NAME).find(permissionSetName => PS_IDS_BY_NAME[permissionSetName] === assignmentRecord.PermissionSetId)));
        const lastAssignState = () => postedNamed('permissionSetAssignState').at(-1);
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;
        const quickPick = () => vscode.window.showQuickPick as jest.Mock;
        const warningCalls = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls;
        const modalCalls = () => warningCalls().filter(([, options]) => options?.inPanel);
        // EVERY NON-MODAL WARNING: ITS TEXT, AND THE BUTTONS IT OFFERS
        const notificationWarnings = () => warningCalls()
            .filter(([, options]) => !( options && typeof options === 'object' && options.inPanel ))
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
            insertCalls = [];
            userAnswer = { records: [{ Id: USER_ID }] };
            organizationAnswers = [];
            orgPermissionSetNames = ['Account_Tree_Access', 'Contact_Reader', 'Gadget_Access'];
            childKill = jest.fn();
            workspaceState = { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) };
            insertHandler = records => records.map(() => saved());

            (execFile as unknown as jest.Mock).mockReset();
            (execFile as unknown as jest.Mock).mockImplementation((_command: string, argumentList: string[], _options: unknown, callback: any) => {
                cliCalls.push(argumentList);
                const answerWith = (cliAnswer: { stdout: string; error?: unknown }) => setImmediate(() => callback(cliAnswer.error ?? null, cliAnswer.stdout, ''));
                answerWith({ stdout: '', error: new Error(`A CLI process was started that should not have been: ${argumentList.join(' ')}`) });
                return { kill: childKill };
            });

            (AuthInfo.listAllAuthorizations as jest.Mock).mockImplementation(async () => ORG_AUTHORIZATIONS);
            answerOrgConnectionPings(Org.create as jest.Mock);

            (vscode.window.withProgress as jest.Mock).mockReset();
            (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options: unknown, progressTask: any) => await progressTask({ report: jest.fn() }, { isCancellationRequested: false, onCancellationRequested: jest.fn() }));
            (vscode.window.showWarningMessage as jest.Mock).mockReset();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_message: string, options: any) => options?.inPanel ? RECIPE_COCKPIT_PERMISSION_SET_CONFIRM_LABEL : undefined);
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
                    if ( soql.startsWith('SELECT Id, Name, NamespacePrefix FROM PermissionSet WHERE Name IN (') ) {
                        if ( orgPermissionSetNames === 'fail' ) {
                            throw new Error('INVALID_SESSION_ID: Session expired');
                        }
                        const presentNames = orgPermissionSetNames;
                        // SOQL MATCHES A NAME CASE-INSENSITIVELY, AND ANSWERS WITH THE ORG'S OWN SPELLING
                        return { records: presentNames
                            .filter(permissionSetName => soql.toLowerCase().includes(`'${permissionSetName.toLowerCase()}'`))
                            .map(permissionSetName => ({ Id: Object.entries(PS_IDS_BY_NAME).find(([knownName]) => knownName.toLowerCase() === permissionSetName.toLowerCase())?.[1], Name: permissionSetName, NamespacePrefix: null })) };
                    }
                    if ( soql.startsWith('SELECT Id FROM User WHERE Username = ') ) {
                        if ( userAnswer instanceof Error ) {
                            throw userAnswer;
                        }
                        return userAnswer;
                    }
                    throw new Error(`A query was sent that should not have been: ${soql}`);
                }),
                sobject: jest.fn().mockImplementation((objectApiName: string) => ({
                    create: jest.fn().mockImplementation(async (records: any[], options: unknown) => {
                        insertCalls.push({ objectApiName: objectApiName, records: records, options: options });
                        return await insertHandler(records);
                    })
                }))
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
            expect(modalMessage).toBe(`Assign 2 permission sets for Account-thru-OtherChildObject__c to ${QA_USERNAME} in qa · ${QA_USERNAME}?`);
            expect(modalOptions.detail).toContain(`Org: qa · ${QA_USERNAME}`);
            // #480: THE ORG IS ITS OWN PART, AND "Change org…" STARTS THE SAME ASSIGNMENT AGAIN, A SANDBOX ONLY
            const [, assignConfirmOptions] = (RecipeCockpitService.confirmInPanel as unknown as jest.Mock).mock.calls[0];
            expect(assignConfirmOptions.org).toEqual({ alias: 'qa', username: QA_USERNAME });
            expect(assignConfirmOptions.summary.join('\n')).not.toContain('Org:');
            expect(assignConfirmOptions.changeOrg).toEqual({ restartMessage: { command: 'assignTreePermissionSets', treeKey: ACCOUNT_TREE_KEY, orgIndex: null }, isSandboxOnly: true });
            expect(modalOptions.detail).toContain('  Account_Tree_Access — partial, 2 of 3: Account, OtherChildObject__c');
            expect(modalOptions.detail).toContain('Nothing is deployed.');
            expect(modalAction).toBe(RECIPE_COCKPIT_PERMISSION_SET_CONFIRM_LABEL);

            expect(soqlQueries).toContain('SELECT Id, Name, NamespacePrefix FROM PermissionSet WHERE Name IN (\'Account_Tree_Access\', \'Contact_Reader\')');
            expect(soqlQueries).toContain(`SELECT Id FROM User WHERE Username = '${QA_USERNAME}'`);
            expect(deployCalls()).toEqual([]);
            // #500: ONE INSERT ON THE CONNECTION, EVERY ROW TO THE AUTHORIZED USER, EACH LANDING ON ITS OWN; NO CLI PROCESS AT ALL
            expect(insertCalls).toEqual([{
                objectApiName: 'PermissionSetAssignment',
                records: [{ AssigneeId: USER_ID, PermissionSetId: PS_ACCOUNT_ID }, { AssigneeId: USER_ID, PermissionSetId: PS_CONTACT_ID }],
                options: { allowRecursive: false, allOrNone: false }
            }]);
            expect(cliCalls).toEqual([]);
            const [progressOptions] = (vscode.window.withProgress as jest.Mock).mock.calls.at(-1);
            expect(progressOptions.cancellable).toBe(false);

            expect(notificationInformationSpy).toHaveBeenCalledWith(`Assigned 2 permission sets for Account-thru-OtherChildObject__c to ${QA_USERNAME} in qa · ${QA_USERNAME}.`);
            expect(notificationWarnings()).toEqual([]);
            // THE PANEL IS TOLD ONLY THAT IT RAN AND THAT IT ENDED: NO TEXT, NO LINE, NO OUTPUT LINK
            expect(postedNamed('permissionSetAssignState')).toEqual([
                { command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY },
                { command: 'permissionSetAssignState', isRunning: false, treeKey: ACCOUNT_TREE_KEY }
            ]);

            const operationsFolderPath = path.join(path.resolve(workspaceRoot), 'treecipe', 'GeneratedRecipes', 'recipe-2026-09-20T10-00-00', 'Account-thru-OtherChildObject__c', 'RunArtifacts', ORG_OPERATIONS_FOLDER_NAME, QA_USERNAME);
            const resultFiles = fs.readdirSync(operationsFolderPath);
            expect(resultFiles.filter(fileName => fileName.endsWith('-permission-set-assign.json'))).toHaveLength(1);
            expect(resultFiles.filter(fileName => fileName.includes('deploy'))).toEqual([]);
            const resultFileName = resultFiles.find(fileName => fileName.endsWith('-permission-set-assign.json')) as string;
            expect(JSON.parse(fs.readFileSync(path.join(operationsFolderPath, resultFileName), 'utf-8'))).toEqual(expect.objectContaining({
                assigneeUsername: QA_USERNAME,
                assigneeId: USER_ID,
                permissionSets: [{ name: 'Account_Tree_Access', id: PS_ACCOUNT_ID }, { name: 'Contact_Reader', id: PS_CONTACT_ID }],
                saveResults: [expect.objectContaining({ success: true }), expect.objectContaining({ success: true })],
                outcome: { kind: 'assigned', assignedNames: ['Account_Tree_Access', 'Contact_Reader'], alreadyAssignedNames: [] }
            }));
            // THE HISTORY'S SUMMARY (#485) NAMES THE RESULT FILE BESIDE IT
            const summaryFileName = resultFiles.find(fileName => fileName.endsWith('-permission-set-assign-summary.json')) as string;
            expect(JSON.parse(fs.readFileSync(path.join(operationsFolderPath, summaryFileName), 'utf-8'))).toEqual(expect.objectContaining({
                step: 'permission-set-assign',
                outcome: 'succeeded',
                orgUsername: QA_USERNAME,
                orgAlias: 'qa',
                succeededCount: 2,
                fileNames: resultFiles.filter(fileName => fileName.endsWith('-permission-set-assign.json'))
            }));

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

            expect(assignCalls()).toEqual([['Account_Tree_Access']]);
            expect(notificationWarnings()).toContainEqual({
                text: `Not in qa · ${QA_USERNAME}: Contact_Reader. Deploy this permission set to the org, then assign it.`,
                actions: []
            });
            expect(notificationInformationSpy).toHaveBeenCalledWith(`Assigned 1 permission set for Account-thru-OtherChildObject__c to ${QA_USERNAME} in qa · ${QA_USERNAME}.`);
            // ONLY WHAT AN ASSIGNED PICK GRANTS ON IS DROPPED
            expect(clearSpy).toHaveBeenCalledWith(QA_USERNAME, 'Account');
            expect(clearSpy).not.toHaveBeenCalledWith(QA_USERNAME, 'Contact');

        });

        it('says the assignment\'s result could be committed, as a warning with View output, when the tree\'s RunArtifacts/.gitignore no longer ignores everything (#470)', async () => {

            orgPermissionSetNames = ['account_tree_access'];
            const runArtifactsFolderPath = path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', 'recipe-2026-09-20T10-00-00', 'Account-thru-OtherChildObject__c', 'RunArtifacts');
            fs.mkdirSync(runArtifactsFolderPath, { recursive: true });
            fs.writeFileSync(path.join(runArtifactsFolderPath, '.gitignore'), '');
            await openCockpitWithQaSelected();

            await assignPermissionSets();

            expect(notificationInformationSpy).not.toHaveBeenCalledWith(expect.stringMatching(/^Assigned /));
            expect(notificationWarnings()).toContainEqual({
                text: expect.stringMatching(/^Assigned 1 permission set for Account-thru-OtherChildObject__c to .* could be committed: check them before you commit\.$/),
                actions: [RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL]
            });

        });

        it('sends no insert, and does not ask which user it is, when the org holds none of the picks, and only warns', async () => {

            orgPermissionSetNames = [];
            await openCockpitWithQaSelected();
            const clearSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');

            await assignPermissionSets();

            expect(insertCalls).toEqual([]);
            expect(soqlQueries.filter(soql => soql.includes('FROM User'))).toEqual([]);
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

            expect(modalCalls()[0][0]).toBe(`Assign 1 permission set for Account-thru-OtherChildObject__c to ${QA_USERNAME} in qa · ${QA_USERNAME}?`);
            expect(soqlQueries.filter(soql => soql.includes('FROM PermissionSet'))).toEqual(['SELECT Id, Name, NamespacePrefix FROM PermissionSet WHERE Name IN (\'Contact_Reader\')']);
            expect(assignCalls()).toEqual([['Contact_Reader']]);

        });

        // THE IN-PANEL DIALOG WRITES ITS TEXT WITH textContent (#349), SO ONLY WHAT REACHES A NOTIFICATION IS ESCAPED
        it('shows repository text as written in the confirmation, and escapes it in the progress title and the notifications', async () => {

            orgPermissionSetNames = ['Account_Tree_Access'];
            await openCockpitWithQaSelected();
            panelState().recipeDataMessage.recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY).customName = 'Run [me](command:evil)';

            await assignPermissionSets();

            const [modalMessage, modalOptions] = modalCalls()[0];
            expect(modalMessage).toContain('for Run [me](command:evil) to');
            expect(modalOptions.detail).toContain('Tree: Run [me](command:evil)');
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

            expect(lastWarning()).toEqual({ text: 'No permission set in this workspace\'s source grants access to any object of Account-thru-OtherChildObject__c, so nothing was assigned.', actions: [] });
            expect(quickPick()).not.toHaveBeenCalled();
            expect(promptSpy).not.toHaveBeenCalled();
            expect(insertCalls).toEqual([]);
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

        it('refuses more picks than one assignment request can carry', async () => {

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

        it('assigns with no Salesforce CLI on PATH, and from a Windows UNC project folder, since no process runs (#500 replaces #285\'s refusal here)', async () => {

            await openCockpitWithQaSelected();
            process.env.PATH = path.join(temporaryRoot, 'nowhere');
            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(true);
            jest.spyOn(PicklistDependencyCheckService, 'isUncPath').mockReturnValue(true);

            await assignPermissionSets();

            expect(assignCalls()).toEqual([['Account_Tree_Access', 'Contact_Reader']]);
            expect(notificationInformationSpy).toHaveBeenCalledWith(expect.stringMatching(/^Assigned 2 permission sets /));
            expect(cliCalls).toEqual([]);

        });

        it('counts a permission set the user already holds as a success', async () => {

            insertHandler = () => [saved(), refused('DUPLICATE_VALUE', 'duplicate value found: <unknown> duplicates value on record with id: <unknown>')];
            await openCockpitWithQaSelected();

            await assignPermissionSets();

            expect(notificationWarnings()).toEqual([]);
            expect(notificationInformationSpy).toHaveBeenCalledWith(expect.stringContaining('Contact_Reader was already assigned.'));

        });

        it('names which permission sets failed in a warning whose "View output" button opens the result file', async () => {

            insertHandler = () => [saved(), refused('FIELD_INTEGRITY_EXCEPTION', 'The user license doesn\'t allow the permission set Contact_Reader.')];
            await openCockpitWithQaSelected();
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_message: string, options: any, ...actions: string[]) => (
                options?.inPanel ? RECIPE_COCKPIT_PERMISSION_SET_CONFIRM_LABEL : [options, ...actions].includes(RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL) ? RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL : undefined
            ));

            await assignPermissionSets();
            await flushAsyncWork();

            const failure = lastWarning();
            expect(failure.text).toBe(`Contact_Reader could not be assigned to ${QA_USERNAME} in qa · ${QA_USERNAME}: The user license doesn't allow the permission set Contact_Reader. Assigned: Account_Tree_Access.`);
            expect(failure.actions).toEqual([RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL]);
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(VSCodeWorkspaceService.openFileInEditor).toHaveBeenCalledWith(expect.stringMatching(/-permission-set-assign\.json$/));
            const operationsFolderPath = path.join(path.resolve(workspaceRoot), 'treecipe', 'GeneratedRecipes', 'recipe-2026-09-20T10-00-00', 'Account-thru-OtherChildObject__c', 'RunArtifacts', ORG_OPERATIONS_FOLDER_NAME, QA_USERNAME);
            const summaryFileName = fs.readdirSync(operationsFolderPath).find(fileName => fileName.endsWith('-summary.json')) as string;
            expect(JSON.parse(fs.readFileSync(path.join(operationsFolderPath, summaryFileName), 'utf-8'))).toEqual(expect.objectContaining({
                outcome: 'partial',
                succeededCount: 1,
                failedCount: 1,
                detail: 'Contact_Reader could not be assigned: The user license doesn\'t allow the permission set Contact_Reader.'
            }));
            // THE CARD DRAWS NO LINE OF ITS OWN, SO NOTHING ABOUT THE OUTCOME IS POSTED
            expect(lastAssignState()).toEqual({ command: 'permissionSetAssignState', isRunning: false, treeKey: ACCOUNT_TREE_KEY });

        });

        it('offers no Cancel while the one insert runs, refuses a second assignment meanwhile, and reports once the org answers', async () => {

            insertHandler = records => new Promise(resolve => heldCallbacks.push(() => resolve(records.map(() => saved()))));
            await openCockpitWithQaSelected();

            const runInFlight = assignPermissionSets();
            await flushAsyncWork();
            await flushAsyncWork();

            expect(lastAssignState()).toEqual({ command: 'permissionSetAssignState', isRunning: true, treeKey: ACCOUNT_TREE_KEY });
            expect((vscode.window.withProgress as jest.Mock).mock.calls.at(-1)[0]).toMatchObject({ cancellable: false });

            await receivedMessageHandler({ command: 'assignTreePermissionSets', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY });
            expect(insertCalls).toHaveLength(1);

            heldCallbacks.forEach(answer => answer());
            await runInFlight;
            await flushAsyncWork();

            expect(notificationInformationSpy).toHaveBeenCalledWith(expect.stringMatching(/^Assigned 2 permission sets /));
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
                .mockRejectedValueOnce(new Error('The authorized Salesforce orgs could not be read, so no org is listed.'))
                .mockResolvedValueOnce(undefined);

            await assignPermissionSets(ACCOUNT_TREE_KEY, null);
            expect(lastWarning().text).toContain('Nothing was assigned: The authorized Salesforce orgs could not be read');

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

        it('warns that which were assigned is unknown, and drops the describes, when the insert times out', async () => {

            await openCockpitWithQaSelected();
            insertHandler = () => new Promise(() => undefined);
            const realSetTimeout = global.setTimeout;
            jest.spyOn(global, 'setTimeout').mockImplementation(((callback: () => void, delay?: number) => delay === PERMISSION_SET_ASSIGN_TIMEOUT_MILLISECONDS
                ? realSetTimeout(callback, 0)
                : realSetTimeout(callback, delay)) as typeof setTimeout);
            const clearSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');

            await assignPermissionSets();
            await flushAsyncWork();

            expect(insertCalls).toHaveLength(1);
            expect(lastWarning()).toEqual({ text: 'The assignment did not finish in time, so which permission sets were assigned is unknown.', actions: [RECIPE_COCKPIT_PERMISSION_SET_VIEW_OUTPUT_LABEL] });
            expect(clearSpy).toHaveBeenCalledWith(QA_USERNAME, 'Account');
            const operationsFolderPath = path.join(path.resolve(workspaceRoot), 'treecipe', 'GeneratedRecipes', 'recipe-2026-09-20T10-00-00', 'Account-thru-OtherChildObject__c', 'RunArtifacts', ORG_OPERATIONS_FOLDER_NAME, QA_USERNAME);
            const summaryFileName = fs.readdirSync(operationsFolderPath).find(fileName => fileName.endsWith('-summary.json')) as string;
            expect(JSON.parse(fs.readFileSync(path.join(operationsFolderPath, summaryFileName), 'utf-8'))).toMatchObject({ outcome: 'unknown' });

        });

        it('warns that which were assigned is unknown when the insert throws, without quoting the error', async () => {

            await openCockpitWithQaSelected();
            insertHandler = () => { throw new Error('INVALID_SESSION_ID sid=00Dxx!secret'); };

            await assignPermissionSets();

            expect(lastWarning().text).toBe('The org did not answer the assignment, so which permission sets were assigned is unknown.');
            expect(JSON.stringify(warningCalls())).not.toContain('secret');
            expect(lastAssignState()).toMatchObject({ isRunning: false });

        });

        it('assigns nothing, and gives a fixed warning, when the org cannot say which user it is authorized as', async () => {

            await openCockpitWithQaSelected();

            for ( const answer of [new Error('INVALID_SESSION_ID'), { records: [] }] ) {
                userAnswer = answer;
                await assignPermissionSets();
                expect(lastWarning()).toEqual({ text: `Nothing was assigned: qa · ${QA_USERNAME} could not be asked which user it is authorized as. Try again.`, actions: [] });
            }

            expect(insertCalls).toEqual([]);

        });

        it('gives the panel its button back and rethrows when the run itself throws', async () => {

            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
            await openCockpitWithQaSelected();
            jest.spyOn(RecipeCockpitPermissionSetAssign, 'planAssignments').mockImplementation(() => { throw new Error('boom'); });

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
            expect(modalCalls()[0][0]).toBe(`Assign 2 permission sets for Account-thru-OtherChildObject__c to ${QA_USERNAME} in ${QA_USERNAME}?`);
            expect(lastWarning().text).toContain(`${QA_USERNAME} could not say whether it is a sandbox`);
            expect(assignCalls()).toEqual([]);

        });

        it('says every pick was already assigned in the plural, and names none assigned when every pick failed', async () => {

            await openCockpitWithQaSelected();

            insertHandler = records => records.map(() => refused('', 'Duplicate PermissionSetAssignment'));
            await assignPermissionSets();
            expect(notificationInformationSpy).toHaveBeenLastCalledWith(expect.stringContaining('Account_Tree_Access, Contact_Reader were already assigned.'));

            insertHandler = records => records.map(() => refused('INSUFFICIENT_ACCESS', 'insufficient access'));
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

            insertHandler = records => new Promise(resolve => heldCallbacks.push(() => resolve(records.map(() => saved()))));
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

            insertHandler = records => records.map(() => refused('INSUFFICIENT_ACCESS', 'insufficient access'));
            await openCockpitWithQaSelected();
            let chooseViewOutput: (choice: string) => void = () => undefined;
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation((_message: string, options: any) => (
                options?.inPanel ? Promise.resolve(RECIPE_COCKPIT_PERMISSION_SET_CONFIRM_LABEL) : new Promise(resolve => { chooseViewOutput = resolve; })
            ));

            await assignPermissionSets();
            fs.rmSync(path.join(workspaceRoot, 'treecipe', 'GeneratedRecipes', 'recipe-2026-09-20T10-00-00', 'Account-thru-OtherChildObject__c', 'RunArtifacts', ORG_OPERATIONS_FOLDER_NAME), { recursive: true, force: true });
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
            panel.openTroubleshootingTabs();
            return panel;
        };

        const permissionSetButtonOf = (panel: ReturnType<typeof runPanelScript>, objectApiName = 'OtherChildObject__c') => panel.findAll(cardOf(panel, objectApiName), 'treePermissionSets')[0];

        it('draws the assign button, and no deploy button, status line or output link, on every card with a folder, and posts the tree key alone', () => {

            const panel = renderTrees();
            const permissionSetButton = permissionSetButtonOf(panel);
            const accountCard = cardOf(panel, 'OtherChildObject__c');

            expect(panel.findAll(permissionSetButton, 'actionCardTitle')[0].textContent).toBe('Assign permission sets to me…');
            expect(RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL).toBe('Assign permission sets to me…');
            expect(panel.isHidden(permissionSetButton)).toBe(false);
            expect(panel.isHidden(permissionSetButtonOf(panel, 'Lead'))).toBe(false);
            ['treeDeploy', 'metadataDeployStatus', 'metadataDeployViewOutput', 'metadataDeployOpenStatus'].forEach(className => {
                expect(panel.findAll(accountCard, className)).toEqual([]);
            });
            // IN THE TROUBLESHOOTING TAB'S PERMISSIONS SUB-TAB (#346, #365): THE ASSIGN BUTTON, "Generate permission set…" (#306) AND "Deploy permission set…", ONE ACTION EACH
            const controlChildren = panel.findAll(panel.findAll(accountCard, 'troubleshootingSubPanel-permissions')[0], 'troubleshootingAction').map((actionElement: any) => actionElement.children[0]);
            expect(controlChildren).toHaveLength(3);
            expect(controlChildren[0] === permissionSetButton).toBe(true);
            expect(controlChildren[1].className).toBe('sdtButton sdtButton-card actionCard treeGeneratePermissionSet');
            expect(controlChildren[2].className).toBe('sdtButton sdtButton-card actionCard troubleshootingDeploy troubleshootingDeploy-permissionSet');
            // "Retrieve validation rules…" (#326) HAS A SUB-TAB OF ITS OWN
            expect(panel.findAll(panel.findAll(accountCard, 'troubleshootingSubPanel-validationRules')[0], 'troubleshootingAction').map((actionElement: any) => actionElement.children[0].className)).toEqual(['sdtButton sdtButton-card actionCard treeRetrieveValidationRules']);

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

            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('"Assign permission sets to me…", on every tree\'s Troubleshooting tab, assigns the permission sets you pick');
            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('It deploys nothing');
            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).not.toContain('Deploy this metadata');

        });

    });

});
