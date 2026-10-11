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
    Org: { create: jest.fn() }
}));

jest.mock('child_process', () => ({ execFile: jest.fn(), exec: jest.fn() }));

import { AuthInfo } from '@salesforce/core';
import { execFile } from 'child_process';

import {
    IRecipeCockpitPanelState,
    RecipeCockpitService,
    RECIPE_COCKPIT_METADATA_DEPLOY_ACTION_LABEL,
    RECIPE_COCKPIT_METADATA_DEPLOY_CONFIRM_LABEL,
    RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL,
    RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL
} from '../RecipeCockpitService';
import { IMetadataDeployTarget, RecipeCockpitMetadataDeploy } from '../RecipeCockpitMetadataDeploy';
import { RecipeCockpitRecordCreation } from '../RecipeCockpitRecordCreation';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { ORG_OPERATIONS_FOLDER_NAME, ScratchOrgService } from '../../ScratchOrgService/ScratchOrgService';
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
const LEAD_TREE_KEY = 'Lead-ONLY';
const QA_USERNAME = 'qa@example.com.qa';

const buildDeployAnswer = (successNames: string[], failures: Array<{ fullName: string; problem: string }>) => JSON.stringify({
    status: failures.length === 0 ? 0 : 1,
    ...( failures.length > 0 ? { name: 'FailedDeployError', message: 'Deploy failed.' } : {} ),
    result: {
        success: failures.length === 0,
        ...( failures.length === 0 ? { numberComponentsDeployed: successNames.length } : {} ),
        details: {
            componentSuccesses: [
                ...successNames.map(fullName => ({ fullName: fullName, componentType: 'CustomField', success: true })),
                { fullName: 'package.xml', componentType: '', success: true }
            ],
            componentFailures: failures.map(failure => ({ ...failure, componentType: 'CustomField', success: false }))
        }
    }
});

// THE ORG AS A DESCRIBE ANSWERS IT: ACCOUNT LACKS TWO OF ITS RECIPE'S CUSTOM FIELDS, OtherChildObject__c IS NOT THERE AT ALL
const buildOrgDescribes = (): Record<string, any> => ({
    Account: { name: 'Account', createable: true, fields: [
        { name: 'Name', type: 'string', nillable: false, createable: true },
        { name: 'Annual_Budget__c', type: 'currency', nillable: true, createable: true },
        { name: 'Sub_Rating__c', type: 'picklist', nillable: true, createable: true },
        { name: 'Regions__c', type: 'multipicklist', nillable: true, createable: true },
        { name: 'ParentId', type: 'reference', referenceTo: ['Account'], nillable: true, createable: true },
        { name: 'OwnerId', type: 'reference', referenceTo: ['User'], nillable: false, createable: true, defaultedOnCreate: true }
    ] },
    Contact: { name: 'Contact', createable: true, fields: [
        { name: 'LastName', type: 'string', nillable: false, createable: true },
        { name: 'AccountId', type: 'reference', referenceTo: ['Account'], nillable: true, createable: true }
    ] },
    Lead: { name: 'Lead', createable: true, fields: [
        { name: 'Company', type: 'string', nillable: false, createable: true }
    ] }
});

describe('RecipeCockpitService, "Deploy missing metadata…" in the Treecipe tab (#211)', () => {

    describe('RecipeCockpitRecordCreation marks only what a deploy can fix', () => {

        const sandbox = { isSandbox: true, organizationType: 'Developer Edition' };
        const describe = { objectApiName: 'Account', isCreateable: true, fields: [{ fieldApiName: 'Name', fieldType: 'string', referenceTo: [] as string[], isNillable: false, isCreateable: true, isDefaultedOnCreate: false }] };

        it('marks an object the org answered NOT_FOUND for, and a block with fields the describe lacks', () => {

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({ objectApiName: 'Gone__c', orgTypeDetail: sandbox, describeFailureMessage: 'NOT_FOUND: x', isObjectNotFound: true }).isMetadataDeployable).toBe(true);
            expect(RecipeCockpitRecordCreation.buildCreateReadiness({ objectApiName: 'Account', orgTypeDetail: sandbox, describe, recipeFieldApiNames: ['Name', 'Region__c'] })).toMatchObject({
                isMetadataDeployable: true,
                missingFieldApiNames: ['Region__c']
            });

        });

        it('says an object is not in the org with no detail when the describe gave none', () => {

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({ objectApiName: 'Gone__c', orgTypeDetail: sandbox, isObjectNotFound: true }))
                .toEqual({ objectApiName: 'Gone__c', disabledReason: 'Gone__c is not in this org.', requiredLookups: [], isMetadataDeployable: true });

        });

        it('never marks a failed describe, a not-createable field, a production org or an org whose type is unknown', () => {

            const readOnlyDescribe = { ...describe, fields: [...describe.fields, { fieldApiName: 'Legacy__c', fieldType: 'string', referenceTo: [] as string[], isNillable: true, isCreateable: false, isDefaultedOnCreate: false }] };

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({ objectApiName: 'Gone__c', orgTypeDetail: sandbox, describeFailureMessage: 'INVALID_SESSION_ID: x' })).not.toHaveProperty('isMetadataDeployable');
            expect(RecipeCockpitRecordCreation.buildCreateReadiness({ objectApiName: 'Account', orgTypeDetail: sandbox, describe: readOnlyDescribe, recipeFieldApiNames: ['Legacy__c'] })).not.toHaveProperty('isMetadataDeployable');
            expect(RecipeCockpitRecordCreation.buildCreateReadiness({ objectApiName: 'Gone__c', orgTypeDetail: { isSandbox: false, organizationType: 'Enterprise Edition' }, isObjectNotFound: true })).not.toHaveProperty('isMetadataDeployable');
            expect(RecipeCockpitRecordCreation.buildCreateReadiness({ objectApiName: 'Gone__c', orgTypeDetail: undefined, isObjectNotFound: true })).not.toHaveProperty('isMetadataDeployable');
            expect(RecipeCockpitRecordCreation.buildCreateReadiness({ objectApiName: 'Account', orgTypeDetail: sandbox, describe, recipeFieldApiNames: ['Name'] })).not.toHaveProperty('isMetadataDeployable');

        });

        it('builds a deploy target from that readiness alone: the object and its block\'s fields, or the missing fields', () => {

            expect(RecipeCockpitService.buildDeployTarget(
                { treeKey: 't', objectApiName: 'Gone__c', recipeFieldApiNames: ['A__c', 'Name'] },
                { objectApiName: 'Gone__c', disabledReason: 'x', requiredLookups: [], isMetadataDeployable: true }
            )).toEqual({ treeKey: 't', objectApiName: 'Gone__c', isObjectMissing: true, fieldApiNames: ['A__c', 'Name'] });

            expect(RecipeCockpitService.buildDeployTarget(
                { treeKey: 't', objectApiName: 'Account', recipeFieldApiNames: ['Name', 'B__c'] },
                { objectApiName: 'Account', disabledReason: 'x', requiredLookups: [], missingFieldApiNames: ['B__c'], notCreateableFieldApiNames: [], isMetadataDeployable: true }
            )).toEqual({ treeKey: 't', objectApiName: 'Account', isObjectMissing: false, fieldApiNames: ['B__c'] });

            // A RECIPE THAT COULD NOT BE CUT STILL NAMES ITS OBJECT: ONLY THE OBJECT ITSELF IS OFFERED
            expect(RecipeCockpitService.buildDeployTarget(
                { treeKey: 't', objectApiName: 'Gone__c', recipeFieldRefusalReason: 'unreadable' },
                { objectApiName: 'Gone__c', disabledReason: 'x', requiredLookups: [], isMetadataDeployable: true }
            )).toEqual({ treeKey: 't', objectApiName: 'Gone__c', isObjectMissing: true, fieldApiNames: [] });

            expect(RecipeCockpitService.buildDeployTarget(
                { treeKey: 't', objectApiName: 'Account', recipeFieldApiNames: ['Name'] },
                { objectApiName: 'Account', disabledReason: 'x', requiredLookups: [], notCreateableFieldApiNames: ['Name'], missingFieldApiNames: [] }
            )).toBeUndefined();

        });

    });

    describe('RecipeCockpitMetadataDeploy', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;

        beforeEach(() => {
            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-metadata-deploy-'));
            workspaceRoot = path.join(temporaryRoot, 'workspace');
            fs.cpSync(METADATA_DEPLOY_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
        });

        afterEach(() => {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        });

        const plan = (deployTarget: Partial<IMetadataDeployTarget>) => RecipeCockpitMetadataDeploy.planMetadataDeploy(
            { treeKey: 't', objectApiName: 'Account', isObjectMissing: false, fieldApiNames: [], ...deployTarget },
            workspaceRoot,
            ['force-app', 'unpackaged']
        );

        it('deploys a missing object as CustomObject plus its recipe\'s custom fields, and skips a field not in local source and a standard field', () => {

            expect(plan({ objectApiName: 'OtherChildObject__c', isObjectMissing: true, fieldApiNames: ['Score__c', 'Ratio__c', 'Contact__c', 'Name'] })).toEqual({
                objectApiName: 'OtherChildObject__c',
                members: ['CustomObject:OtherChildObject__c', 'CustomField:OtherChildObject__c.Score__c', 'CustomField:OtherChildObject__c.Contact__c'],
                skippedItems: [
                    { name: 'OtherChildObject__c.Ratio__c', reason: 'notInLocalSource' },
                    { name: 'OtherChildObject__c.Name', reason: 'standardField' }
                ],
                objectFolderContents: ['fields/Contact__c.field-meta.xml', 'fields/Score__c.field-meta.xml']
            });

        });

        it('deploys missing fields as CustomField members, spelt as the source file on disk spells them', () => {

            expect(plan({ fieldApiNames: ['legacy_code__c', 'Rating__c', 'Status'] })).toEqual({
                objectApiName: 'Account',
                members: ['CustomField:Account.Legacy_Code__c', 'CustomField:Account.Rating__c'],
                skippedItems: [{ name: 'Account.Status', reason: 'standardField' }]
            });

        });

        it('never deploys a missing standard object, nor its fields', () => {

            expect(plan({ objectApiName: 'Lead', isObjectMissing: true, fieldApiNames: ['Region__c'] })).toEqual({
                objectApiName: 'Lead',
                members: [],
                skippedItems: [{ name: 'Lead', reason: 'standardObject' }, { name: 'Lead.Region__c', reason: 'objectNotDeployable' }]
            });

        });

        it('keeps a name that is not an api name, and a source file that resolves outside the workspace, out of the members', () => {

            const outsideFolderPath = path.join(temporaryRoot, 'outside');
            fs.mkdirSync(outsideFolderPath);
            fs.writeFileSync(path.join(outsideFolderPath, 'Escaped__c.field-meta.xml'), '<CustomField/>');
            fs.symlinkSync(path.join(outsideFolderPath, 'Escaped__c.field-meta.xml'), path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields', 'Escaped__c.field-meta.xml'));

            const result = plan({ fieldApiNames: ['Escaped__c', 'x --target-org prod', 'Rating__c'] });

            expect(result.members).toEqual(['CustomField:Account.Rating__c']);
            expect(result.skippedItems).toEqual([
                { name: 'Account.Escaped__c', reason: 'outsideWorkspace' },
                { name: 'Account.x --target-org prod', reason: 'notAnApiName' }
            ]);

        });

        it('skips a missing object with no source, and every field of it, and an object name that is not an api name', () => {

            expect(plan({ objectApiName: 'Gone__c', isObjectMissing: true, fieldApiNames: ['A__c'] }).skippedItems).toEqual([
                { name: 'Gone__c', reason: 'notInLocalSource' },
                { name: 'Gone__c.A__c', reason: 'objectNotDeployable' }
            ]);
            expect(plan({ objectApiName: '../Account', fieldApiNames: ['Rating__c'] })).toEqual({ objectApiName: '../Account', members: [], skippedItems: [{ name: '../Account', reason: 'notAnApiName' }] });

        });

        it('looks in every package directory, and treats one it cannot read as holding nothing', () => {

            const unpackagedFieldsPath = path.join(workspaceRoot, 'unpackaged', 'objects', 'Account', 'fields');
            fs.mkdirSync(unpackagedFieldsPath, { recursive: true });
            fs.writeFileSync(path.join(unpackagedFieldsPath, 'Extra__c.field-meta.xml'), '<CustomField/>');

            expect(plan({ fieldApiNames: ['Extra__c'] }).members).toEqual(['CustomField:Account.Extra__c']);
            expect(RecipeCockpitMetadataDeploy.planMetadataDeploy({ treeKey: 't', objectApiName: 'Account', isObjectMissing: false, fieldApiNames: ['Rating__c'] }, workspaceRoot, ['missing']).skippedItems)
                .toEqual([{ name: 'Account.Rating__c', reason: 'notInLocalSource' }]);

        });

        // "\u212A" (KELVIN SIGN) LOWERCASES TO "k": A CASE-INSENSITIVE MATCH FINDS IT, AND ONLY THE SECOND CHECK OF THE NAME ON DISK KEEPS IT OUT OF THE ARGV
        it('keeps out a source file whose name only matches through Unicode case folding', () => {

            fs.writeFileSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields', 'Ran\u212Aing__c.field-meta.xml'), '<CustomField/>');

            expect(plan({ fieldApiNames: ['Ranking__c'] })).toEqual({ objectApiName: 'Account', members: [], skippedItems: [{ name: 'Account.Ranking__c', reason: 'notAnApiName' }] });

        });

        // A SOURCE-FORMAT CustomObject DEPLOYS ITS WHOLE FOLDER, SO THE CONFIRMATION SAYS SO AND LISTS IT
        it('lists everything in a missing object\'s source folder in the confirmation, not only the fields it names', () => {

            const objectFolderPath = path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'OtherChildObject__c');
            fs.mkdirSync(path.join(objectFolderPath, 'validationRules'));
            fs.writeFileSync(path.join(objectFolderPath, 'validationRules', 'Score_Positive.validationRule-meta.xml'), '<ValidationRule/>');

            const objectPlan = plan({ objectApiName: 'OtherChildObject__c', isObjectMissing: true, fieldApiNames: ['Score__c'] });
            const detail = RecipeCockpitMetadataDeploy.buildConfirmationDetail(objectPlan, 'qa · qa@example.com.qa');

            expect(objectPlan.objectFolderContents).toEqual(['fields/Contact__c.field-meta.xml', 'fields/Score__c.field-meta.xml', 'validationRules/Score_Positive.validationRule-meta.xml']);
            expect(detail).toContain('CustomObject:OtherChildObject__c deploys the object with everything in its source folder (3 files), not only the fields above:\n  fields/Contact__c.field-meta.xml\n  fields/Score__c.field-meta.xml\n  validationRules/Score_Positive.validationRule-meta.xml');
            expect(detail).toContain('Only these members, and the object\'s folder, are deployed');
            expect(detail).toContain('The deploy is all or nothing');
            expect(RecipeCockpitMetadataDeploy.buildConfirmationDetail(plan({ fieldApiNames: ['Rating__c'] }), 'qa')).not.toContain('source folder');

            const manyContents = Array.from({ length: 45 }, (unused, contentIndex) => `fields/F${contentIndex}__c.field-meta.xml`);
            expect(RecipeCockpitMetadataDeploy.buildConfirmationDetail({ ...objectPlan, objectFolderContents: manyContents }, 'qa')).toContain('  and 5 more');

        });

        it('builds the argv: project deploy start, one --metadata per member, the username as --target-org, --json, and no --source-dir', () => {

            const deployArguments = RecipeCockpitMetadataDeploy.buildMetadataDeployArguments(['CustomObject:Gone__c', 'CustomField:Gone__c.A__c'], QA_USERNAME);

            expect(deployArguments).toEqual([
                'project', 'deploy', 'start',
                '--metadata', 'CustomObject:Gone__c',
                '--metadata', 'CustomField:Gone__c.A__c',
                '--target-org', QA_USERNAME,
                '--json'
            ]);
            expect(deployArguments).not.toContain('--source-dir');

        });

        it.each([
            'CustomField:Account.Name',
            'CustomObject:Account',
            'CustomField:Account.A__c --source-dir .',
            'ApexClass:Evil',
            'CustomField:Account..A__c'
        ])('refuses %s as a member before any process', (member) => {

            expect(() => RecipeCockpitMetadataDeploy.buildMetadataDeployArguments([member], QA_USERNAME)).toThrow();

        });

        it('reads the CLI\'s --json: success, some failed, all failed, malformed, and a CLI that is not installed', () => {

            const invocation = (stdout: string) => ({ stdout: stdout, stderr: '', exitCode: 0 });

            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation(buildDeployAnswer(['Account.A__c', 'Account.B__c'], [])), 2))
                .toEqual({ kind: 'deployed', deployedComponentCount: 2 });
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation(buildDeployAnswer(['Account.A__c'], [{ fullName: 'Account.B__c', problem: 'Value set Regions not found' }])), 2))
                .toEqual({ kind: 'partiallyFailed', failedComponentCount: 1, componentCount: 2, failureDetail: 'Account.B__c: Value set Regions not found' });
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation(buildDeployAnswer([], [{ fullName: 'Account.A__c', problem: 'p' }, { fullName: 'Account.B__c', problem: 'q' }])), 2))
                .toEqual({ kind: 'failed', failureMessage: 'Account.A__c: p; Account.B__c: q' });
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation('Deployed! (not json)'), 2).kind).toBe('failed');
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation(JSON.stringify({ status: 0, result: { success: 'yes' } })), 2).kind).toBe('failed');
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput({ stdout: '', stderr: '', exitCode: null, spawnError: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) }, 2))
                .toEqual({ kind: 'cliNotInstalled', failureMessage: RecipeCockpitMetadataDeploy.buildCliRequiredMessage() });

        });

        it('reads a malformed deploy answer as a failure with nothing counted, whatever shape its parts take', () => {

            const emptyCounts = { isSucceeded: false, componentSuccessCount: 0, componentFailureCount: 0, componentFailureProblems: [] as string[] };

            expect(ScratchOrgService.readDeployComponentCounts(undefined)).toEqual(emptyCounts);
            expect(ScratchOrgService.readDeployComponentCounts({ status: 0, result: [] })).toEqual(emptyCounts);
            expect(ScratchOrgService.readDeployComponentCounts({ status: 0, result: { success: true, details: { componentFailures: { fullName: 7, problem: 'Bad value' }, componentSuccesses: null } } }))
                .toEqual({ ...emptyCounts, componentFailureCount: 1, componentFailureProblems: ['Bad value'] });
            expect(ScratchOrgService.readDeployComponentCounts({ status: 1, result: { details: { componentFailures: [null, { fullName: '' }] } } }))
                .toEqual({ ...emptyCounts, componentFailureCount: 2 });

        });

        it('reports a CLI that could not start, an answer too large to read and a timeout as never a success', () => {

            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput({ stdout: '', stderr: '', exitCode: null, spawnError: Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }) }, 1))
                .toEqual({ kind: 'failed', failureMessage: 'The Salesforce CLI could not be started: spawn EACCES' });
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput({ stdout: '', stderr: '', exitCode: null, isOutputTooLarge: true }, 1).kind).toBe('unconfirmed');
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput({ stdout: '', stderr: '', exitCode: null, timedOut: true }, 1)).toEqual({ kind: 'unconfirmed', failureMessage: expect.stringContaining('may have partly applied') });
            expect(RecipeCockpitMetadataDeploy.isDeployableMember(42)).toBe(false);

        });

        it('shares the deploy-result reader with the scratch org deploy, which does not count package.xml as a component', () => {

            expect(ScratchOrgService.readDeployComponentCounts(JSON.parse(buildDeployAnswer(['Account.A__c'], [{ fullName: 'Account.B__c', problem: 'p' }])))).toEqual({
                isSucceeded: false,
                componentSuccessCount: 1,
                componentFailureCount: 1,
                componentFailureProblems: ['Account.B__c: p']
            });

        });

    });

    describe('routePanelMessage', () => {

        const deployTarget: IMetadataDeployTarget = { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', isObjectMissing: false, fieldApiNames: ['Rating__c'] };

        const buildDeployablePanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: '' }, renderSequence: 3 };
            panelState.acknowledgedRenderSequence = 3;
            panelState.dataOrgDetails = [{ targetOrgIdentifier: 'qa', username: QA_USERNAME, alias: 'qa' }];
            panelState.dataOrgSelection = { orgIndex: 0, orgDetail: panelState.dataOrgDetails[0], requestSequence: 7, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' } };
            panelState.pendingDeployTargets = new Map([[RecipeCockpitService.buildTreeObjectKey(ACCOUNT_TREE_KEY, 'Account'), deployTarget]]);
            panelState.pendingDeployTargetSnapshots = new Map([[1, new Map(panelState.pendingDeployTargets)]]);
            panelState.pendingDeployTargetsRequestSequence = 7;
            return panelState;
        };

        const activate = (panelState: IRecipeCockpitPanelState) => {
            panelState.deployTargets = new Map(panelState.pendingDeployTargets);
            panelState.deployTargetsRequestSequence = panelState.pendingDeployTargetsRequestSequence;
        };

        const deployMessage = { command: 'deployMissingMetadata', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account' };

        it('activates the deployable objects only when the panel drew the readiness of the selection checked now, over an acknowledged model', () => {

            const panelState = buildDeployablePanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'readinessRendered', renderSequence: 3, requestSequence: 7, readinessSequence: 1 }, panelState)).toEqual({ kind: 'activateDeployActions', readinessSequence: 1 });
            expect(RecipeCockpitService.routePanelMessage({ command: 'readinessRendered', renderSequence: 3, requestSequence: 6, readinessSequence: 1 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'readinessRendered', renderSequence: 2, requestSequence: 7, readinessSequence: 1 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'readinessRendered', renderSequence: 3, requestSequence: 7, readinessSequence: 2 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'readinessRendered', renderSequence: 3, requestSequence: 7 }, panelState)).toBeUndefined();

            panelState.acknowledgedRenderSequence = null;
            expect(RecipeCockpitService.routePanelMessage({ command: 'readinessRendered', renderSequence: 3, requestSequence: 7, readinessSequence: 1 }, panelState)).toBeUndefined();

        });

        it('refuses a deploy before the readiness it came from was drawn, and routes the HOST\'s target once it was -- never anything from the message', () => {

            const panelState = buildDeployablePanelState();

            expect(RecipeCockpitService.routePanelMessage(deployMessage, panelState)?.kind).toBe('postMetadataDeployState');

            activate(panelState);

            expect(RecipeCockpitService.routePanelMessage({ ...deployMessage, members: ['ApexClass:Evil'], username: 'prod@example.com' } as any, panelState))
                .toEqual({ kind: 'deployMissingMetadata', deployTarget: deployTarget });

        });

        it.each([
            ['a tree and object not in the allow-list', { treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Contact' }],
            ['another tree', { treeKey: LEAD_TREE_KEY }],
            ['an orgIndex that is not the selection', { orgIndex: 1 }],
            ['an orgIndex that is not a number', { orgIndex: '0' }],
            ['a tree key that is not a string', { treeKey: ['x'] }]
        ])('refuses %s, so no process is started', (unusedDescription, override) => {

            const panelState = buildDeployablePanelState();
            activate(panelState);

            expect(RecipeCockpitService.routePanelMessage({ ...deployMessage, ...override } as any, panelState)?.kind).toBe('postMetadataDeployState');

        });

        it('refuses an org whose Organization answer was not a sandbox, or never came, whatever the allow-list says', () => {

            const panelState = buildDeployablePanelState();
            activate(panelState);

            panelState.dataOrgSelection.orgTypeDetail = { isSandbox: false, organizationType: 'Enterprise Edition' };
            expect(RecipeCockpitService.routePanelMessage(deployMessage, panelState)?.kind).toBe('postMetadataDeployState');

            panelState.dataOrgSelection.orgTypeDetail = undefined;
            expect(RecipeCockpitService.routePanelMessage(deployMessage, panelState)?.kind).toBe('postMetadataDeployState');

        });

        it('refuses a deploy for an allow-list built under an earlier selection', () => {

            const panelState = buildDeployablePanelState();
            activate(panelState);
            panelState.dataOrgSelection.requestSequence = 8;

            expect(RecipeCockpitService.routePanelMessage(deployMessage, panelState)?.kind).toBe('postMetadataDeployState');

        });

        it('refuses a second deploy while one runs, and an insert, an org selection, ⟳, a listing or a scratch org meanwhile', () => {

            const panelState = buildDeployablePanelState();
            activate(panelState);
            panelState.metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', statusText: 'Deploying 1 component of Account…', isFailure: false, hasOutput: false };
            panelState.dataOrgObjectApiNames = new Set(['Account']);
            panelState.insertableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.set(ACCOUNT_TREE_KEY, '/workspace/account.yml');

            expect(RecipeCockpitService.routePanelMessage(deployMessage, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'insertTree', treeKey: ACCOUNT_TREE_KEY }, panelState)?.kind).toBe('postInsertState');
            expect(RecipeCockpitService.routePanelMessage({ command: 'selectDataOrg', orgIndex: 0 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgs' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadDataOrgs' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'createScratchOrg' }, panelState)?.kind).toBe('postScratchOrgState');
            expect(RecipeCockpitService.routePanelMessage({ command: 'viewMetadataDeployOutput' }, panelState)).toBeUndefined();

        });

        it('refuses a deploy while a scratch org run or a tree insert holds the selection', () => {

            const panelState = buildDeployablePanelState();
            activate(panelState);

            panelState.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true, statusText: 'Creating scratch org…', isFailure: false, hasOutput: false };
            expect(RecipeCockpitService.routePanelMessage(deployMessage, panelState)?.kind).toBe('postMetadataDeployState');

            panelState.scratchOrgStateMessage = undefined;
            panelState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };
            expect(RecipeCockpitService.routePanelMessage(deployMessage, panelState)?.kind).toBe('postMetadataDeployState');

            panelState.insertStateMessage = undefined;
            expect(RecipeCockpitService.routePanelMessage(deployMessage, panelState)?.kind).toBe('deployMissingMetadata');

        });

        it('opens only the result file the host holds, and replays the deploy\'s line to a reloaded document', () => {

            const panelState = buildDeployablePanelState();
            const endedState = { command: 'metadataDeployState' as const, isRunning: false, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account', statusText: 'done', isFailure: false, hasOutput: true };
            panelState.metadataDeployStateMessage = endedState;

            expect(RecipeCockpitService.routePanelMessage({ command: 'viewMetadataDeployOutput', filePath: '/etc/passwd' }, panelState)).toBeUndefined();

            panelState.metadataDeployOutputFilePath = '/workspace/treecipe/OrgOperations/qa/1-metadata-deploy.json';

            expect(RecipeCockpitService.routePanelMessage({ command: 'viewMetadataDeployOutput', filePath: '/etc/passwd' }, panelState))
                .toEqual({ kind: 'viewMetadataDeployOutput', outputFilePath: '/workspace/treecipe/OrgOperations/qa/1-metadata-deploy.json' });
            expect(RecipeCockpitService.buildReplayMessages(panelState)).toContainEqual(endedState);

        });

    });

    describe('the host, against a faked org and Salesforce CLI', () => {

        let temporaryRoot: string;
        let workspaceRoot: string;
        let savedPathVariable: string | undefined;
        let receivedMessageHandler: (panelMessage: any) => Promise<void>;
        let postedPanelMessages: any[];
        let cliCalls: string[][];
        let orgDescribes: Record<string, any>;
        let organizationAnswers: Array<{ IsSandbox: boolean; OrganizationType: string }>;
        let deployHandler: (argumentList: string[]) => { stdout: string; error?: unknown } | 'hold';
        let heldDeployCallbacks: Array<() => void>;
        let cancellationListeners: Array<() => void>;
        let cancellationToken: { isCancellationRequested: boolean; onCancellationRequested: (listener: () => void) => void };
        let openFileSpy: jest.SpyInstance;
        let notificationWarningSpy: jest.SpyInstance;
        let notificationInformationSpy: jest.SpyInstance;
        let describeCalls: string[];
        let childKill: jest.Mock;

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const deployCalls = () => cliCalls.filter(argumentList => argumentList[0] === 'project');
        const lastDeployState = () => postedNamed('metadataDeployState').at(-1);
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;

        const treeReadiness = (treeKey: string, objectApiName: string) => [...postedNamed('dataOrgReadiness')].reverse()
            .flatMap(readinessMessage => readinessMessage.createTargets)
            .find((readiness: any) => readiness.treeKey === treeKey && readiness.objectApiName === objectApiName);

        const acknowledgeReadiness = async () => {
            const readinessMessage = postedNamed('dataOrgReadiness').at(-1);
            await receivedMessageHandler({ command: 'readinessRendered', renderSequence: readinessMessage.renderSequence, requestSequence: readinessMessage.requestSequence, readinessSequence: readinessMessage.readinessSequence });
        };

        const openCockpitWithQaSelected = async () => {
            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) });
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await flushAsyncWork();
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
            await flushAsyncWork();
            await acknowledgeReadiness();
        };

        const deploy = async (treeKey: string, objectApiName: string) => {
            await receivedMessageHandler({ command: 'deployMissingMetadata', orgIndex: 0, treeKey: treeKey, objectApiName: objectApiName });
            await flushAsyncWork();
        };

        beforeEach(() => {

            temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-cockpit-deploy-'));
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
            heldDeployCallbacks = [];
            cancellationListeners = [];
            orgDescribes = buildOrgDescribes();
            organizationAnswers = [];
            childKill = jest.fn();
            deployHandler = (argumentList: string[]) => {
                const members = argumentList.filter((argument, argumentIndex) => argumentList[argumentIndex - 1] === '--metadata');
                // THE DEPLOY LANDS: THE NEXT DESCRIBE SEES WHAT IT ADDED
                members.forEach(member => {
                    const [componentType, componentName] = member.split(':');
                    if ( componentType === 'CustomObject' ) {
                        orgDescribes[componentName] = { name: componentName, createable: true, fields: [] };
                    } else {
                        const [objectApiName, fieldApiName] = componentName.split('.');
                        orgDescribes[objectApiName].fields.push({ name: fieldApiName, type: fieldApiName.startsWith('Contact') ? 'reference' : 'string', referenceTo: ['Contact'], nillable: true, createable: true });
                    }
                });
                return { stdout: buildDeployAnswer(members.map(member => member.split(':')[1]), []) };
            };

            (execFile as unknown as jest.Mock).mockReset();
            (execFile as unknown as jest.Mock).mockImplementation((_command: string, argumentList: string[], _options: unknown, callback: any) => {
                cliCalls.push(argumentList);
                const answerWith = (cliAnswer: { stdout: string; error?: unknown }) => setImmediate(() => callback(cliAnswer.error ?? null, cliAnswer.stdout, ''));
                if ( argumentList[0] === 'org' && argumentList[1] === 'list' ) {
                    answerWith({ stdout: JSON.stringify(SF_ORG_LIST) });
                } else {
                    const cliAnswer = deployHandler(argumentList);
                    if ( cliAnswer === 'hold' ) {
                        heldDeployCallbacks.push(() => answerWith({ stdout: '', error: Object.assign(new Error('killed'), { code: null, signal: 'SIGTERM' }) }));
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
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_message: string, options: any) => options?.modal ? RECIPE_COCKPIT_METADATA_DEPLOY_CONFIRM_LABEL : undefined);
            (vscode.window.showErrorMessage as jest.Mock).mockReset();
            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined);
            (vscode.window.showInformationMessage as jest.Mock).mockReset();

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
            openFileSpy = jest.spyOn(VSCodeWorkspaceService, 'openFileInEditor').mockResolvedValue(undefined);
            jest.spyOn(SalesforceOrgService, 'getConnection').mockImplementation(async () => ({
                describe: jest.fn().mockImplementation(async (objectApiName: string) => {
                    describeCalls.push(objectApiName);
                    if ( !orgDescribes[objectApiName] ) {
                        throw Object.assign(new Error('The requested resource does not exist'), { errorCode: 'NOT_FOUND' });
                    }
                    return JSON.parse(JSON.stringify(orgDescribes[objectApiName]));
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

        it('offers the deploy for missing fields, names the org and every member in a modal, deploys them, clears that describe and rebuilds readiness until the tree can be inserted', async () => {

            await openCockpitWithQaSelected();

            expect(treeReadiness(ACCOUNT_TREE_KEY, 'Account')).toMatchObject({ isMetadataDeployable: true, missingFieldApiNames: ['Legacy_Code__c', 'Rating__c'] });
            expect(treeReadiness(ACCOUNT_TREE_KEY, 'OtherChildObject__c')).toMatchObject({ isMetadataDeployable: true });
            expect(treeReadiness(ACCOUNT_TREE_KEY, 'Contact')).toMatchObject({ disabledReason: '' });
            expect(treeReadiness(ACCOUNT_TREE_KEY, 'Contact')).not.toHaveProperty('isMetadataDeployable');

            await deploy(ACCOUNT_TREE_KEY, 'Account');

            const [modalMessage, modalOptions, modalAction] = (vscode.window.showWarningMessage as jest.Mock).mock.calls[0];
            expect(modalMessage).toBe(`Deploy 2 components of Account to qa · ${QA_USERNAME}?`);
            expect(modalOptions.modal).toBe(true);
            expect(modalOptions.detail).toContain(`Org: qa · ${QA_USERNAME}`);
            expect(modalOptions.detail).toContain('To deploy (2):\n  CustomField:Account.Legacy_Code__c\n  CustomField:Account.Rating__c');
            expect(modalOptions.detail).not.toContain('Skipped');
            expect(modalAction).toBe(RECIPE_COCKPIT_METADATA_DEPLOY_CONFIRM_LABEL);

            expect(deployCalls()).toEqual([[
                'project', 'deploy', 'start',
                '--metadata', 'CustomField:Account.Legacy_Code__c',
                '--metadata', 'CustomField:Account.Rating__c',
                '--target-org', QA_USERNAME,
                '--json'
            ]]);
            const deployExecOptions = (execFile as unknown as jest.Mock).mock.calls.find(([, argumentList]) => argumentList[0] === 'project')[2];
            expect(deployExecOptions.cwd).toBe(path.resolve(workspaceRoot));

            expect(postedNamed('metadataDeployState').map(deployState => deployState.statusText)).toContain('Deploying 2 components of Account…');
            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: false, hasOutput: true, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account' });
            expect(notificationInformationSpy).toHaveBeenCalledWith(expect.stringContaining('Deployed 2 components of Account'));
            expect(JSON.stringify(postedNamed('metadataDeployState'))).not.toContain(workspaceRoot);

            // ONLY Account WAS DESCRIBED AGAIN: ITS CACHE ENTRY WAS DROPPED, THE OTHERS WERE ANSWERED FROM THE CACHE
            expect(describeCalls.filter(objectApiName => objectApiName === 'Account')).toHaveLength(2);
            expect(describeCalls.filter(objectApiName => objectApiName === 'Contact')).toHaveLength(1);
            expect(treeReadiness(ACCOUNT_TREE_KEY, 'Account')).toMatchObject({ disabledReason: '' });
            // THE BUTTONS COME BACK ONLY AFTER THE READINESS THE DEPLOY CHANGED HAS BEEN POSTED
            expect(postedPanelMessages.indexOf(lastDeployState())).toBeGreaterThan(postedPanelMessages.indexOf(postedNamed('dataOrgReadiness').at(-1)));

            // THE OBJECT ITSELF IS MISSING NEXT: CustomObject PLUS ITS RECIPE'S CUSTOM FIELDS, Ratio__c SKIPPED FOR HAVING NO SOURCE
            await acknowledgeReadiness();
            await deploy(ACCOUNT_TREE_KEY, 'OtherChildObject__c');

            const objectModalDetail = (vscode.window.showWarningMessage as jest.Mock).mock.calls[1][1].detail;
            expect(objectModalDetail).toContain('To deploy (3):\n  CustomObject:OtherChildObject__c\n  CustomField:OtherChildObject__c.Score__c\n  CustomField:OtherChildObject__c.Contact__c');
            expect(objectModalDetail).toContain('Skipped (1):\n  OtherChildObject__c.Ratio__c — not in local source');
            expect(objectModalDetail).toContain('CustomObject:OtherChildObject__c deploys the object with everything in its source folder (2 files)');
            expect(deployCalls()[1]).toEqual([
                'project', 'deploy', 'start',
                '--metadata', 'CustomObject:OtherChildObject__c',
                '--metadata', 'CustomField:OtherChildObject__c.Score__c',
                '--metadata', 'CustomField:OtherChildObject__c.Contact__c',
                '--target-org', QA_USERNAME,
                '--json'
            ]);

            // Ratio__c IS STILL MISSING, SO THE INSERT STAYS OFF AND SAYS WHY -- CREATE IS ENABLED ONLY BY WHAT A FRESH DESCRIBE SAYS
            expect(treeReadiness(ACCOUNT_TREE_KEY, 'OtherChildObject__c')).toMatchObject({ missingFieldApiNames: ['Ratio__c'] });
            orgDescribes.OtherChildObject__c.fields.push({ name: 'Ratio__c', type: 'double', nillable: true, createable: true });
            SalesforceOrgService.clearDescribeCache(QA_USERNAME, 'OtherChildObject__c');
            await receivedMessageHandler({ command: 'refreshDataOrgs' });
            await flushAsyncWork();
            await flushAsyncWork();

            ['Account', 'Contact', 'OtherChildObject__c'].forEach(objectApiName => expect(treeReadiness(ACCOUNT_TREE_KEY, objectApiName)).toMatchObject({ disabledReason: '' }));

            const operationsFolderPath = path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, QA_USERNAME);
            expect(fs.readdirSync(operationsFolderPath).filter(fileName => /-metadata-deploy(-\d+)?\.json$/.test(fileName))).toHaveLength(2);

        });

        it('says "1 component" for a deploy of one member', async () => {

            orgDescribes.Account.fields.push({ name: 'Legacy_Code__c', type: 'string', nillable: true, createable: true });
            await openCockpitWithQaSelected();

            await deploy(ACCOUNT_TREE_KEY, 'Account');

            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[0][0]).toBe(`Deploy 1 component of Account to qa · ${QA_USERNAME}?`);
            expect(postedNamed('metadataDeployState').map(deployState => deployState.statusText)).toContain('Deploying 1 component of Account…');
            expect(notificationInformationSpy).toHaveBeenCalledWith(expect.stringContaining('Deployed 1 component of Account'));

        });

        it('holds the deploy in flight until the readiness it changed is checked again, and never offers the deployed target in between', async () => {

            await openCockpitWithQaSelected();
            let releaseRefresh: () => void = () => undefined;
            const refreshHeld = new Promise<void>(resolve => { releaseRefresh = resolve; });
            const refreshSpy = jest.spyOn(RecipeCockpitService as any, 'refreshDataOrgReadinessForTrees').mockImplementationOnce(async () => { await refreshHeld; });

            const deployInFlight = deploy(ACCOUNT_TREE_KEY, 'Account');
            for ( let turn = 0; turn < 6; turn++ ) {
                await flushAsyncWork();
            }

            expect(refreshSpy).toHaveBeenCalledTimes(1);
            expect(lastDeployState()).toMatchObject({ isRunning: true });
            expect(lastDeployState().statusText).toContain('Checking the tree again…');
            expect(panelState().deployTargets.has(RecipeCockpitService.buildTreeObjectKey(ACCOUNT_TREE_KEY, 'Account'))).toBe(false);
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployMissingMetadata', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account' }, panelState())).toBeUndefined();

            releaseRefresh();
            await deployInFlight;

            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: false });
            // THE TARGET IS GONE UNTIL A READINESS POSTED AFTER THE DEPLOY OFFERS IT AGAIN
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployMissingMetadata', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account' }, panelState())?.kind).toBe('postMetadataDeployState');
            expect(deployCalls()).toHaveLength(1);

        });

        it('activates only the targets of the readiness the panel drew, never a later one\'s it has not drawn yet', async () => {

            orgDescribes.Lead.fields = [{ name: 'Company', type: 'string', nillable: false, createable: true }];
            await openCockpitWithQaSelected();
            const firstReadiness = postedNamed('dataOrgReadiness').at(-1);
            const leadKey = RecipeCockpitService.buildTreeObjectKey(LEAD_TREE_KEY, 'Lead');

            // A SECOND READINESS FOR THE SAME SELECTION, POSTED BUT NOT YET DRAWN, ADDS NOTHING TO WHAT IS ACTIVE
            const state = panelState();
            state.pendingDeployTargets.set('Extra\nGone__c', { treeKey: 'Extra', objectApiName: 'Gone__c', isObjectMissing: true, fieldApiNames: [] });
            (RecipeCockpitService as any).postDataOrgReadiness((RecipeCockpitService as any).recipeCockpitPanel, state, { ...firstReadiness, createTargets: [], readinessSequence: undefined });
            await receivedMessageHandler({ command: 'readinessRendered', renderSequence: firstReadiness.renderSequence, requestSequence: firstReadiness.requestSequence, readinessSequence: firstReadiness.readinessSequence });

            expect(state.deployTargets.has(leadKey)).toBe(true);
            expect(state.deployTargets.has('Extra\nGone__c')).toBe(false);

        });

        it('still describes the object afresh when something throws after the CLI started', async () => {

            jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
            jest.spyOn(ScratchOrgService, 'readCliJsonPayload').mockImplementation(() => { throw new Error('parse exploded'); });
            await openCockpitWithQaSelected();

            await deploy(ACCOUNT_TREE_KEY, 'Account');

            expect(deployCalls()).toHaveLength(1);
            expect(describeCalls.filter(objectApiName => objectApiName === 'Account')).toHaveLength(2);
            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: true, statusText: 'The deploy of Account stopped: parse exploded' });

        });

        it('runs nothing when the reader cancels the confirmation', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);
            await openCockpitWithQaSelected();

            await deploy(ACCOUNT_TREE_KEY, 'Account');

            expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
            expect(deployCalls()).toEqual([]);
            expect(lastDeployState()).toMatchObject({ isRunning: false, statusText: '' });

        });

        it('asks the Organization row again after the confirmation, and deploys nothing to an org that does not answer it is a sandbox', async () => {

            await openCockpitWithQaSelected();
            organizationAnswers.push({ IsSandbox: false, OrganizationType: 'Enterprise Edition' });

            await deploy(ACCOUNT_TREE_KEY, 'Account');

            expect(deployCalls()).toEqual([]);
            expect(execFile).not.toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(['project']), expect.anything(), expect.anything());
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining('Metadata is deployed only to a sandbox or scratch org.'));
            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: true });

        });

        it('runs nothing for a forged deploy before the readiness was drawn, for another object, or for an org index that is not selected', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) });
            await receivedMessageHandler({ command: 'ready' });
            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await flushAsyncWork();
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
            await flushAsyncWork();

            await deploy(ACCOUNT_TREE_KEY, 'Account');
            await acknowledgeReadiness();
            await deploy(ACCOUNT_TREE_KEY, 'Contact');
            await receivedMessageHandler({ command: 'deployMissingMetadata', orgIndex: 1, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account' });

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(deployCalls()).toEqual([]);

        });

        it('says why and runs nothing when only standard fields are missing', async () => {

            delete orgDescribes.Lead.fields;
            orgDescribes.Lead.fields = [{ name: 'Company', type: 'string', nillable: false, createable: true }];
            await openCockpitWithQaSelected();

            expect(treeReadiness(LEAD_TREE_KEY, 'Lead')).toMatchObject({ isMetadataDeployable: true, missingFieldApiNames: ['Status'] });

            await deploy(LEAD_TREE_KEY, 'Lead');

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(deployCalls()).toEqual([]);
            expect(notificationWarningSpy).toHaveBeenCalledWith('Nothing of Lead can be deployed: Lead.Status is not a custom field \\u0028__c\\u0029, which this does not deploy.');

        });

        it('warns -- never an error -- with "N of M components failed" and View output when part of the deploy fails, and still clears the describe and rebuilds readiness', async () => {

            deployHandler = () => ({ stdout: buildDeployAnswer(['Account.Legacy_Code__c'], [{ fullName: 'Account.Rating__c', problem: 'Value set Ratings not found' }]), error: Object.assign(new Error('exit 1'), { code: 1 }) });
            (vscode.window.showWarningMessage as jest.Mock).mockImplementation(async (_message: string, options: any) => options?.modal ? RECIPE_COCKPIT_METADATA_DEPLOY_CONFIRM_LABEL : RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL);
            await openCockpitWithQaSelected();
            const readinessPostsBefore = postedNamed('dataOrgReadiness').length;

            await deploy(ACCOUNT_TREE_KEY, 'Account');
            await flushAsyncWork();

            const [warningText, warningAction] = (vscode.window.showWarningMessage as jest.Mock).mock.calls[1];
            expect(warningText).toContain('1 of 2 components failed to deploy to qa');
            expect(warningText).toContain('so none was applied');
            expect(warningText).toContain('Account.Rating__c: Value set Ratings not found');
            expect(warningAction).toBe(RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL);
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();

            const operationsFolderPath = path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, QA_USERNAME);
            const resultFilePath = path.join(operationsFolderPath, fs.readdirSync(operationsFolderPath).find(fileName => fileName.endsWith('-metadata-deploy.json')));
            expect(openFileSpy).toHaveBeenCalledWith(resultFilePath);
            expect(describeCalls.filter(objectApiName => objectApiName === 'Account')).toHaveLength(2);
            expect(postedNamed('dataOrgReadiness').length).toBeGreaterThan(readinessPostsBefore);
            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: true, hasOutput: true });

            openFileSpy.mockClear();
            await receivedMessageHandler({ command: 'viewMetadataDeployOutput', filePath: '/etc/passwd' });
            expect(openFileSpy).toHaveBeenCalledWith(resultFilePath);

        });

        it('shows an error with View output when the whole deploy fails, and when the --json is malformed, never a success', async () => {

            deployHandler = () => ({ stdout: buildDeployAnswer([], [{ fullName: 'Account.Legacy_Code__c', problem: 'p' }, { fullName: 'Account.Rating__c', problem: 'q' }]), error: Object.assign(new Error('exit 1'), { code: 1 }) });
            await openCockpitWithQaSelected();

            await deploy(ACCOUNT_TREE_KEY, 'Account');

            expect((vscode.window.showErrorMessage as jest.Mock).mock.calls[0]).toEqual([
                expect.stringContaining('The deploy of Account to qa'),
                RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL
            ]);
            expect(describeCalls.filter(objectApiName => objectApiName === 'Account')).toHaveLength(2);

            deployHandler = () => ({ stdout: 'Deploy Succeeded.' });
            await acknowledgeReadiness();
            await deploy(ACCOUNT_TREE_KEY, 'Account');

            expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(2);
            expect(notificationInformationSpy).not.toHaveBeenCalled();
            expect(lastDeployState()).toMatchObject({ isFailure: true });

        });

        it('says the Salesforce CLI is required when sf is not installed', async () => {

            process.env.PATH = path.join(temporaryRoot, 'nowhere');
            await openCockpitWithQaSelected();

            await deploy(ACCOUNT_TREE_KEY, 'Account');

            expect((vscode.window.showErrorMessage as jest.Mock).mock.calls[0][0]).toContain('The Salesforce CLI is required to deploy metadata, and "sf" is not installed or not on PATH.');
            expect(deployCalls()).toEqual([]);

        });

        it('refuses before the confirmation when the workspace has no sfdx-project.json', async () => {

            fs.rmSync(path.join(workspaceRoot, 'sfdx-project.json'));
            await openCockpitWithQaSelected();

            await deploy(ACCOUNT_TREE_KEY, 'Account');

            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(deployCalls()).toEqual([]);
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining('Nothing was deployed: No "sfdx-project.json" found'));

        });

        it('deploys nothing when the org cannot be connected to for the second Organization check', async () => {

            await openCockpitWithQaSelected();
            (SalesforceOrgService.getConnection as jest.Mock).mockRejectedValueOnce(new Error('expired access token'));

            await deploy(ACCOUNT_TREE_KEY, 'Account');

            expect(deployCalls()).toEqual([]);
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining('could not connect to qa · qa@example.com.qa: expired access token'));
            expect(describeCalls.filter(objectApiName => objectApiName === 'Account')).toHaveLength(1);

        });

        it('warns that a deploy which timed out may have partly applied, and still describes the object afresh', async () => {

            await openCockpitWithQaSelected();
            jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli').mockResolvedValue({ stdout: '', stderr: '', exitCode: null, timedOut: true });

            await deploy(ACCOUNT_TREE_KEY, 'Account');

            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[1][0]).toContain('may have partly applied');
            expect((vscode.window.showWarningMessage as jest.Mock).mock.calls[1][0]).toContain('sf project deploy report --target-org qa@example.com.qa');
            expect(describeCalls.filter(objectApiName => objectApiName === 'Account')).toHaveLength(2);

        });

        it('ends the deploy\'s line and rethrows when the run itself throws, so the panel is given its buttons back', async () => {

            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
            await openCockpitWithQaSelected();
            jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli').mockRejectedValue(new Error('boom'));

            await deploy(ACCOUNT_TREE_KEY, 'Account');

            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: true, statusText: 'The deploy of Account stopped: boom' });
            expect(handleCapturedErrorSpy).toHaveBeenCalled();

        });

        it('says so rather than opening anything when the result file is gone', async () => {

            await openCockpitWithQaSelected();
            await deploy(ACCOUNT_TREE_KEY, 'Account');
            fs.rmSync(panelState().metadataDeployOutputFilePath);

            await receivedMessageHandler({ command: 'viewMetadataDeployOutput' });

            expect(openFileSpy).not.toHaveBeenCalled();
            expect(notificationWarningSpy).toHaveBeenCalledWith('The deploy result file no longer exists in this workspace.');

        });

        it('carries a deploy in flight into a reopened panel, which refuses a second one and is told where the first is', async () => {

            deployHandler = () => 'hold';
            await openCockpitWithQaSelected();

            const deployInFlight = deploy(ACCOUNT_TREE_KEY, 'Account');
            await flushAsyncWork();
            await flushAsyncWork();

            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) });
            await receivedMessageHandler({ command: 'ready' });

            expect(panelState().metadataDeployStateMessage).toMatchObject({ isRunning: true, objectApiName: 'Account' });
            expect(postedNamed('metadataDeployState').at(-1)).toMatchObject({ isRunning: true });
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployMissingMetadata', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account' }, panelState())).toBeUndefined();

            heldDeployCallbacks.forEach(answer => answer());
            await deployInFlight;
            await flushAsyncWork();

            expect(lastDeployState()).toMatchObject({ isRunning: false });

        });

        it('kills the process tree on cancel, says the deploy may have partly applied, and refuses a second deploy meanwhile', async () => {

            deployHandler = () => 'hold';
            await openCockpitWithQaSelected();
            const killSpy = jest.spyOn(PicklistDependencyCheckService, 'killProcessTree');

            const deployInFlight = deploy(ACCOUNT_TREE_KEY, 'Account');
            await flushAsyncWork();
            await flushAsyncWork();

            expect(lastDeployState()).toMatchObject({ isRunning: true, statusText: 'Deploying 2 components of Account…' });

            await receivedMessageHandler({ command: 'deployMissingMetadata', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'OtherChildObject__c' });
            expect(deployCalls()).toHaveLength(1);

            cancellationToken.isCancellationRequested = true;
            cancellationListeners.forEach(cancellationListener => cancellationListener());
            heldDeployCallbacks.forEach(answer => answer());
            await deployInFlight;
            await flushAsyncWork();

            expect(killSpy).toHaveBeenCalled();
            expect(childKill).toHaveBeenCalled();
            expect(notificationInformationSpy).toHaveBeenCalledWith(expect.stringContaining('was cancelled and may have partly applied'));
            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: true });
            expect(lastDeployState().statusText).toContain('may have partly applied');

        });

    });

    describe('the panel script', () => {

        const loadTreeRecipe = () => {
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, 'recipe-2026-09-20T10-00-00').recipeViewModel;
        };

        const firstOf = (panel: ReturnType<typeof runPanelScript>, className: string) => panel.findAll(panel.cockpitBodyElement, className)[0];

        const accountCard = (panel: ReturnType<typeof runPanelScript>) => panel.treeCards()
            .find((treeCard: any) => panel.findAll(treeCard, 'treeInsert').length > 0 && panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes('OtherChildObject__c')))
            ?? panel.treeCards()[0];

        const renderWithReadiness = (accountReadiness: any) => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', hiddenOrgCount: 0, hiddenOrgNote: '', forgottenOrgNotice: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Sandbox', isSandbox: true, failureMessage: '', requestSequence: 5, renderSequence: 1 });
            panel.postToPanel({
                command: 'dataOrgReadiness',
                objects: [],
                createTargets: [{ treeKey: ACCOUNT_TREE_KEY, ...accountReadiness }],
                insertResults: [],
                requestSequence: 5,
                renderSequence: 1
            });
            return panel;
        };

        const deployButtonOf = (panel: ReturnType<typeof runPanelScript>) => panel.findAll(accountCard(panel), 'treeInsertDeploy')[0];

        it('draws the button under a missing-fields reason, posts names and the org index only, and acknowledges the readiness it drew', () => {

            const panel = renderWithReadiness({ objectApiName: 'Account', disabledReason: 'Account is missing 2 recipe fields in this org: Legacy_Code__c, Rating__c.', requiredLookups: [], missingFieldApiNames: ['Legacy_Code__c', 'Rating__c'], isMetadataDeployable: true });
            const deployButton = deployButtonOf(panel);

            expect(panel.postedHostMessages).toContainEqual({ command: 'readinessRendered', renderSequence: 1, requestSequence: 5 });
            expect(deployButton.textContent).toBe(RECIPE_COCKPIT_METADATA_DEPLOY_ACTION_LABEL);
            expect(panel.isHidden(deployButton)).toBe(false);
            expect(panel.findAll(accountCard(panel), 'treeInsertReason')[0].textContent).toContain('is missing 2 recipe fields');

            deployButton.dispatch('click');

            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'deployMissingMetadata', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account' });
            expect(deployButton.disabled).toBe(true);
            expect(firstOf(panel, 'dataOrgSelect').disabled).toBe(true);

            deployButton.dispatch('click');
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'deployMissingMetadata')).toHaveLength(1);

        });

        it('draws no button for a not-createable-only reason, a production reason or a readiness the host did not mark', () => {

            expect(panelIsHiddenFor({ objectApiName: 'Account', disabledReason: 'Account has 1 recipe field this org will not let you set: Legacy__c.', requiredLookups: [], missingFieldApiNames: [], notCreateableFieldApiNames: ['Legacy__c'] })).toBe(true);
            expect(panelIsHiddenFor({ objectApiName: 'Account', disabledReason: 'Records are inserted only into a sandbox or scratch org, and this org is Production · Enterprise Edition.', requiredLookups: [] })).toBe(true);
            expect(panelIsHiddenFor({ objectApiName: 'OtherChildObject__c', disabledReason: 'OtherChildObject__c is not in this org (INVALID_SESSION_ID: x).', requiredLookups: [] })).toBe(true);
            expect(panelIsHiddenFor({ objectApiName: 'Account', disabledReason: '', requiredLookups: [] })).toBe(true);

            function panelIsHiddenFor(accountReadiness: any) {
                const panel = renderWithReadiness(accountReadiness);
                return panel.isHidden(deployButtonOf(panel));
            }

        });

        it('holds every insert, every deploy and the picker while a deploy runs, draws its line on the card, and offers View output when it ended with a result file', () => {

            const panel = renderWithReadiness({ objectApiName: 'OtherChildObject__c', disabledReason: 'OtherChildObject__c is not in this org (NOT_FOUND: x).', requiredLookups: [], isMetadataDeployable: true });

            panel.postToPanel({ command: 'metadataDeployState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'OtherChildObject__c', statusText: 'Deploying 3 components of OtherChildObject__c…', isFailure: false, hasOutput: false });

            expect(deployButtonOf(panel).disabled).toBe(true);
            panel.findAll(panel.cockpitBodyElement, 'treeInsert').forEach((insertButton: any) => expect(insertButton.disabled).toBe(true));
            expect(firstOf(panel, 'dataOrgRefresh').disabled).toBe(true);
            expect(firstOf(panel, 'dataOrgNewScratch').disabled).toBe(true);
            expect(panel.findAll(accountCard(panel), 'metadataDeployStatusText')[0].textContent).toBe('Deploying 3 components of OtherChildObject__c…');
            expect(panel.isHidden(panel.findAll(accountCard(panel), 'metadataDeployViewOutput')[0])).toBe(true);

            panel.postToPanel({ command: 'metadataDeployState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'OtherChildObject__c', statusText: '1 of 3 components failed to deploy to qa: x', isFailure: true, hasOutput: true });

            expect(deployButtonOf(panel).disabled).toBe(false);
            expect(firstOf(panel, 'dataOrgSelect').disabled).toBe(false);
            expect(panel.findAll(accountCard(panel), 'metadataDeployStatus')[0].classList.contains('failed')).toBe(true);
            const viewOutputElement = panel.findAll(accountCard(panel), 'metadataDeployViewOutput')[0];
            expect(panel.isHidden(viewOutputElement)).toBe(false);
            viewOutputElement.dispatch('click');
            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'viewMetadataDeployOutput' });

        });

        it('is named in the preview warning, which says what the cockpit can write to an org', () => {

            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('"Deploy missing metadata…", shown under an insert stopped by an object or fields the selected sandbox lacks, deploys only those custom objects and fields');

        });

        it('still builds the shell from the nonce alone', () => {

            expect(RecipeCockpitService.buildWebviewShellHtml.length).toBe(1);
            expect(RecipeCockpitService.buildWebviewShellHtml('n')).not.toContain('Deploying');

        });

    });

});
