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
    RECIPE_COCKPIT_METADATA_DEPLOY_ACTION_LABEL,
    RECIPE_COCKPIT_METADATA_DEPLOY_CONFIRM_LABEL,
    RECIPE_COCKPIT_METADATA_DEPLOY_OPEN_STATUS_LABEL,
    RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL,
    RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL
} from '../RecipeCockpitService';
import { METADATA_DEPLOY_NOTIFICATION_SKIPS_SHOWN, METADATA_DEPLOY_SOURCE_FILES_SHOWN, RecipeCockpitMetadataDeploy } from '../RecipeCockpitMetadataDeploy';
import { RecipeCockpitRecordCreation } from '../RecipeCockpitRecordCreation';
import { runPanelScript } from './RecipeCockpitPanelHarness';
import { SalesforceOrgService } from '../../SalesforceOrgService/SalesforceOrgService';
import { ORG_OPERATIONS_FOLDER_NAME, ScratchOrgService } from '../../ScratchOrgService/ScratchOrgService';
import { VSCodeWorkspaceService } from '../../VSCodeWorkspace/VSCodeWorkspaceService';
import { PicklistDependencyCheckService } from '../../PicklistDependencyCheckService/PicklistDependencyCheckService';
import { ErrorHandlingService } from '../../ErrorHandlingService/ErrorHandlingService';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { RecipeYamlScalar } from '../../RecipeFakerService.ts/RecipeYamlScalar/RecipeYamlScalar';

const RecipeYamlScalarEscape = (notificationText: string) => RecipeYamlScalar.escapeForNotification(notificationText);

const TREE_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'treeWorkspace');
const METADATA_DEPLOY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'metadataDeployWorkspace');
const SALESFORCE_ORG_MOCKS_PATH = path.join(__dirname, '..', '..', 'SalesforceOrgService', 'tests', 'mocks');

const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, 'utf-8'));
const SF_ORG_LIST = readJson(path.join(SALESFORCE_ORG_MOCKS_PATH, 'sfOrgListVerbose.json'));
const ORG_AUTHORIZATIONS = readJson(path.join(SALESFORCE_ORG_MOCKS_PATH, 'orgAuthorizations.json'));

const ACCOUNT_TREE_KEY = 'Account-thru-OtherChildObject__c';
const LEAD_TREE_KEY = 'Lead-ONLY';
const ACCOUNT_TREE_OBJECTS = ['Account', 'User', 'Contact', 'OtherChildObject__c'];
const ACCOUNT_TREE_MEMBERS = ['CustomField:Account.Legacy_Code__c', 'CustomField:Account.Rating__c', 'CustomObject:OtherChildObject__c'];
// AS A package.xml LISTS THEM: BY TYPE, THEN BY NAME
const ACCOUNT_TREE_MANIFEST_MEMBERS = ['CustomField:Account.Legacy_Code__c', 'CustomField:Account.Rating__c', 'CustomObject:OtherChildObject__c'];
const QA_USERNAME = 'qa@example.com.qa';

// #283: THE DEPLOY ORG'S INSTANCE, AND A deployUrl ON IT AS "sf project deploy start --json" WRITES ONE
const QA_INSTANCE_URL = 'https://acme--qa.sandbox.my.salesforce.com';
const DEPLOY_ID = '0Af5e00000ABCDEFGH';
const buildDeployUrl = (instanceUrl: string) => `${instanceUrl}/lightning/setup/DeployStatus/page?address=%2Fchangemgmt%2FmonitorDeploymentsDetails.apexp%3FasyncId%3D${DEPLOY_ID}%26retURL%3D%252Fchangemgmt%252FmonitorDeployment.apexp`;
const DEPLOY_STATUS_PATH = `/lightning/setup/DeployStatus/page?address=/changemgmt/monitorDeploymentsDetails.apexp?asyncId=${DEPLOY_ID}`;
const SESSION_ID = '00D000000000001!AQEAQdeployStatusSecret';
const FRONTDOOR_URL = `${QA_INSTANCE_URL}/secur/frontdoor.jsp?sid=${SESSION_ID}&retURL=%2Flightning%2Fsetup%2FDeployStatus%2Fpage`;
const withDeployUrl = (deployAnswer: string, deployUrl: unknown): string => {
    const answer = JSON.parse(deployAnswer);
    answer.result.deployUrl = deployUrl;
    return JSON.stringify(answer);
};

// THE MEMBERS A package.xml NAMES, AS "<Type>:<Name>", IN THE ORDER THE FILE LISTS THEM
const readManifestMembers = (packageXml: string): string[] => [...packageXml.matchAll(/<types>([\s\S]*?)<\/types>/g)]
    .flatMap(typesMatch => {
        const componentType = /<name>([^<]*)<\/name>/.exec(typesMatch[1])[1];
        return [...typesMatch[1].matchAll(/<members>([^<]*)<\/members>/g)].map(memberMatch => `${componentType}:${memberMatch[1]}`);
    });

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

// THE ORG AS A DESCRIBE ANSWERS IT: ACCOUNT LACKS ITS SOURCE'S CUSTOM FIELDS, OtherChildObject__c IS NOT THERE AT ALL
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

describe('RecipeCockpitService, "Deploy this metadata…" in the Treecipe tab (#211, #270, #273)', () => {

    describe('RecipeCockpitRecordCreation', () => {

        it('makes a deployed object ready from the deploy\'s answer alone, keeping only a reason about the recipe itself (#270)', () => {

            expect(RecipeCockpitRecordCreation.buildDeployedObjectReadiness('Gone__c'))
                .toEqual({ objectApiName: 'Gone__c', disabledReason: '', requiredLookups: [] });
            expect(RecipeCockpitRecordCreation.buildDeployedObjectReadiness('Gone__c', 'The recipe file for this tree could not be read.'))
                .toEqual({ objectApiName: 'Gone__c', disabledReason: 'The recipe file for this tree could not be read.', requiredLookups: [] });

        });

        it('no longer marks any reason deployable: the button does not depend on the readiness (#273)', () => {

            const sandbox = { isSandbox: true, organizationType: 'Developer Edition' };

            expect(RecipeCockpitRecordCreation.buildCreateReadiness({ objectApiName: 'Gone__c', orgTypeDetail: sandbox, describeFailureMessage: 'NOT_FOUND: x' }))
                .toEqual({ objectApiName: 'Gone__c', disabledReason: 'Gone__c is not in this org (NOT_FOUND: x).', requiredLookups: [] });

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

        const objectsFolderPath = () => path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects');
        const plan = (objectApiNames: string[], packageDirectoryPaths = ['force-app', 'unpackaged']) =>
            RecipeCockpitMetadataDeploy.planTreeMetadataDeploy('Account tree', objectApiNames, workspaceRoot, packageDirectoryPaths);

        it('deploys every custom object of the tree whole, and only the custom fields in source of its standard objects', () => {

            expect(plan([...ACCOUNT_TREE_OBJECTS, 'Gadget__c'])).toEqual({
                treeLabel: 'Account tree',
                members: [...ACCOUNT_TREE_MEMBERS, 'CustomObject:Gadget__c'],
                objectPlans: [
                    {
                        objectApiName: 'Account',
                        members: ['CustomField:Account.Legacy_Code__c', 'CustomField:Account.Rating__c'],
                        sourceFiles: ['Account/fields/Legacy_Code__c.field-meta.xml', 'Account/fields/Rating__c.field-meta.xml']
                    },
                    {
                        objectApiName: 'OtherChildObject__c',
                        members: ['CustomObject:OtherChildObject__c'],
                        sourceFiles: ['OtherChildObject__c/OtherChildObject__c.object-meta.xml', 'OtherChildObject__c/fields/Contact__c.field-meta.xml', 'OtherChildObject__c/fields/Score__c.field-meta.xml']
                    },
                    {
                        objectApiName: 'Gadget__c',
                        members: ['CustomObject:Gadget__c'],
                        sourceFiles: ['Gadget__c/Gadget__c.object-meta.xml', 'Gadget__c/fields/Serial__c.field-meta.xml', 'Gadget__c/validationRules/Serial_Required.validationRule-meta.xml']
                    }
                ],
                skippedItems: [
                    { name: 'User', reason: 'noCustomFieldsInSource' },
                    { name: 'Contact', reason: 'noCustomFieldsInSource' }
                ]
            });

        });

        it('plans an object the tree lists twice, in any case, once, and spells every member as the source on disk does', () => {

            const treePlan = plan(['account', 'Account', 'otherchildobject__c', 'OtherChildObject__c']);

            expect(treePlan.members).toEqual(ACCOUNT_TREE_MEMBERS);
            expect(treePlan.objectPlans.map(objectPlan => objectPlan.objectApiName)).toEqual(['account', 'otherchildobject__c']);

        });

        it('leaves out a standard field file without listing it, and skips a field name that is not an api name and a field file that resolves outside the workspace', () => {

            const accountFieldsPath = path.join(objectsFolderPath(), 'Account', 'fields');
            const outsideFolderPath = path.join(temporaryRoot, 'outside');
            fs.mkdirSync(outsideFolderPath);
            fs.writeFileSync(path.join(outsideFolderPath, 'Escaped__c.field-meta.xml'), '<CustomField/>');
            fs.symlinkSync(path.join(outsideFolderPath, 'Escaped__c.field-meta.xml'), path.join(accountFieldsPath, 'Escaped__c.field-meta.xml'));
            fs.writeFileSync(path.join(accountFieldsPath, 'Name.field-meta.xml'), '<CustomField/>');
            fs.writeFileSync(path.join(accountFieldsPath, 'x --target-org prod.field-meta.xml'), '<CustomField/>');
            fs.writeFileSync(path.join(accountFieldsPath, 'Notes.txt'), 'not metadata');

            const treePlan = plan(['Account']);

            expect(treePlan.members).toEqual(['CustomField:Account.Legacy_Code__c', 'CustomField:Account.Rating__c']);
            expect(treePlan.skippedItems).toEqual(expect.arrayContaining([
                { name: 'Account.Escaped__c', reason: 'outsideWorkspace' },
                { name: 'Account.x --target-org prod', reason: 'notAnApiName' }
            ]));
            // A STANDARD FIELD'S FILE IS ORDINARY IN RETRIEVED SOURCE: NEITHER DEPLOYED NOR LISTED AS SKIPPED
            expect(treePlan.skippedItems).toHaveLength(2);

        });

        it('skips a custom object with no source, an object name that is not an api name, and a standard object with no folder', () => {

            expect(plan(['Gone__c', '../Account', 'Lead'])).toEqual({
                treeLabel: 'Account tree',
                members: [],
                objectPlans: [],
                skippedItems: [
                    { name: 'Gone__c', reason: 'notInLocalSource' },
                    { name: '../Account', reason: 'notAnApiName' },
                    { name: 'Lead', reason: 'noCustomFieldsInSource' }
                ]
            });

        });

        it('skips a custom object whose source file resolves outside the workspace, or whose folder has no object file', () => {

            const outsideFolderPath = path.join(temporaryRoot, 'outside');
            fs.mkdirSync(outsideFolderPath);
            fs.writeFileSync(path.join(outsideFolderPath, 'Gadget__c.object-meta.xml'), '<CustomObject/>');
            fs.rmSync(path.join(objectsFolderPath(), 'Gadget__c', 'Gadget__c.object-meta.xml'));
            fs.symlinkSync(path.join(outsideFolderPath, 'Gadget__c.object-meta.xml'), path.join(objectsFolderPath(), 'Gadget__c', 'Gadget__c.object-meta.xml'));
            fs.rmSync(path.join(objectsFolderPath(), 'OtherChildObject__c', 'OtherChildObject__c.object-meta.xml'));

            expect(plan(['Gadget__c', 'OtherChildObject__c'])).toMatchObject({
                members: [],
                skippedItems: [{ name: 'Gadget__c', reason: 'outsideWorkspace' }, { name: 'OtherChildObject__c', reason: 'notInLocalSource' }]
            });

        });

        it('lists a custom object\'s files from the package directory that has it, when another package directory has an objects folder without it', () => {

            fs.mkdirSync(path.join(workspaceRoot, 'unpackaged', 'objects', 'Contact'), { recursive: true });

            expect(plan(['Gadget__c']).objectPlans[0].sourceFiles).toEqual([
                'Gadget__c/Gadget__c.object-meta.xml',
                'Gadget__c/fields/Serial__c.field-meta.xml',
                'Gadget__c/validationRules/Serial_Required.validationRule-meta.xml'
            ]);

        });

        it('looks in every package directory, and treats one it cannot read as holding nothing', () => {

            const unpackagedFieldsPath = path.join(workspaceRoot, 'unpackaged', 'objects', 'Contact', 'fields');
            fs.mkdirSync(unpackagedFieldsPath, { recursive: true });
            fs.writeFileSync(path.join(unpackagedFieldsPath, 'Extra__c.field-meta.xml'), '<CustomField/>');

            expect(plan(['Contact']).members).toEqual(['CustomField:Contact.Extra__c']);
            expect(plan(['Account', 'OtherChildObject__c'], ['missing'])).toMatchObject({
                members: [],
                skippedItems: [{ name: 'Account', reason: 'noCustomFieldsInSource' }, { name: 'OtherChildObject__c', reason: 'notInLocalSource' }]
            });

        });

        // "K" (KELVIN SIGN) LOWERCASES TO "k": A CASE-INSENSITIVE MATCH FINDS IT, AND ONLY THE SECOND CHECK OF THE NAME ON DISK KEEPS IT OUT OF THE ARGV
        it('keeps out an object source and a field source whose names only match through Unicode case folding', () => {

            const kelvinFolderPath = path.join(objectsFolderPath(), 'GadKet__c');
            fs.renameSync(path.join(objectsFolderPath(), 'Gadget__c'), kelvinFolderPath);
            fs.renameSync(path.join(kelvinFolderPath, 'Gadget__c.object-meta.xml'), path.join(kelvinFolderPath, 'GadKet__c.object-meta.xml'));
            fs.writeFileSync(path.join(objectsFolderPath(), 'Account', 'fields', 'RanKing__c.field-meta.xml'), '<CustomField/>');

            const treePlan = plan(['Gadket__c', 'Account']);

            expect(treePlan.members).toEqual(['CustomField:Account.Legacy_Code__c', 'CustomField:Account.Rating__c']);
            expect(treePlan.skippedItems).toEqual([
                { name: 'Gadket__c', reason: 'notAnApiName' },
                { name: 'Account.RanKing__c', reason: 'notAnApiName' }
            ]);

        });

        it('lists every source file the deploy sends in the confirmation, and says a CustomObject sends its whole folder', () => {

            const detail = RecipeCockpitMetadataDeploy.buildConfirmationDetail(plan([...ACCOUNT_TREE_OBJECTS, 'Gadget__c']), 'qa · qa@example.com.qa');

            expect(detail).toContain('Tree: Account tree\nOrg: qa · qa@example.com.qa');
            expect(detail).toContain(`To deploy (4):\n  ${[...ACCOUNT_TREE_MEMBERS, 'CustomObject:Gadget__c'].join('\n  ')}`);
            expect(detail).toContain('Source files sent (8):\n  Account/fields/Legacy_Code__c.field-meta.xml');
            expect(detail).toContain('  Gadget__c/validationRules/Serial_Required.validationRule-meta.xml');
            expect(detail).toContain('Skipped (2):\n  User — a standard object with no custom field (__c) in local source\n  Contact — a standard object with no custom field (__c) in local source');
            expect(detail).toContain('A CustomObject member deploys everything in its object\'s source folder');
            expect(detail).toContain('the deploy is all or nothing');
            expect(detail).toContain('no permission set is deployed or assigned');
            expect(RecipeCockpitMetadataDeploy.buildConfirmationDetail(plan(['Account']), 'qa')).not.toContain('A CustomObject member');

            const manyFiles = Array.from({ length: METADATA_DEPLOY_SOURCE_FILES_SHOWN + 5 }, (unused, fileIndex) => `Gadget__c/fields/F${fileIndex}__c.field-meta.xml`);
            const crowdedDetail = RecipeCockpitMetadataDeploy.buildConfirmationDetail({ treeLabel: 't', members: ['CustomObject:Gadget__c'], objectPlans: [{ objectApiName: 'Gadget__c', members: ['CustomObject:Gadget__c'], sourceFiles: manyFiles }], skippedItems: [] }, 'qa');
            expect(crowdedDetail).toContain(`Source files sent (${METADATA_DEPLOY_SOURCE_FILES_SHOWN + 5}):`);
            expect(crowdedDetail).toContain('  and 5 more');

        });

        it('writes every repository name in the confirmation on one line', () => {

            const detail = RecipeCockpitMetadataDeploy.buildConfirmationDetail({
                treeLabel: 'Tree\nOrg: prod',
                members: ['CustomObject:Gadget__c'],
                objectPlans: [{ objectApiName: 'Gadget__c', members: ['CustomObject:Gadget__c'], sourceFiles: ['Gadget__c/x To deploy (0):'] }],
                skippedItems: []
            }, 'qa');

            expect(detail.split('\n').filter(line => line.startsWith('Org:'))).toEqual(['Org: qa']);
            expect(detail.split('\n').filter(line => line.startsWith('To deploy'))).toEqual(['To deploy (1):']);

        });

        it('caps every list in the confirmation and the skips a notification names, and counts the rest', () => {

            const manyMembers = Array.from({ length: METADATA_DEPLOY_SOURCE_FILES_SHOWN + 3 }, (unused, memberIndex) => `CustomField:Account.F${memberIndex}__c`);
            const manySkips = Array.from({ length: METADATA_DEPLOY_SOURCE_FILES_SHOWN + 4 }, (unused, skipIndex) => ({ name: `Gone${skipIndex}__c`, reason: 'notInLocalSource' as const }));
            const detail = RecipeCockpitMetadataDeploy.buildConfirmationDetail({ treeLabel: 't', members: manyMembers, objectPlans: [], skippedItems: manySkips }, 'qa');

            expect(detail).toContain(`To deploy (${METADATA_DEPLOY_SOURCE_FILES_SHOWN + 3}):`);
            expect(detail).toContain('  and 3 more');
            expect(detail).toContain(`Skipped (${METADATA_DEPLOY_SOURCE_FILES_SHOWN + 4}):`);
            expect(detail).toContain('  and 4 more');
            expect(detail).not.toContain(`F${METADATA_DEPLOY_SOURCE_FILES_SHOWN}__c`);

            const nothingMessage = RecipeCockpitMetadataDeploy.buildNothingToDeployMessage({ treeLabel: 't', members: [], objectPlans: [], skippedItems: manySkips });
            expect(nothingMessage).toContain(`Gone${METADATA_DEPLOY_NOTIFICATION_SKIPS_SHOWN - 1}__c is not in local source; and ${manySkips.length - METADATA_DEPLOY_NOTIFICATION_SKIPS_SHOWN} more.`);
            expect(nothingMessage).not.toContain(`Gone${METADATA_DEPLOY_NOTIFICATION_SKIPS_SHOWN}__c`);

        });

        it('says why nothing of a tree can be deployed', () => {

            expect(RecipeCockpitMetadataDeploy.buildNothingToDeployMessage(plan(['Lead'])))
                .toBe('Nothing of the tree Account tree can be deployed: Lead is a standard object with no custom field (__c) in local source.');

        });

        it('builds the argv: project deploy start, the manifest, the username as --target-org, --json, and no --source-dir or --metadata', () => {

            const deployArguments = RecipeCockpitMetadataDeploy.buildMetadataDeployArguments('/tmp/treecipe-metadata-deploy-x/package.xml', QA_USERNAME);

            expect(deployArguments).toEqual([
                'project', 'deploy', 'start',
                '--manifest', '/tmp/treecipe-metadata-deploy-x/package.xml',
                '--target-org', QA_USERNAME,
                '--json'
            ]);
            expect(deployArguments).not.toContain('--source-dir');
            expect(deployArguments).not.toContain('--metadata');

        });

        it('writes the members as a package.xml grouped by type, with the project\'s sourceApiVersion when it is a plain version', () => {

            expect(RecipeCockpitMetadataDeploy.buildPackageXml(['CustomObject:Gadget__c', 'CustomField:Account.Rating__c', 'CustomField:Account.Legacy_Code__c', 'CustomObject:Gadget__c'], '62.0')).toBe([
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
                '    <types>',
                '        <members>Account.Legacy_Code__c</members>',
                '        <members>Account.Rating__c</members>',
                '        <name>CustomField</name>',
                '    </types>',
                '    <types>',
                '        <members>Gadget__c</members>',
                '        <name>CustomObject</name>',
                '    </types>',
                '    <version>62.0</version>',
                '</Package>',
                ''
            ].join('\n'));
            expect(RecipeCockpitMetadataDeploy.buildPackageXml(['CustomObject:Gadget__c'], undefined)).not.toContain('<version>');
            expect(RecipeCockpitMetadataDeploy.buildPackageXml(['CustomObject:Gadget__c'], '62.0</version><x>')).not.toContain('<version>');

        });

        it('reads the sourceApiVersion only when it is a plain version number', () => {

            const projectFilePath = path.join(workspaceRoot, 'sfdx-project.json');
            const writeVersion = (sourceApiVersion: unknown) => fs.writeFileSync(projectFilePath, JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion }));

            writeVersion('61.0');
            expect(RecipeCockpitMetadataDeploy.readSourceApiVersion(workspaceRoot)).toBe('61.0');
            writeVersion('61.0"/><x');
            expect(RecipeCockpitMetadataDeploy.readSourceApiVersion(workspaceRoot)).toBeUndefined();
            writeVersion(61);
            expect(RecipeCockpitMetadataDeploy.readSourceApiVersion(workspaceRoot)).toBeUndefined();
            fs.writeFileSync(projectFilePath, '{ not json');
            expect(RecipeCockpitMetadataDeploy.readSourceApiVersion(workspaceRoot)).toBeUndefined();

        });

        // cmd.exe REFUSES A COMMAND LINE PAST 8,191 CHARACTERS, AND ONE --metadata PER MEMBER PASSED IT AT ABOUT 150 MEMBERS
        it('keeps the command line the same length however many members a tree deploys', () => {

            const manyMembers = Array.from({ length: 2000 }, (unused, memberIndex) => `CustomField:Opportunity.Some_Override_${memberIndex}__c`);
            const manifestFilePath = '/tmp/treecipe-metadata-deploy-x/package.xml';

            expect(readManifestMembers(RecipeCockpitMetadataDeploy.buildPackageXml(manyMembers, '62.0'))).toHaveLength(2000);
            expect(RecipeCockpitMetadataDeploy.buildMetadataDeployArguments(manifestFilePath, QA_USERNAME).join(' ').length).toBeLessThan(200);

        });

        it.each([
            'CustomField:Account.Name',
            'CustomObject:Account',
            'CustomField:Account.A__c --source-dir .',
            'ApexClass:Evil',
            'CustomField:Account..A__c',
            'CustomObject:A__c</members><members>ApexClass:Evil'
        ])('refuses %s as a member before any manifest is written', (member) => {

            expect(() => RecipeCockpitMetadataDeploy.buildPackageXml([member], '62.0')).toThrow();

        });

        it('reads the CLI\'s --json as all or nothing: success, any component failed, malformed, and a CLI that is not installed', () => {

            const invocation = (stdout: string) => ({ stdout: stdout, stderr: '', exitCode: 0 });

            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation(buildDeployAnswer(['Account.A__c', 'Account.B__c'], []))))
                .toEqual({ kind: 'deployed', deployedComponentCount: 2 });
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation(buildDeployAnswer(['Account.A__c'], [{ fullName: 'Account.B__c', problem: 'Value set Regions not found' }]))))
                .toEqual({ kind: 'failed', failureMessage: 'Account.B__c: Value set Regions not found' });
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation(buildDeployAnswer([], [{ fullName: 'Account.A__c', problem: 'p' }, { fullName: 'Account.B__c', problem: 'q' }]))))
                .toEqual({ kind: 'failed', failureMessage: 'Account.A__c: p; Account.B__c: q' });
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation('Deployed! (not json)')).kind).toBe('failed');
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation(JSON.stringify({ status: 0, result: { success: 'yes' } }))).kind).toBe('failed');
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput({ stdout: '', stderr: '', exitCode: null, spawnError: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) }))
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

            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput({ stdout: '', stderr: '', exitCode: null, spawnError: Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }) }))
                .toEqual({ kind: 'failed', failureMessage: 'The Salesforce CLI could not be started: spawn EACCES' });
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput({ stdout: '', stderr: '', exitCode: null, isOutputTooLarge: true }).kind).toBe('unconfirmed');
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput({ stdout: '', stderr: '', exitCode: null, timedOut: true })).toEqual({ kind: 'unconfirmed', failureMessage: expect.stringContaining('whether it applied is unknown') });
            expect(RecipeCockpitMetadataDeploy.isDeployableMember(42)).toBe(false);

        });

        it('keeps a failed deploy\'s Deployment Status page only when its deployUrl is usable on the deploy org\'s host (#283)', () => {

            const invocation = (stdout: string) => ({ stdout: stdout, stderr: '', exitCode: 1 });
            const failedAnswer = buildDeployAnswer(['Account.A__c'], [{ fullName: 'Account.B__c', problem: 'p' }]);
            const parse = (stdout: string, instanceUrl?: string) => RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation(stdout), ScratchOrgService.readCliJsonPayload(invocation(stdout)), instanceUrl);

            expect(parse(withDeployUrl(failedAnswer, buildDeployUrl(QA_INSTANCE_URL)), QA_INSTANCE_URL))
                .toEqual({ kind: 'failed', failureMessage: 'Account.B__c: p', deployStatusPath: DEPLOY_STATUS_PATH });

            [
                buildDeployUrl('https://acme--qa.sandbox.my.salesforce.com.attacker.example'),
                buildDeployUrl('http://acme--qa.sandbox.my.salesforce.com'),
                buildDeployUrl(QA_INSTANCE_URL).replace('DeployStatus', 'SetupOneHome'),
                'not a url',
                42
            ].forEach(deployUrl => expect(parse(withDeployUrl(failedAnswer, deployUrl), QA_INSTANCE_URL))
                .toEqual({ kind: 'failed', failureMessage: 'Account.B__c: p' }));

            expect(parse(withDeployUrl(failedAnswer, buildDeployUrl(QA_INSTANCE_URL)))).toEqual({ kind: 'failed', failureMessage: 'Account.B__c: p' });
            expect(parse(withDeployUrl(buildDeployAnswer(['Account.A__c'], []), buildDeployUrl(QA_INSTANCE_URL)), QA_INSTANCE_URL))
                .toEqual({ kind: 'deployed', deployedComponentCount: 1 });
            // A FAILURE WITH NO COMPONENT FAILURE IS NOT ONE THE PAGE EXPLAINS
            expect(parse(JSON.stringify({ status: 1, name: 'NoAuth', message: 'x', result: { success: false, deployUrl: buildDeployUrl(QA_INSTANCE_URL) } }), QA_INSTANCE_URL))
                .toEqual({ kind: 'failed', failureMessage: 'NoAuth: x' });

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

        const buildDeployablePanelState = (): IRecipeCockpitPanelState => {
            const panelState = RecipeCockpitService.buildInitialPanelState('/workspace');
            panelState.recipeDataMessage = { command: 'recipeData', recipe: { runs: [], selectedRunFolderName: '', objects: [], trees: [], notices: [], emptyStateMessage: '' }, renderSequence: 3 };
            panelState.acknowledgedRenderSequence = 3;
            panelState.dataOrgDetails = [{ targetOrgIdentifier: 'qa', username: QA_USERNAME, alias: 'qa' }];
            panelState.dataOrgSelection = { orgIndex: 0, orgDetail: panelState.dataOrgDetails[0], requestSequence: 7, orgTypeDetail: { isSandbox: true, organizationType: 'Developer Edition' }, isReadinessPosted: true };
            panelState.pendingDeployableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            panelState.deployableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            return panelState;
        };

        const deployMessage = { command: 'deployTreeMetadata', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY };

        it('routes the tree KEY and whether the selection is the org, never anything else from the message', () => {

            const panelState = buildDeployablePanelState();

            expect(RecipeCockpitService.routePanelMessage({ ...deployMessage, members: ['ApexClass:Evil'], username: 'prod@example.com', objectApiName: 'Account' } as any, panelState))
                .toEqual({ kind: 'deployTreeMetadata', treeKey: ACCOUNT_TREE_KEY, isSelectedOrg: true });

        });

        it('routes a deploy with no org index to the host\'s own org prompt, with or without a selection', () => {

            const panelState = buildDeployablePanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeMetadata', treeKey: ACCOUNT_TREE_KEY }, panelState))
                .toEqual({ kind: 'deployTreeMetadata', treeKey: ACCOUNT_TREE_KEY, isSelectedOrg: false });

            panelState.dataOrgSelection = undefined;
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeMetadata', treeKey: ACCOUNT_TREE_KEY, orgIndex: null }, panelState))
                .toEqual({ kind: 'deployTreeMetadata', treeKey: ACCOUNT_TREE_KEY, isSelectedOrg: false });

        });

        it('collects every card with a folder and an object, whatever the org answered', () => {

            const tree = (treeKey: string, folderName: string, objectCount: number) => ({ treeKey, title: treeKey, folderName, fieldCount: 0, objects: Array.from({ length: objectCount }, () => ({ objectApiName: 'Account', parentLookups: [] as any[] })) });

            expect(RecipeCockpitService.collectDeployableTreeKeys({ runs: [], selectedRunFolderName: '', objects: [], notices: [], emptyStateMessage: '', trees: [tree('a', 'a', 1), tree('ungrouped', '', 2), tree('empty', 'empty', 0)] }))
                .toEqual(['a']);

        });

        it.each([
            ['a tree not drawn on screen', { treeKey: LEAD_TREE_KEY }],
            ['a tree key that is not a string', { treeKey: ['x'] }]
        ])('refuses %s, so no process is started', (unusedDescription, override) => {

            const panelState = buildDeployablePanelState();

            expect(RecipeCockpitService.routePanelMessage({ ...deployMessage, ...override } as any, panelState)?.kind).toBe('postMetadataDeployState');

        });

        it('refuses a tree only pending -- posted, not yet drawn -- and a model that is gone', () => {

            const panelState = buildDeployablePanelState();
            panelState.deployableTreeKeys = new Set();
            expect(RecipeCockpitService.routePanelMessage(deployMessage, panelState)?.kind).toBe('postMetadataDeployState');

            const modelGone = buildDeployablePanelState();
            modelGone.recipeDataMessage = undefined;
            expect(RecipeCockpitService.routePanelMessage(deployMessage, modelGone)?.kind).toBe('postMetadataDeployState');

        });

        it.each([
            ['an org index that is not the selection', { orgIndex: 1 }, undefined],
            ['an org index that is not a number', { orgIndex: '0' }, undefined],
            ['an org that answered it is production', {}, { isSandbox: false, organizationType: 'Enterprise Edition' }],
            ['an org that never answered', {}, null]
        ])('refuses %s and says so on the card', (unusedDescription, override, orgTypeDetail) => {

            const panelState = buildDeployablePanelState();
            if ( orgTypeDetail !== undefined ) {
                panelState.dataOrgSelection.orgTypeDetail = orgTypeDetail ?? undefined;
            }

            expect(RecipeCockpitService.routePanelMessage({ ...deployMessage, ...override } as any, panelState)).toEqual({
                kind: 'postMetadataDeployState',
                hostMessage: {
                    command: 'metadataDeployState',
                    isRunning: false,
                    treeKey: ACCOUNT_TREE_KEY,
                    statusText: 'Nothing was deployed: the org selected above has not answered that it is a sandbox. Choose a sandbox or scratch org there.',
                    isFailure: true,
                    hasOutput: false
                }
            });

        });

        // A READINESS FROM DESCRIBES TAKEN BEFORE THE DEPLOY, POSTED AFTER IT, WOULD PUT BACK THE REASONS THE DEPLOY REMOVED
        it('refuses a deploy to the selected org until that selection\'s readiness was posted', () => {

            const panelState = buildDeployablePanelState();
            panelState.dataOrgSelection.isReadinessPosted = undefined;

            expect(RecipeCockpitService.routePanelMessage(deployMessage, panelState)).toEqual({
                kind: 'postMetadataDeployState',
                hostMessage: {
                    command: 'metadataDeployState',
                    isRunning: false,
                    treeKey: ACCOUNT_TREE_KEY,
                    statusText: 'Nothing was deployed: the org selected above is still being checked. Deploy once that check has finished.',
                    isFailure: true,
                    hasOutput: false
                }
            });
            // THE PROMPTED PATH CHECKS NOTHING OF THE SELECTION
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeMetadata', treeKey: ACCOUNT_TREE_KEY }, panelState)?.kind).toBe('deployTreeMetadata');

        });

        it('refuses a second deploy while one runs, and an insert, an org selection, ⟳, a listing or a scratch org meanwhile', () => {

            const panelState = buildDeployablePanelState();
            panelState.metadataDeployStateMessage = { command: 'metadataDeployState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, statusText: 'Deploying 3 components of Account tree…', isFailure: false, hasOutput: false };
            panelState.dataOrgObjectApiNames = new Set(['Account']);
            panelState.insertableTreeKeys = new Set([ACCOUNT_TREE_KEY]);
            panelState.treeHistoryTargets.runFakerRecipeFilePathsByTreeKey.set(ACCOUNT_TREE_KEY, '/workspace/account.yml');

            expect(RecipeCockpitService.routePanelMessage(deployMessage, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeMetadata', treeKey: ACCOUNT_TREE_KEY }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'insertTree', treeKey: ACCOUNT_TREE_KEY }, panelState)?.kind).toBe('postInsertState');
            expect(RecipeCockpitService.routePanelMessage({ command: 'selectDataOrg', orgIndex: 0 }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'refreshDataOrgs' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'loadDataOrgs' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'createScratchOrg' }, panelState)?.kind).toBe('postScratchOrgState');
            expect(RecipeCockpitService.routePanelMessage({ command: 'viewMetadataDeployOutput' }, panelState)).toBeUndefined();

        });

        it('refuses a deploy while a scratch org run or a tree insert holds the selection', () => {

            const panelState = buildDeployablePanelState();

            panelState.scratchOrgStateMessage = { command: 'scratchOrgState', isRunning: true, statusText: 'Creating scratch org…', isFailure: false, hasOutput: false };
            expect(RecipeCockpitService.routePanelMessage(deployMessage, panelState)?.kind).toBe('postMetadataDeployState');

            panelState.scratchOrgStateMessage = undefined;
            panelState.insertStateMessage = { command: 'insertState', isRunning: true, treeKey: ACCOUNT_TREE_KEY };
            expect(RecipeCockpitService.routePanelMessage(deployMessage, panelState)?.kind).toBe('postMetadataDeployState');

            panelState.insertStateMessage = undefined;
            expect(RecipeCockpitService.routePanelMessage(deployMessage, panelState)?.kind).toBe('deployTreeMetadata');

        });

        it('no longer routes the per-object deploy or its readiness acknowledgement', () => {

            const panelState = buildDeployablePanelState();

            expect(RecipeCockpitService.routePanelMessage({ command: 'deployMissingMetadata', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY, objectApiName: 'Account' }, panelState)).toBeUndefined();
            expect(RecipeCockpitService.routePanelMessage({ command: 'readinessRendered', renderSequence: 3, requestSequence: 7 }, panelState)).toBeUndefined();

        });

        it('opens a failed deploy\'s Deployment Status page only for the card its line is drawn on, and never while a deploy runs (#283)', () => {

            const panelState = buildDeployablePanelState();
            const deployStatusTarget = { treeKey: ACCOUNT_TREE_KEY, orgDetail: panelState.dataOrgDetails[0], deployStatusPath: DEPLOY_STATUS_PATH };
            const failedState = { command: 'metadataDeployState' as const, isRunning: false, treeKey: ACCOUNT_TREE_KEY, statusText: 'failed', isFailure: true, hasOutput: true, hasDeployStatus: true };
            const openMessage = { command: 'openMetadataDeployStatus', treeKey: ACCOUNT_TREE_KEY };

            expect(RecipeCockpitService.routePanelMessage(openMessage, panelState)).toBeUndefined();

            panelState.metadataDeployStatusTarget = deployStatusTarget;
            expect(RecipeCockpitService.routePanelMessage(openMessage, panelState)).toBeUndefined();

            panelState.metadataDeployStateMessage = failedState;

            expect(RecipeCockpitService.routePanelMessage({ ...openMessage, deployUrl: 'https://evil.example/', username: 'prod@example.com', path: '/x' } as any, panelState))
                .toEqual({ kind: 'openMetadataDeployStatus', deployStatusTarget: deployStatusTarget });

            [
                { command: 'openMetadataDeployStatus', treeKey: LEAD_TREE_KEY },
                { command: 'openMetadataDeployStatus' },
                { command: 'openMetadataDeployStatus', treeKey: 7 }
            ].forEach(panelMessage => expect(RecipeCockpitService.routePanelMessage(panelMessage as any, panelState)).toBeUndefined());

            panelState.metadataDeployStateMessage = { ...failedState, isRunning: true, statusText: 'Deploying…' };
            expect(RecipeCockpitService.routePanelMessage(openMessage, panelState)).toBeUndefined();

            panelState.metadataDeployStateMessage = { ...failedState, treeKey: LEAD_TREE_KEY };
            expect(RecipeCockpitService.routePanelMessage(openMessage, panelState)).toBeUndefined();

            panelState.metadataDeployStateMessage = { ...failedState, hasDeployStatus: false };
            expect(RecipeCockpitService.routePanelMessage(openMessage, panelState)).toBeUndefined();

            panelState.metadataDeployStateMessage = failedState;
            panelState.metadataDeployStatusTarget = undefined;
            expect(RecipeCockpitService.routePanelMessage(openMessage, panelState)).toBeUndefined();

            panelState.metadataDeployStatusTarget = deployStatusTarget;
            expect(JSON.stringify(RecipeCockpitService.buildReplayMessages(panelState))).not.toContain(DEPLOY_ID);

        });

        it('opens only the result file the host holds, and replays the deploy\'s line to a reloaded document', () => {

            const panelState = buildDeployablePanelState();
            const endedState = { command: 'metadataDeployState' as const, isRunning: false, treeKey: ACCOUNT_TREE_KEY, statusText: 'done', isFailure: false, hasOutput: true };
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
        let workspaceState: { get: jest.Mock; update: jest.Mock };
        let deployedManifests: string[];

        const lastRenderSequence = () => [...postedPanelMessages].reverse().find(hostMessage => hostMessage.command === 'recipeData')?.renderSequence;
        const postedNamed = (command: string) => postedPanelMessages.filter(hostMessage => hostMessage.command === command);
        const deployCalls = () => cliCalls.filter(argumentList => argumentList[0] === 'project');
        const lastDeployState = () => postedNamed('metadataDeployState').at(-1);
        const flushAsyncWork = () => new Promise(resolve => setImmediate(resolve));
        const panelState = (): IRecipeCockpitPanelState => (RecipeCockpitService as any).recipeCockpitPanelState;

        const treeReadiness = (treeKey: string, objectApiName: string) => [...postedNamed('dataOrgReadiness')].reverse()
            .flatMap(readinessMessage => readinessMessage.createTargets)
            .find((readiness: any) => readiness.treeKey === treeKey && readiness.objectApiName === objectApiName);

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

        // null SENDS NO ORG INDEX, AS THE PANEL DOES WITH NO ORG CHOSEN ABOVE
        const deploy = async (treeKey: string, orgIndex: number | null = 0) => {
            await receivedMessageHandler({ command: 'deployTreeMetadata', treeKey: treeKey, ...( orgIndex === null ? {} : { orgIndex: orgIndex } ) });
            await flushAsyncWork();
        };

        const modalCalls = () => (vscode.window.showWarningMessage as jest.Mock).mock.calls.filter(([, options]) => options?.modal);

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
            workspaceState = { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) };
            deployedManifests = [];
            deployHandler = () => {
                const members = readManifestMembers(deployedManifests.at(-1));
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
                const manifestFilePath = argumentList[argumentList.indexOf('--manifest') + 1];
                if ( argumentList[0] === 'project' ) {
                    deployedManifests.push(fs.readFileSync(manifestFilePath, 'utf-8'));
                }
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
                instanceUrl: QA_INSTANCE_URL,
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

        it('deploys the whole tree from local source -- whatever its readiness says -- names the org and every file in a modal, and makes the deployed objects ready from the CLI\'s answer without describing anything again (#270, #273)', async () => {

            await openCockpitWithQaSelected();
            const readinessPostsBefore = postedNamed('dataOrgReadiness').length;
            const clearSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');
            let connectionsWhenCliRan = -1;
            const landingDeploy = deployHandler;
            deployHandler = (argumentList: string[]) => {
                connectionsWhenCliRan = (SalesforceOrgService.getConnection as jest.Mock).mock.calls.length;
                return landingDeploy(argumentList);
            };

            await deploy(ACCOUNT_TREE_KEY);

            const [modalMessage, modalOptions, modalAction] = modalCalls()[0];
            expect(modalMessage).toBe(`Deploy 3 components of Relationship Tree 1 to qa · ${QA_USERNAME}?`);
            expect(modalOptions.detail).toContain(`Org: qa · ${QA_USERNAME}`);
            expect(modalOptions.detail).toContain(`To deploy (3):\n  ${ACCOUNT_TREE_MEMBERS.join('\n  ')}`);
            expect(modalOptions.detail).toContain('Source files sent (5):');
            expect(modalOptions.detail).toContain('  OtherChildObject__c/fields/Score__c.field-meta.xml');
            // User IS A LOOKUP TARGET WITH NO RECIPE, SO THE CARD DOES NOT LIST IT AND IT IS NOT PLANNED
            expect(modalOptions.detail).toContain('Skipped (1):\n  Contact — a standard object with no custom field (__c) in local source');
            expect(modalOptions.detail).not.toContain('User');
            expect(modalAction).toBe(RECIPE_COCKPIT_METADATA_DEPLOY_CONFIRM_LABEL);

            expect(deployCalls()).toHaveLength(1);
            const [, , , , manifestFilePath, ...restOfArguments] = deployCalls()[0];
            expect(deployCalls()[0].slice(0, 4)).toEqual(['project', 'deploy', 'start', '--manifest']);
            expect(restOfArguments).toEqual(['--target-org', QA_USERNAME, '--json']);
            expect(readManifestMembers(deployedManifests[0])).toEqual(ACCOUNT_TREE_MANIFEST_MEMBERS);
            // THE MANIFEST IS WRITTEN OUTSIDE THE WORKSPACE AND REMOVED ONCE THE DEPLOY ENDS
            expect(path.resolve(manifestFilePath).startsWith(path.resolve(workspaceRoot))).toBe(false);
            expect(fs.existsSync(path.dirname(manifestFilePath))).toBe(false);
            const deployExecOptions = (execFile as unknown as jest.Mock).mock.calls.find(([, argumentList]) => argumentList[0] === 'project')[2];
            expect(deployExecOptions.cwd).toBe(path.resolve(workspaceRoot));

            expect(postedNamed('metadataDeployState').map(deployState => deployState.statusText)).toContain('Deploying 3 components of Relationship Tree 1…');
            expect(lastDeployState()).toEqual({
                command: 'metadataDeployState',
                isRunning: false,
                treeKey: ACCOUNT_TREE_KEY,
                statusText: `Deployed 3 components of Relationship Tree 1 to qa · ${QA_USERNAME}.`,
                isFailure: false,
                hasOutput: true
            });
            expect(notificationInformationSpy).toHaveBeenCalledWith(`Deployed 3 components of Relationship Tree 1 to qa · ${QA_USERNAME}.`);
            expect(JSON.stringify(postedNamed('metadataDeployState'))).not.toContain(workspaceRoot);

            // THE CLI'S ANSWER IS THE RESULT: NO DESCRIBE AND NO CONNECTION ONCE IT RETURNED
            expect(connectionsWhenCliRan).toBeGreaterThan(0);
            expect((SalesforceOrgService.getConnection as jest.Mock).mock.calls.length).toBe(connectionsWhenCliRan);
            expect(describeCalls.filter(objectApiName => objectApiName === 'OtherChildObject__c')).toHaveLength(1);
            expect(clearSpy).toHaveBeenCalledWith(QA_USERNAME, 'Account');
            expect(clearSpy).toHaveBeenCalledWith(QA_USERNAME, 'OtherChildObject__c');
            expect(clearSpy).not.toHaveBeenCalledWith(QA_USERNAME, 'Contact');

            expect(postedNamed('dataOrgReadiness')).toHaveLength(readinessPostsBefore + 1);
            expect(postedNamed('dataOrgReadiness').at(-1).objects).toEqual([
                { objectApiName: 'Account', disabledReason: '', requiredLookups: [] },
                { objectApiName: 'OtherChildObject__c', disabledReason: '', requiredLookups: [] }
            ]);
            ['Account', 'Contact', 'OtherChildObject__c'].forEach(objectApiName => expect(treeReadiness(ACCOUNT_TREE_KEY, objectApiName)).toMatchObject({ disabledReason: '' }));
            // THE BUTTONS COME BACK ONLY AFTER THE READINESS THE DEPLOY CHANGED HAS BEEN POSTED
            expect(postedPanelMessages.indexOf(lastDeployState())).toBeGreaterThan(postedPanelMessages.indexOf(postedNamed('dataOrgReadiness').at(-1)));

            const operationsFolderPath = path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, QA_USERNAME);
            expect(fs.readdirSync(operationsFolderPath).filter(fileName => /-metadata-deploy(-\d+)?\.json$/.test(fileName))).toHaveLength(1);

            // OFFERED AGAIN AT ONCE: THE BUTTON NEVER DEPENDED ON THE READINESS
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeMetadata', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY }, panelState())?.kind).toBe('deployTreeMetadata');

        });

        it('is offered for a tree the org is already ready for, and deploys a second custom object of the tree with its whole folder', async () => {

            orgDescribes.OtherChildObject__c = { name: 'OtherChildObject__c', createable: true, fields: [] };
            await openCockpitWithQaSelected();
            expect(treeReadiness(ACCOUNT_TREE_KEY, 'OtherChildObject__c')).toMatchObject({ disabledReason: '' });
            panelState().recipeDataMessage.recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY).objects.push({ objectApiName: 'Gadget__c', parentLookups: [] });

            await deploy(ACCOUNT_TREE_KEY);

            expect(modalCalls()[0][0]).toBe(`Deploy 4 components of Relationship Tree 1 to qa · ${QA_USERNAME}?`);
            expect(modalCalls()[0][1].detail).toContain('  Gadget__c/validationRules/Serial_Required.validationRule-meta.xml');
            expect(readManifestMembers(deployedManifests[0])).toEqual(expect.arrayContaining(['CustomObject:OtherChildObject__c', 'CustomObject:Gadget__c']));
            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: false });

        });

        it('says "1 component" for a deploy of one member', async () => {

            fs.rmSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account'), { recursive: true });
            await openCockpitWithQaSelected();

            await deploy(ACCOUNT_TREE_KEY);

            expect(modalCalls()[0][0]).toBe(`Deploy 1 component of Relationship Tree 1 to qa · ${QA_USERNAME}?`);
            expect(postedNamed('metadataDeployState').map(deployState => deployState.statusText)).toContain('Deploying 1 component of Relationship Tree 1…');
            expect(notificationInformationSpy).toHaveBeenCalledWith(expect.stringContaining('Deployed 1 component of Relationship Tree 1'));

        });

        it('names the tree by the reader\'s own name for it', async () => {

            await openCockpitWithQaSelected();
            panelState().recipeDataMessage.recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY).customName = 'Accounts and children';

            await deploy(ACCOUNT_TREE_KEY);

            expect(modalCalls()[0][0]).toBe(`Deploy 3 components of Accounts and children to qa · ${QA_USERNAME}?`);
            expect(modalCalls()[0][1].detail).toContain('Tree: Accounts and children');

        });

        it('with no org selected, asks for one from the Treecipe tab\'s non-production list, deploys to it and makes it the selection', async () => {

            await openCockpit();
            const listedOrgs = await SalesforceOrgService.listDataOrgDetails();
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockImplementation(async (orgListing: Promise<any>) => {
                const listing = await orgListing;
                expect(listing.orgDetails).toEqual(listedOrgs.orgDetails);
                expect(postedNamed('metadataDeployState').at(-1)).toMatchObject({ isRunning: true, statusText: 'Choose the sandbox or scratch org to deploy to…' });
                return listing.orgDetails.find((orgDetail: any) => orgDetail.username === QA_USERNAME);
            });

            await deploy(ACCOUNT_TREE_KEY, null);
            await flushAsyncWork();

            expect(promptSpy).toHaveBeenCalledTimes(1);
            expect(promptSpy.mock.calls[0][1]).toBe('Choose the sandbox or scratch org to deploy this tree\'s metadata to');
            expect(deployCalls()).toHaveLength(1);
            expect(deployCalls()[0]).toEqual(expect.arrayContaining(['--target-org', QA_USERNAME]));
            expect(workspaceState.update).toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, QA_USERNAME);
            expect(postedNamed('dataOrgList').at(-1).selectedOrgIndex).toBe(listedOrgs.orgDetails.findIndex(orgDetail => orgDetail.username === QA_USERNAME));
            expect(panelState().dataOrgSelection?.orgDetail.username).toBe(QA_USERNAME);
            // THE SELECTION DESCRIBES THE TREE AFRESH, SO ITS READINESS IS WHAT THE ORG HAS AFTER THE DEPLOY
            expect(treeReadiness(ACCOUNT_TREE_KEY, 'OtherChildObject__c')).toMatchObject({ disabledReason: '' });
            expect(postedPanelMessages.indexOf(lastDeployState())).toBeGreaterThan(postedPanelMessages.indexOf(postedNamed('dataOrgList').at(-1)));
            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: false });

        });

        it('runs nothing and selects nothing when the reader dismisses the org prompt, or cancels the confirmation after it', async () => {

            await openCockpit();
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockResolvedValueOnce(undefined);

            await deploy(ACCOUNT_TREE_KEY, null);

            expect(modalCalls()).toEqual([]);
            expect(deployCalls()).toEqual([]);
            expect(lastDeployState()).toMatchObject({ isRunning: false, statusText: '', isFailure: false });

            promptSpy.mockResolvedValueOnce({ targetOrgIdentifier: 'qa', username: QA_USERNAME, alias: 'qa' });
            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);

            await deploy(ACCOUNT_TREE_KEY, null);

            expect(modalCalls()).toHaveLength(1);
            expect(deployCalls()).toEqual([]);
            expect(workspaceState.update).not.toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, expect.anything());
            expect(postedNamed('dataOrgList')).toEqual([]);

        });

        it('says so and runs nothing when the org list cannot be read for the prompt', async () => {

            await openCockpit();
            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockRejectedValueOnce(new Error('The Salesforce CLI could not report which authorized orgs are connected.'));

            await deploy(ACCOUNT_TREE_KEY, null);

            expect(deployCalls()).toEqual([]);
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining('Nothing was deployed: The Salesforce CLI could not report'));
            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: true });

        });

        it('refuses before the org prompt or the confirmation when the workspace has no sfdx-project.json', async () => {

            fs.rmSync(path.join(workspaceRoot, 'sfdx-project.json'));
            await openCockpit();
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed');

            await deploy(ACCOUNT_TREE_KEY, null);

            expect(promptSpy).not.toHaveBeenCalled();
            expect(modalCalls()).toEqual([]);
            expect(deployCalls()).toEqual([]);
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining('Nothing was deployed: No "sfdx-project.json" found'));

        });

        it('says why and runs nothing when the tree has nothing in local source to deploy', async () => {

            await openCockpitWithQaSelected();

            await deploy(LEAD_TREE_KEY);

            expect(modalCalls()).toEqual([]);
            expect(deployCalls()).toEqual([]);
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining('Nothing of the tree Relationship Tree 2 can be deployed: Lead is a standard object with no custom field'));
            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: true, treeKey: LEAD_TREE_KEY });

        });

        it('holds the deploy in flight until the readiness its answer changed is posted, and never refreshes the trees', async () => {

            await openCockpitWithQaSelected();
            let releasePost: () => void = () => undefined;
            const postHeld = new Promise<void>(resolve => { releasePost = resolve; });
            const refreshSpy = jest.spyOn(RecipeCockpitService as any, 'refreshDataOrgReadinessForTrees');
            const postSpy = jest.spyOn(RecipeCockpitService as any, 'postDeployedObjectReadiness').mockImplementationOnce(async () => { await postHeld; });

            const deployInFlight = deploy(ACCOUNT_TREE_KEY);
            for ( let turn = 0; turn < 6; turn++ ) {
                await flushAsyncWork();
            }

            expect(postSpy).toHaveBeenCalledTimes(1);
            expect(postSpy.mock.calls[0][2]).toEqual(['Account', 'OtherChildObject__c']);
            expect(lastDeployState()).toMatchObject({ isRunning: true });
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeMetadata', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY }, panelState())).toBeUndefined();

            releasePost();
            await deployInFlight;

            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: false });
            expect(refreshSpy).not.toHaveBeenCalled();
            expect(deployCalls()).toHaveLength(1);

        });

        it('marks nothing ready when the reader chose another org while the deploy ran', async () => {

            await openCockpitWithQaSelected();
            let answerDeploy: (stdout: string) => void = () => undefined;
            jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli').mockImplementation(() => new Promise(resolve => {
                answerDeploy = (stdout: string) => resolve({ stdout: stdout, stderr: '', exitCode: 0 });
            }));

            const deployInFlight = deploy(ACCOUNT_TREE_KEY);
            await flushAsyncWork();
            await flushAsyncWork();

            // A NEW SELECTION, EVEN OF THE SAME ORG, IS NOT THE ONE THE DEPLOY STARTED UNDER
            const startedSelection = panelState().dataOrgSelection;
            panelState().dataOrgSelection = { ...startedSelection, requestSequence: startedSelection.requestSequence + 1 };
            panelState().dataOrgRequestSequence = startedSelection.requestSequence + 1;
            const readinessPostsBefore = postedNamed('dataOrgReadiness').length;

            answerDeploy(buildDeployAnswer(['Account.Legacy_Code__c', 'Account.Rating__c', 'OtherChildObject__c'], []));
            await deployInFlight;
            await flushAsyncWork();

            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: false });
            expect(postedNamed('dataOrgReadiness')).toHaveLength(readinessPostsBefore);

        });

        it('still describes a deployed object afresh when the insert is clicked, and refuses on a reason only that describe can give', async () => {

            jest.spyOn(ConfigurationService, 'getSelectedDataFakerServiceConfig').mockImplementation(() => 'snowfakery');
            await openCockpitWithQaSelected();

            await deploy(ACCOUNT_TREE_KEY);
            expect(treeReadiness(ACCOUNT_TREE_KEY, 'OtherChildObject__c')).toMatchObject({ disabledReason: '' });

            // THE DEPLOYED OBJECT TURNS OUT NOT TO BE CREATEABLE: ONLY A DESCRIBE CAN SAY SO
            orgDescribes.OtherChildObject__c.createable = false;
            (vscode.window.showWarningMessage as jest.Mock).mockClear();

            await receivedMessageHandler({ command: 'insertTree', treeKey: ACCOUNT_TREE_KEY });
            await flushAsyncWork();

            expect(describeCalls.filter(objectApiName => objectApiName === 'OtherChildObject__c')).toHaveLength(2);
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining('OtherChildObject__c is not createable in this org.'));
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
            expect(vscode.commands.executeCommand).not.toHaveBeenCalled();

        });

        it('tells every card that lists a deployed object, from one deploy, and keeps a card\'s reason about its own unreadable recipe', async () => {

            await openCockpitWithQaSelected();
            const deployedState = panelState();
            // A SECOND CARD LISTING THE OBJECTS WHOSE RECIPE FOLDER IS NOT ON DISK
            const otherTreeKey = 'Other-tree';
            const accountTree = deployedState.recipeDataMessage.recipe.trees.find(tree => tree.treeKey === ACCOUNT_TREE_KEY);
            deployedState.recipeDataMessage.recipe.trees.push({ ...accountTree, treeKey: otherTreeKey, folderName: 'Gone-folder' });

            await deploy(ACCOUNT_TREE_KEY);

            const deployedTreeKeys = postedNamed('dataOrgReadiness').at(-1).createTargets
                .filter((readiness: any) => readiness.objectApiName === 'OtherChildObject__c')
                .map((readiness: any) => readiness.treeKey);
            expect(deployedTreeKeys.sort()).toEqual([ACCOUNT_TREE_KEY, otherTreeKey].sort());
            expect(treeReadiness(ACCOUNT_TREE_KEY, 'OtherChildObject__c')).toMatchObject({ disabledReason: '' });
            expect(treeReadiness(otherTreeKey, 'OtherChildObject__c').disabledReason).toContain('could not be read');

        });

        it('drops the cached describes but marks nothing ready when something throws after the CLI started', async () => {

            jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
            jest.spyOn(ScratchOrgService, 'readCliJsonPayload').mockImplementation(() => { throw new Error('parse exploded'); });
            await openCockpitWithQaSelected();
            const clearSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');
            const readinessPostsBefore = postedNamed('dataOrgReadiness').length;

            await deploy(ACCOUNT_TREE_KEY);

            expect(deployCalls()).toHaveLength(1);
            expect(clearSpy).toHaveBeenCalledWith(QA_USERNAME, 'OtherChildObject__c');
            expect(clearSpy).toHaveBeenCalledWith(QA_USERNAME, 'Account');
            expect(postedNamed('dataOrgReadiness')).toHaveLength(readinessPostsBefore);
            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: true, statusText: 'The deploy of Relationship Tree 1 stopped: parse exploded' });

        });

        it('runs nothing when the reader cancels the confirmation', async () => {

            (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined);
            await openCockpitWithQaSelected();
            const clearSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');

            await deploy(ACCOUNT_TREE_KEY);

            expect(modalCalls()).toHaveLength(1);
            expect(deployCalls()).toEqual([]);
            expect(clearSpy).not.toHaveBeenCalled();
            expect(lastDeployState()).toMatchObject({ isRunning: false, statusText: '' });

        });

        it('asks the Organization row again after the confirmation, and deploys nothing to an org that does not answer it is a sandbox', async () => {

            await openCockpitWithQaSelected();
            organizationAnswers.push({ IsSandbox: false, OrganizationType: 'Enterprise Edition' });

            await deploy(ACCOUNT_TREE_KEY);

            expect(deployCalls()).toEqual([]);
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining('Metadata is deployed only to a sandbox or scratch org.'));
            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: true });

        });

        it('asks a PROMPTED org the Organization row too, and neither deploys to nor selects one that answers it is production', async () => {

            await openCockpit();
            jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed').mockResolvedValueOnce({ targetOrgIdentifier: 'qa', username: QA_USERNAME, alias: 'qa' });
            organizationAnswers.push({ IsSandbox: false, OrganizationType: 'Enterprise Edition' });

            await deploy(ACCOUNT_TREE_KEY, null);

            expect(deployCalls()).toEqual([]);
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining('Metadata is deployed only to a sandbox or scratch org.'));
            expect(postedNamed('dataOrgList')).toEqual([]);
            expect(workspaceState.update).not.toHaveBeenCalledWith(RECIPE_COCKPIT_DATA_ORG_STATE_KEY, expect.anything());

        });

        it('runs nothing for a forged deploy before the model was drawn, for a tree not on screen, or for an org index that is not selected', async () => {

            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed');

            await deploy(ACCOUNT_TREE_KEY, null);

            await receivedMessageHandler({ command: 'rendered', renderSequence: lastRenderSequence() });
            await receivedMessageHandler({ command: 'loadDataOrgs' });
            await flushAsyncWork();
            await receivedMessageHandler({ command: 'selectDataOrg', orgIndex: 0 });
            await flushAsyncWork();

            await deploy('Not-a-tree');
            await deploy(ACCOUNT_TREE_KEY, 1);

            expect(promptSpy).not.toHaveBeenCalled();
            expect(modalCalls()).toEqual([]);
            expect(deployCalls()).toEqual([]);
            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: true, statusText: expect.stringContaining('has not answered that it is a sandbox') });

        });

        it('reads any component failure as the whole deploy failing -- an error with View output -- and leaves the readiness as it was (#270)', async () => {

            deployHandler = () => ({ stdout: buildDeployAnswer(['OtherChildObject__c'], [{ fullName: 'Account.Rating__c', problem: 'Value set Ratings not found' }]), error: Object.assign(new Error('exit 1'), { code: 1 }) });
            (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL);
            await openCockpitWithQaSelected();
            const readinessPostsBefore = postedNamed('dataOrgReadiness').length;

            await deploy(ACCOUNT_TREE_KEY);
            await flushAsyncWork();

            const [errorText, errorAction] = (vscode.window.showErrorMessage as jest.Mock).mock.calls[0];
            expect(errorText).toBe(`The deploy of Relationship Tree 1 to qa · ${QA_USERNAME} failed: Account.Rating__c: Value set Ratings not found`);
            expect(errorAction).toBe(RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL);

            const operationsFolderPath = path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, QA_USERNAME);
            const resultFilePath = path.join(operationsFolderPath, fs.readdirSync(operationsFolderPath).find(fileName => fileName.endsWith('-metadata-deploy.json')));
            expect(openFileSpy).toHaveBeenCalledWith(resultFilePath);
            expect(postedNamed('dataOrgReadiness')).toHaveLength(readinessPostsBefore);
            expect(treeReadiness(ACCOUNT_TREE_KEY, 'OtherChildObject__c').disabledReason).toContain('OtherChildObject__c is not in this org');
            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: true, hasOutput: true });
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeMetadata', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY }, panelState())?.kind).toBe('deployTreeMetadata');

            openFileSpy.mockClear();
            await receivedMessageHandler({ command: 'viewMetadataDeployOutput', filePath: '/etc/passwd' });
            expect(openFileSpy).toHaveBeenCalledWith(resultFilePath);

        });

        describe('"Open Deployment Status" on a failed deploy (#283)', () => {

            let orgOpenAnswer: { stdout: string; error?: unknown };

            const orgOpenCalls = () => cliCalls.filter(argumentList => argumentList[0] === 'org' && argumentList[1] === 'open');

            const everythingWritten = (): string => {
                const collectFiles = (directoryPath: string): string[] => fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap(directoryEntry => (
                    directoryEntry.isDirectory()
                        ? collectFiles(path.join(directoryPath, directoryEntry.name))
                        : [path.join(directoryPath, directoryEntry.name)]
                ));
                return collectFiles(temporaryRoot).map(filePath => fs.readFileSync(filePath, 'utf-8')).join('\n');
            };

            const failWithDeployUrl = (deployUrl: unknown) => {
                deployHandler = argumentList => argumentList[0] === 'org' && argumentList[1] === 'open'
                    ? orgOpenAnswer
                    : { stdout: withDeployUrl(buildDeployAnswer(['OtherChildObject__c'], [{ fullName: 'Account.Rating__c', problem: 'Value set Ratings not found' }]), deployUrl), error: Object.assign(new Error('exit 1'), { code: 1 }) };
            };

            beforeEach(() => {
                orgOpenAnswer = { stdout: JSON.stringify({ status: 0, result: { orgId: '00D000000000001', url: FRONTDOOR_URL, username: QA_USERNAME } }) };
                (vscode.env.openExternal as jest.Mock).mockReset();
                (vscode.env.openExternal as jest.Mock).mockResolvedValue(true);
                (RecipeCockpitService as any).isDeployStatusOpenInFlight = false;
            });

            it('offers it beside View output, opens the deploy org\'s page signed in through "sf org open --path", and posts, writes and quotes no session', async () => {

                failWithDeployUrl(buildDeployUrl(QA_INSTANCE_URL));
                await openCockpitWithQaSelected();

                await deploy(ACCOUNT_TREE_KEY);
                await flushAsyncWork();

                const [errorText, ...errorActions] = (vscode.window.showErrorMessage as jest.Mock).mock.calls[0];
                expect(errorText).toBe(`The deploy of Relationship Tree 1 to qa · ${QA_USERNAME} failed: Account.Rating__c: Value set Ratings not found`);
                expect(errorActions).toEqual([RECIPE_COCKPIT_METADATA_DEPLOY_OPEN_STATUS_LABEL, RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL]);
                expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, statusText: errorText, isFailure: true, hasOutput: true, hasDeployStatus: true });

                await receivedMessageHandler({ command: 'openMetadataDeployStatus', treeKey: ACCOUNT_TREE_KEY, path: '/secur/logout.jsp' });
                await flushAsyncWork();

                expect(orgOpenCalls()).toEqual([['org', 'open', '--target-org', QA_USERNAME, '--path', DEPLOY_STATUS_PATH, '--url-only', '--json']]);
                const orgOpenCall = (execFile as unknown as jest.Mock).mock.calls.find(([, argumentList]) => argumentList[0] === 'org' && argumentList[1] === 'open');
                expect(orgOpenCall[2].cwd).toBeUndefined();
                expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
                expect((vscode.env.openExternal as jest.Mock).mock.calls[0][0].toString()).toBe(FRONTDOOR_URL);
                expect(notificationWarningSpy).not.toHaveBeenCalled();

                expect(JSON.stringify(postedPanelMessages)).not.toContain(SESSION_ID);
                expect(JSON.stringify(postedPanelMessages)).not.toContain(DEPLOY_ID);
                expect(everythingWritten()).not.toContain('deployStatusSecret');

            });

            it('opens the same page from the error notification\'s button', async () => {

                failWithDeployUrl(buildDeployUrl(QA_INSTANCE_URL));
                let chooseOpenStatus: (label: string) => void = () => undefined;
                (vscode.window.showErrorMessage as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { chooseOpenStatus = resolve; }));
                await openCockpitWithQaSelected();

                await deploy(ACCOUNT_TREE_KEY);
                await flushAsyncWork();
                expect(lastDeployState()).toMatchObject({ isRunning: false, hasDeployStatus: true });

                // THE READER CLICKS ONCE THE DEPLOY HAS ENDED
                chooseOpenStatus(RECIPE_COCKPIT_METADATA_DEPLOY_OPEN_STATUS_LABEL);
                await flushAsyncWork();
                await flushAsyncWork();

                expect(orgOpenCalls()).toEqual([['org', 'open', '--target-org', QA_USERNAME, '--path', DEPLOY_STATUS_PATH, '--url-only', '--json']]);
                expect((vscode.env.openExternal as jest.Mock).mock.calls[0][0].toString()).toBe(FRONTDOOR_URL);
                expect(openFileSpy).not.toHaveBeenCalled();

            });

            it('offers nothing for a deployUrl on another host, over http:, on another page or malformed', async () => {

                for ( const deployUrl of [
                    buildDeployUrl('https://acme--qa.sandbox.my.salesforce.com.attacker.example'),
                    buildDeployUrl('http://acme--qa.sandbox.my.salesforce.com'),
                    buildDeployUrl(QA_INSTANCE_URL).replace('/lightning/setup/DeployStatus/page', '/secur/logout.jsp'),
                    'https://[not a url'
                ] ) {

                    (vscode.window.showErrorMessage as jest.Mock).mockClear();
                    failWithDeployUrl(deployUrl);
                    await openCockpitWithQaSelected();

                    await deploy(ACCOUNT_TREE_KEY);
                    await flushAsyncWork();

                    expect((vscode.window.showErrorMessage as jest.Mock).mock.calls[0].slice(1)).toEqual([RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL]);
                    expect(lastDeployState()).not.toHaveProperty('hasDeployStatus');
                    expect(panelState().metadataDeployStatusTarget).toBeUndefined();

                    await receivedMessageHandler({ command: 'openMetadataDeployStatus', treeKey: ACCOUNT_TREE_KEY });
                    await flushAsyncWork();
                    expect(orgOpenCalls()).toEqual([]);

                }

            });

            it('offers nothing for a successful deploy, a CLI that is not installed or a deploy that timed out', async () => {

                await openCockpitWithQaSelected();
                await deploy(ACCOUNT_TREE_KEY);
                await flushAsyncWork();
                expect(lastDeployState()).toMatchObject({ isFailure: false });
                expect(lastDeployState()).not.toHaveProperty('hasDeployStatus');

                deployHandler = () => ({ stdout: '', error: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) });
                await deploy(ACCOUNT_TREE_KEY);
                await flushAsyncWork();
                expect(lastDeployState()).toMatchObject({ isFailure: true });
                expect(lastDeployState()).not.toHaveProperty('hasDeployStatus');

                jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli').mockResolvedValueOnce({ stdout: withDeployUrl(buildDeployAnswer([], [{ fullName: 'Account.Rating__c', problem: 'x' }]), buildDeployUrl(QA_INSTANCE_URL)), stderr: '', exitCode: null, timedOut: true });
                await deploy(ACCOUNT_TREE_KEY);
                await flushAsyncWork();
                expect(lastDeployState()).toMatchObject({ isFailure: true });
                expect(lastDeployState().statusText).toContain('whether it applied is unknown');
                expect(lastDeployState()).not.toHaveProperty('hasDeployStatus');

                (vscode.window.showErrorMessage as jest.Mock).mock.calls.concat((vscode.window.showWarningMessage as jest.Mock).mock.calls)
                    .forEach(notificationCall => expect(notificationCall).not.toContain(RECIPE_COCKPIT_METADATA_DEPLOY_OPEN_STATUS_LABEL));

            });

            it('warns with a fixed message, quoting neither the CLI nor any address, when "sf org open" fails or times out', async () => {

                failWithDeployUrl(buildDeployUrl(QA_INSTANCE_URL));
                await openCockpitWithQaSelected();
                await deploy(ACCOUNT_TREE_KEY);
                await flushAsyncWork();

                const fixedWarning = RecipeYamlScalarEscape(`The Deployment Status page of qa · ${QA_USERNAME} could not be opened. Find the deploy in Setup, under Deployment Status.`);

                orgOpenAnswer = { stdout: JSON.stringify({ status: 1, name: 'SessionError', message: `Opening ${FRONTDOOR_URL} failed` }), error: Object.assign(new Error('exit 1'), { code: 1 }) };
                await receivedMessageHandler({ command: 'openMetadataDeployStatus', treeKey: ACCOUNT_TREE_KEY });
                await flushAsyncWork();

                expect(notificationWarningSpy).toHaveBeenLastCalledWith(fixedWarning);

                jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli').mockResolvedValueOnce({ stdout: '', stderr: `stuck on ${FRONTDOOR_URL}`, exitCode: null, timedOut: true });
                await receivedMessageHandler({ command: 'openMetadataDeployStatus', treeKey: ACCOUNT_TREE_KEY });
                await flushAsyncWork();

                expect(notificationWarningSpy).toHaveBeenLastCalledWith(fixedWarning);

                jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli').mockRejectedValueOnce(new Error(`boom ${FRONTDOOR_URL}`));
                await receivedMessageHandler({ command: 'openMetadataDeployStatus', treeKey: ACCOUNT_TREE_KEY });
                await flushAsyncWork();

                expect(notificationWarningSpy).toHaveBeenLastCalledWith(fixedWarning);
                expect(vscode.env.openExternal).not.toHaveBeenCalled();
                expect(JSON.stringify(notificationWarningSpy.mock.calls)).not.toContain(SESSION_ID);
                expect(JSON.stringify(postedPanelMessages)).not.toContain(SESSION_ID);

            });

            it('warns and opens nothing when the deploy org is no longer authorized', async () => {

                failWithDeployUrl(buildDeployUrl(QA_INSTANCE_URL));
                await openCockpitWithQaSelected();
                await deploy(ACCOUNT_TREE_KEY);
                await flushAsyncWork();

                (AuthInfo.listAllAuthorizations as jest.Mock).mockImplementation(async () => ORG_AUTHORIZATIONS.filter((authorization: any) => authorization.username !== QA_USERNAME));
                await receivedMessageHandler({ command: 'openMetadataDeployStatus', treeKey: ACCOUNT_TREE_KEY });
                await flushAsyncWork();

                expect(orgOpenCalls()).toEqual([]);
                expect(vscode.env.openExternal).not.toHaveBeenCalled();
                expect(notificationWarningSpy).toHaveBeenLastCalledWith(RecipeYamlScalarEscape(`The Deployment Status page was not opened: qa · ${QA_USERNAME} is no longer authorized. Authorize it again with sf org login web and try again.`));

            });

            it('opens once for a double click, names an org with no alias by its username, and warns when the browser refuses the address', async () => {

                failWithDeployUrl(buildDeployUrl(QA_INSTANCE_URL));
                await openCockpitWithQaSelected();
                await deploy(ACCOUNT_TREE_KEY);
                await flushAsyncWork();
                panelState().metadataDeployStatusTarget.orgDetail = { targetOrgIdentifier: QA_USERNAME, username: QA_USERNAME };
                (vscode.env.openExternal as jest.Mock).mockResolvedValue(false);
                (AuthInfo.listAllAuthorizations as jest.Mock).mockImplementation(async () => [null, ...ORG_AUTHORIZATIONS]);

                const firstOpen = receivedMessageHandler({ command: 'openMetadataDeployStatus', treeKey: ACCOUNT_TREE_KEY });
                await receivedMessageHandler({ command: 'openMetadataDeployStatus', treeKey: ACCOUNT_TREE_KEY });
                await firstOpen;
                await flushAsyncWork();

                expect(orgOpenCalls()).toHaveLength(1);
                expect(vscode.env.openExternal).toHaveBeenCalledTimes(1);
                expect(notificationWarningSpy).toHaveBeenLastCalledWith(RecipeYamlScalarEscape(`The Deployment Status page of ${QA_USERNAME} was not opened: the browser did not accept the address.`));
                expect(JSON.stringify(notificationWarningSpy.mock.calls)).not.toContain(SESSION_ID);

            });

            it('opens nothing from the error notification\'s button while another deploy runs', async () => {

                failWithDeployUrl(buildDeployUrl(QA_INSTANCE_URL));
                let chooseOpenStatus: (label: string) => void = () => undefined;
                (vscode.window.showErrorMessage as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { chooseOpenStatus = resolve; }));
                await openCockpitWithQaSelected();
                await deploy(ACCOUNT_TREE_KEY);
                await flushAsyncWork();

                deployHandler = () => 'hold';
                const deployInFlight = deploy(ACCOUNT_TREE_KEY);
                await flushAsyncWork();
                await flushAsyncWork();
                expect(lastDeployState()).toMatchObject({ isRunning: true });

                chooseOpenStatus(RECIPE_COCKPIT_METADATA_DEPLOY_OPEN_STATUS_LABEL);
                await flushAsyncWork();
                await flushAsyncWork();

                expect(orgOpenCalls()).toEqual([]);
                expect(vscode.env.openExternal).not.toHaveBeenCalled();
                expect(notificationWarningSpy).toHaveBeenLastCalledWith('The Deployment Status page was not opened: a deploy is running. Try again once it has finished.');

                heldDeployCallbacks.forEach(answerHeldDeploy => answerHeldDeploy());
                await deployInFlight;
                await flushAsyncWork();

            });

            it('changes nothing when the error notification itself fails to show', async () => {

                failWithDeployUrl(buildDeployUrl(QA_INSTANCE_URL));
                (vscode.window.showErrorMessage as jest.Mock).mockRejectedValue(new Error('no window'));
                await openCockpitWithQaSelected();

                await deploy(ACCOUNT_TREE_KEY);
                await flushAsyncWork();

                expect(lastDeployState()).toMatchObject({ isRunning: false, hasDeployStatus: true });
                expect(orgOpenCalls()).toEqual([]);

            });

            it('carries the link into a reopened panel, and drops it when the next deploy starts', async () => {

                failWithDeployUrl(buildDeployUrl(QA_INSTANCE_URL));
                await openCockpitWithQaSelected();
                await deploy(ACCOUNT_TREE_KEY);
                await flushAsyncWork();

                await openCockpitWithQaSelected();
                expect(panelState().metadataDeployStatusTarget).toMatchObject({ treeKey: ACCOUNT_TREE_KEY, deployStatusPath: DEPLOY_STATUS_PATH });
                expect(postedNamed('metadataDeployState').at(-1)).toMatchObject({ hasDeployStatus: true });

                deployHandler = () => 'hold';
                const deployInFlight = deploy(ACCOUNT_TREE_KEY);
                await flushAsyncWork();
                await flushAsyncWork();

                expect(lastDeployState()).toMatchObject({ isRunning: true });
                expect(panelState().metadataDeployStatusTarget).toBeUndefined();
                await receivedMessageHandler({ command: 'openMetadataDeployStatus', treeKey: ACCOUNT_TREE_KEY });
                expect(orgOpenCalls()).toEqual([]);

                heldDeployCallbacks.forEach(answerHeldDeploy => answerHeldDeploy());
                await deployInFlight;
                await flushAsyncWork();

                expect(lastDeployState()).toMatchObject({ isRunning: false });
                expect(lastDeployState()).not.toHaveProperty('hasDeployStatus');

            });

        });

        it('shows an error when the --json is malformed, never a success', async () => {

            deployHandler = () => ({ stdout: 'Deploy Succeeded.' });
            await openCockpitWithQaSelected();

            await deploy(ACCOUNT_TREE_KEY);

            expect((vscode.window.showErrorMessage as jest.Mock).mock.calls[0]).toEqual([
                expect.stringContaining('The deploy of Relationship Tree 1 to qa'),
                RECIPE_COCKPIT_METADATA_DEPLOY_VIEW_OUTPUT_LABEL
            ]);
            expect(notificationInformationSpy).not.toHaveBeenCalled();
            expect(lastDeployState()).toMatchObject({ isFailure: true });

        });

        it('says the Salesforce CLI is required when sf is not installed', async () => {

            process.env.PATH = path.join(temporaryRoot, 'nowhere');
            await openCockpitWithQaSelected();

            await deploy(ACCOUNT_TREE_KEY);

            expect((vscode.window.showErrorMessage as jest.Mock).mock.calls[0][0]).toContain('The Salesforce CLI is required to deploy metadata, and "sf" is not installed or not on PATH.');
            expect(deployCalls()).toEqual([]);

        });

        it('on Windows deploys nothing from a UNC project folder, which cmd.exe would swap for the Windows folder (#285)', async () => {

            await openCockpitWithQaSelected();
            jest.spyOn(PicklistDependencyCheckService, 'isWindowsPlatform').mockReturnValue(true);
            jest.spyOn(PicklistDependencyCheckService, 'isUncPath').mockReturnValue(true);

            await deploy(ACCOUNT_TREE_KEY);

            expect(deployCalls()).toEqual([]);
            expect((vscode.window.showErrorMessage as jest.Mock).mock.calls[0][0]).toContain('is a network UNC path');
            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: true });

        });

        it('deploys nothing when the org cannot be connected to for the second Organization check', async () => {

            await openCockpitWithQaSelected();
            (SalesforceOrgService.getConnection as jest.Mock).mockRejectedValueOnce(new Error('expired access token'));

            await deploy(ACCOUNT_TREE_KEY);

            expect(deployCalls()).toEqual([]);
            expect(notificationWarningSpy).toHaveBeenCalledWith(expect.stringContaining('could not connect to qa · qa@example.com.qa: expired access token'));

        });

        it('warns that a deploy which timed out may or may not have applied, drops the cached describes and marks nothing ready', async () => {

            await openCockpitWithQaSelected();
            jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli').mockResolvedValue({ stdout: '', stderr: '', exitCode: null, timedOut: true });
            const clearSpy = jest.spyOn(SalesforceOrgService, 'clearDescribeCache');
            const readinessPostsBefore = postedNamed('dataOrgReadiness').length;

            await deploy(ACCOUNT_TREE_KEY);

            const warningTexts = (vscode.window.showWarningMessage as jest.Mock).mock.calls.map(([warningText]) => warningText);
            expect(warningTexts.at(-1)).toContain('whether it applied is unknown');
            expect(warningTexts.at(-1)).toContain('sf project deploy report --target-org qa@example.com.qa');
            expect(clearSpy).toHaveBeenCalledWith(QA_USERNAME, 'OtherChildObject__c');
            expect(postedNamed('dataOrgReadiness')).toHaveLength(readinessPostsBefore);

        });

        it('ends the deploy\'s line and rethrows when the run itself throws, so the panel is given its buttons back', async () => {

            const handleCapturedErrorSpy = jest.spyOn(ErrorHandlingService, 'handleCapturedError').mockImplementation(() => undefined);
            await openCockpitWithQaSelected();
            const runSpy = jest.spyOn(PicklistDependencyCheckService, 'runSalesforceCli').mockRejectedValue(new Error('boom'));

            await deploy(ACCOUNT_TREE_KEY);

            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: true, statusText: 'The deploy of Relationship Tree 1 stopped: boom' });
            expect(handleCapturedErrorSpy).toHaveBeenCalled();
            // THE MANIFEST'S FOLDER IS REMOVED HOWEVER THE DEPLOY ENDED
            const deployArguments = runSpy.mock.calls[0][0] as string[];
            expect(fs.existsSync(path.dirname(deployArguments[deployArguments.indexOf('--manifest') + 1]))).toBe(false);

        });

        it('says so rather than opening anything when the result file is gone', async () => {

            await openCockpitWithQaSelected();
            await deploy(ACCOUNT_TREE_KEY);
            fs.rmSync(panelState().metadataDeployOutputFilePath);

            await receivedMessageHandler({ command: 'viewMetadataDeployOutput' });

            expect(openFileSpy).not.toHaveBeenCalled();
            expect(notificationWarningSpy).toHaveBeenCalledWith('The deploy result file no longer exists in this workspace.');

        });

        it('answers with the deploy state and runs nothing when the tree is gone by the time the action runs', async () => {

            await openCockpitWithQaSelected();
            const promptSpy = jest.spyOn(VSCodeWorkspaceService, 'promptForAuthenticatedOrgDetailOnceListed');

            await (RecipeCockpitService as any).deployTreeMetadataFromPanel((RecipeCockpitService as any).recipeCockpitPanel, 'Gone-tree', false);

            expect(lastDeployState()).toEqual({ command: 'metadataDeployState', isRunning: false, treeKey: '', statusText: '', isFailure: false, hasOutput: false });
            expect(promptSpy).not.toHaveBeenCalled();
            expect(deployCalls()).toEqual([]);

        });

        it('carries a deploy in flight into a reopened panel, which refuses a second one and is told where the first is', async () => {

            deployHandler = () => 'hold';
            await openCockpitWithQaSelected();

            const deployInFlight = deploy(ACCOUNT_TREE_KEY);
            await flushAsyncWork();
            await flushAsyncWork();

            await RecipeCockpitService.openRecipeCockpitPanel(workspaceRoot, workspaceState);
            await receivedMessageHandler({ command: 'ready' });

            expect(panelState().metadataDeployStateMessage).toMatchObject({ isRunning: true, treeKey: ACCOUNT_TREE_KEY });
            expect(postedNamed('metadataDeployState').at(-1)).toMatchObject({ isRunning: true });
            expect(RecipeCockpitService.routePanelMessage({ command: 'deployTreeMetadata', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY }, panelState())).toBeUndefined();

            heldDeployCallbacks.forEach(answer => answer());
            await deployInFlight;
            await flushAsyncWork();

            expect(lastDeployState()).toMatchObject({ isRunning: false });

        });

        it('kills the process tree on cancel, says whether the deploy applied is unknown, and refuses a second deploy meanwhile', async () => {

            deployHandler = () => 'hold';
            await openCockpitWithQaSelected();
            const killSpy = jest.spyOn(PicklistDependencyCheckService, 'killProcessTree');

            const deployInFlight = deploy(ACCOUNT_TREE_KEY);
            await flushAsyncWork();
            await flushAsyncWork();

            expect(lastDeployState()).toMatchObject({ isRunning: true, statusText: 'Deploying 3 components of Relationship Tree 1…' });

            await receivedMessageHandler({ command: 'deployTreeMetadata', orgIndex: 0, treeKey: ACCOUNT_TREE_KEY });
            expect(deployCalls()).toHaveLength(1);

            cancellationToken.isCancellationRequested = true;
            cancellationListeners.forEach(cancellationListener => cancellationListener());
            heldDeployCallbacks.forEach(answer => answer());
            await deployInFlight;
            await flushAsyncWork();

            expect(killSpy).toHaveBeenCalled();
            expect(childKill).toHaveBeenCalled();
            expect(notificationInformationSpy).toHaveBeenCalledWith(expect.stringContaining('was cancelled, so whether it applied is unknown'));
            expect(lastDeployState()).toMatchObject({ isRunning: false, isFailure: true });
            expect(lastDeployState().statusText).toContain('whether it applied is unknown');

        });

    });

    describe('the panel script', () => {

        const loadTreeRecipe = () => {
            const recipeRuns = RecipeCockpitService.findGeneratedRecipeRuns(path.join(TREE_WORKSPACE_ROOT, 'treecipe', 'GeneratedRecipes'));
            return RecipeCockpitService.loadRecipeRunByRuns(recipeRuns, TREE_WORKSPACE_ROOT, 'recipe-2026-09-20T10-00-00').recipeViewModel;
        };

        const firstOf = (panel: ReturnType<typeof runPanelScript>, className: string) => panel.findAll(panel.cockpitBodyElement, className)[0];

        const cardOf = (panel: ReturnType<typeof runPanelScript>, objectApiName: string) => panel.treeCards()
            .find((treeCard: any) => panel.findAll(treeCard, 'treeObjectName').some((nameElement: any) => nameElement.textContent.includes(objectApiName)));

        const renderTrees = () => {
            const panel = runPanelScript();
            panel.postToPanel({ command: 'recipeData', recipe: loadTreeRecipe(), renderSequence: 1 });
            panel.postToPanel({ command: 'rendered' });
            panel.expandAllTrees();
            return panel;
        };

        const selectQa = (panel: ReturnType<typeof runPanelScript>) => {
            panel.postToPanel({ command: 'dataOrgList', orgLabels: ['qa'], selectedOrgIndex: 0, noOrgsMessage: '', hiddenOrgCount: 0, hiddenOrgNote: '', forgottenOrgNotice: '', renderSequence: 1 });
            panel.postToPanel({ command: 'dataOrgSelection', orgIndex: 0, orgLabel: 'qa', orgTypeLabel: 'Sandbox', isSandbox: true, failureMessage: '', requestSequence: 5, renderSequence: 1 });
            panel.postToPanel({
                command: 'dataOrgReadiness',
                objects: ['Account', 'Contact', 'OtherChildObject__c', 'Lead'].map(objectApiName => ({ objectApiName: objectApiName, disabledReason: '', requiredLookups: [] })),
                createTargets: [],
                insertResults: [],
                requestSequence: 5,
                renderSequence: 1
            });
        };

        const deployButtonOf = (panel: ReturnType<typeof runPanelScript>, objectApiName = 'OtherChildObject__c') => panel.findAll(cardOf(panel, objectApiName), 'treeDeploy')[0];

        it('draws the button on every card with a folder before any org is chosen, and posts the tree key alone', () => {

            const panel = renderTrees();
            const deployButton = deployButtonOf(panel);

            expect(deployButton.textContent).toBe(RECIPE_COCKPIT_METADATA_DEPLOY_ACTION_LABEL);
            expect(panel.isHidden(deployButton)).toBe(false);
            expect(deployButton.disabled).toBe(false);
            expect(panel.isHidden(deployButtonOf(panel, 'Lead'))).toBe(false);

            deployButton.dispatch('click');

            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'deployTreeMetadata', treeKey: ACCOUNT_TREE_KEY });
            expect(deployButton.disabled).toBe(true);
            expect(deployButtonOf(panel, 'Lead').disabled).toBe(true);

            deployButton.dispatch('click');
            expect(panel.postedHostMessages.filter(hostMessage => hostMessage.command === 'deployTreeMetadata')).toHaveLength(1);

        });

        it('stays offered when every object is ready, and posts the index of the org chosen above', () => {

            const panel = renderTrees();
            selectQa(panel);
            const deployButton = deployButtonOf(panel);

            expect(panel.findAll(cardOf(panel, 'OtherChildObject__c'), 'treeInsertReason')[0].textContent).toBe('');
            expect(panel.isHidden(deployButton)).toBe(false);

            deployButton.dispatch('click');

            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'deployTreeMetadata', treeKey: ACCOUNT_TREE_KEY, orgIndex: 0 });
            expect(firstOf(panel, 'dataOrgSelect').disabled).toBe(true);
            expect(panel.postedHostMessages.some(hostMessage => hostMessage.command === 'readinessRendered')).toBe(false);

        });

        it('holds every deploy and the picker while a deploy runs, turns every insert into generate only, draws its line on the card, and offers View output when it ended with a result file', () => {

            const panel = renderTrees();
            selectQa(panel);

            panel.postToPanel({ command: 'metadataDeployState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, statusText: 'Deploying 3 components of Relationship Tree 1…', isFailure: false, hasOutput: false });

            expect(deployButtonOf(panel).disabled).toBe(true);
            expect(deployButtonOf(panel, 'Lead').disabled).toBe(true);
            // #293: THE GENERATE BUTTON IS NEVER HELD BY A DEPLOY -- IT GENERATES ONLY UNTIL THE DEPLOY ENDS
            panel.findAll(panel.cockpitBodyElement, 'treeInsert').forEach((insertButton: any) => expect([insertButton.disabled, insertButton.textContent]).toEqual([false, 'Generate fake data']));
            panel.findAll(panel.cockpitBodyElement, 'treeInsertReason').forEach((reasonElement: any) => expect(reasonElement.textContent).toBe('Generates only: A deploy is running.'));
            expect(firstOf(panel, 'dataOrgRefresh').disabled).toBe(true);
            expect(firstOf(panel, 'dataOrgNewScratch').disabled).toBe(true);
            expect(panel.findAll(cardOf(panel, 'OtherChildObject__c'), 'metadataDeployStatusText')[0].textContent).toBe('Deploying 3 components of Relationship Tree 1…');
            expect(panel.isHidden(panel.findAll(cardOf(panel, 'Lead'), 'metadataDeployStatus')[0])).toBe(true);
            expect(panel.isHidden(panel.findAll(cardOf(panel, 'OtherChildObject__c'), 'metadataDeployViewOutput')[0])).toBe(true);

            panel.postToPanel({ command: 'metadataDeployState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, statusText: 'The deploy failed: x', isFailure: true, hasOutput: true });

            expect(deployButtonOf(panel).disabled).toBe(false);
            expect(firstOf(panel, 'dataOrgSelect').disabled).toBe(false);
            expect(panel.findAll(cardOf(panel, 'OtherChildObject__c'), 'metadataDeployStatus')[0].classList.contains('failed')).toBe(true);
            const viewOutputElement = panel.findAll(cardOf(panel, 'OtherChildObject__c'), 'metadataDeployViewOutput')[0];
            expect(panel.isHidden(viewOutputElement)).toBe(false);
            viewOutputElement.dispatch('click');
            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'viewMetadataDeployOutput' });

        });

        it('draws "Open Deployment Status" on a failed deploy\'s line only when the host says it has the page, and posts the tree key alone (#283)', () => {

            const panel = renderTrees();
            selectQa(panel);
            const openStatusOf = (objectApiName: string) => panel.findAll(cardOf(panel, objectApiName), 'metadataDeployOpenStatus')[0];

            panel.postToPanel({ command: 'metadataDeployState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, statusText: 'The deploy failed: x', isFailure: true, hasOutput: true });
            expect(panel.isHidden(openStatusOf('OtherChildObject__c'))).toBe(true);

            panel.postToPanel({ command: 'metadataDeployState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, statusText: 'The deploy failed: x', isFailure: true, hasOutput: true, hasDeployStatus: true });
            const openStatusElement = openStatusOf('OtherChildObject__c');
            expect(panel.isHidden(openStatusElement)).toBe(false);
            expect(openStatusElement.textContent).toBe(RECIPE_COCKPIT_METADATA_DEPLOY_OPEN_STATUS_LABEL);
            expect(panel.isHidden(openStatusOf('Lead'))).toBe(true);

            openStatusElement.dispatch('click');
            expect(panel.postedHostMessages.at(-1)).toEqual({ command: 'openMetadataDeployStatus', treeKey: ACCOUNT_TREE_KEY });

            panel.postToPanel({ command: 'metadataDeployState', isRunning: true, treeKey: ACCOUNT_TREE_KEY, statusText: 'Deploying…', isFailure: false, hasOutput: false });
            expect(panel.isHidden(openStatusOf('OtherChildObject__c'))).toBe(true);

            panel.postToPanel({ command: 'metadataDeployState', isRunning: false, treeKey: ACCOUNT_TREE_KEY, statusText: 'Deployed.', isFailure: false, hasOutput: true, hasDeployStatus: true });
            expect(panel.isHidden(openStatusOf('OtherChildObject__c'))).toBe(true);

        });

        it('is named in the preview warning, which says what the cockpit can write to an org', () => {

            expect(RECIPE_COCKPIT_PREVIEW_WARNING_DETAIL).toContain('"Deploy this metadata…", on every tree\'s Treecipe tab, deploys that tree\'s custom objects (each with everything in its source folder) and the custom fields of its standard objects');

        });

        it('still builds the shell from the nonce alone', () => {

            expect(RecipeCockpitService.buildWebviewShellHtml.length).toBe(1);
            expect(RecipeCockpitService.buildWebviewShellHtml('n')).not.toContain('Deploying');

        });

    });

});
