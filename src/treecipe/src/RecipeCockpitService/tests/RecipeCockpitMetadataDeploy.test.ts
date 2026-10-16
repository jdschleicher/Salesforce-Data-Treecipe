import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// THE MODULE IMPORTS NO vscode; THE CLI SERVICE IT SHARES WITH THE OTHER RUNS DOES, THROUGH ITS OWN IMPORTS
jest.mock('vscode', () => ({}), { virtual: true });

import {
    IMetadataDeployComponent,
    METADATA_DEPLOY_CONFIRMATION_SHOWN,
    METADATA_DEPLOY_TYPES,
    RecipeCockpitMetadataDeploy
} from '../RecipeCockpitMetadataDeploy';
import { ORG_OPERATIONS_FOLDER_NAME } from '../../ScratchOrgService/ScratchOrgService';

const METADATA_DEPLOY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'metadataDeployWorkspace');
const QA_USERNAME = 'qa@example.com.qa';

const ACCOUNT_TREE_DEPLOY_OBJECTS = [
    { objectApiName: 'Account', fieldApiNames: ['Legacy_Code__c', 'Annual_Budget__c', 'Rating__c', 'Sub_Rating__c', 'Regions__c', 'ParentId', 'OwnerId'] },
    { objectApiName: 'Contact', fieldApiNames: ['LastName', 'AccountId'] },
    { objectApiName: 'OtherChildObject__c', fieldApiNames: ['Score__c', 'Ratio__c', 'Contact__c'] }
];

const invocation = (stdout: string, extra: Record<string, unknown> = {}) => ({ stdout: stdout, stderr: '', exitCode: 0, ...extra });

describe('RecipeCockpitMetadataDeploy (#346)', () => {

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

    const summarize = (deployObjects = ACCOUNT_TREE_DEPLOY_OBJECTS, packageDirectoryPaths = ['force-app', 'unpackaged']) =>
        RecipeCockpitMetadataDeploy.summarizeTreeMetadata(workspaceRoot, packageDirectoryPaths, deployObjects);

    describe('summarizeTreeMetadata', () => {

        it('splits the tree\'s fields into custom fields it can read, standard fields and custom fields with no readable source, and finds value sets and record types', async () => {

            expect(await summarize()).toEqual({
                customFields: ['Account.Annual_Budget__c', 'Account.Rating__c', 'Account.Sub_Rating__c', 'OtherChildObject__c.Contact__c', 'OtherChildObject__c.Ratio__c', 'OtherChildObject__c.Score__c'],
                standardFields: ['Account.OwnerId', 'Account.ParentId', 'Contact.AccountId', 'Contact.LastName'],
                unreadableFields: ['Account.Legacy_Code__c', 'Account.Regions__c'],
                globalValueSets: ['Account_Ratings'],
                missingGlobalValueSets: ['Missing_Set'],
                recordTypes: ['Account.Business', 'Account.Partner'],
                skippedNameCount: 0
            });

        });

        it('reads only the strict package directories it is given, so a value set or object elsewhere is not found', async () => {

            const summary = await summarize(ACCOUNT_TREE_DEPLOY_OBJECTS, ['force-app']);

            expect(summary.globalValueSets).toEqual([]);
            expect(summary.missingGlobalValueSets).toEqual(['Account_Ratings', 'Missing_Set']);
            expect((await summarize(ACCOUNT_TREE_DEPLOY_OBJECTS, ['unpackaged'])).customFields).toEqual([]);

        });

        it('leaves out an excluded object and an unticked field, since the caller does not list them', async () => {

            const summary = await summarize([{ objectApiName: 'Account', fieldApiNames: ['Annual_Budget__c'] }]);

            expect(summary.customFields).toEqual(['Account.Annual_Budget__c']);
            expect(summary.globalValueSets).toEqual([]);
            // RECORD TYPES ARE THE OBJECT'S, WHICHEVER FIELDS ARE TICKED
            expect(summary.recordTypes).toEqual(['Account.Business', 'Account.Partner']);

        });

        it('counts, and never offers, a name that is not an api name, and offers nothing for an object no package directory holds', async () => {

            const summary = await summarize([
                { objectApiName: 'Bad Object', fieldApiNames: ['X__c'] },
                { objectApiName: 'Account', fieldApiNames: ['Bad Field__c', 'Annual_Budget__c'] },
                { objectApiName: 'Gadget__c', fieldApiNames: ['Size__c'] }
            ]);

            expect(summary.skippedNameCount).toBe(2);
            expect(summary.customFields).toEqual(['Account.Annual_Budget__c']);
            expect(summary.unreadableFields).toEqual(['Gadget__c.Size__c']);

        });

        it('never reads a field file, a record type or a value set that resolves outside the workspace through a link', async () => {

            const outsideFolderPath = path.join(temporaryRoot, 'outside');
            fs.mkdirSync(path.join(outsideFolderPath, 'Lead', 'fields'), { recursive: true });
            fs.writeFileSync(path.join(outsideFolderPath, 'Lead', 'fields', 'Secret__c.field-meta.xml'), '<CustomField><type>Text</type></CustomField>');
            fs.symlinkSync(path.join(outsideFolderPath, 'Lead'), path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Lead'));
            fs.symlinkSync(outsideFolderPath, path.join(workspaceRoot, 'unpackaged', 'globalValueSets', 'linked'));

            const summary = await summarize([{ objectApiName: 'Lead', fieldApiNames: ['Secret__c'] }]);

            expect(summary.customFields).toEqual([]);
            expect(summary.unreadableFields).toEqual(['Lead.Secret__c']);
            expect((await summarize(ACCOUNT_TREE_DEPLOY_OBJECTS, ['../outside'])).customFields).toEqual([]);

        });

        it('counts a record type file or a value set name that is not an api name as skipped, and names the skip in the confirmation', async () => {

            const objectFolderPath = path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account');
            fs.writeFileSync(path.join(objectFolderPath, 'recordTypes', 'Bad Name.recordType-meta.xml'), '<RecordType/>');
            fs.writeFileSync(path.join(objectFolderPath, 'fields', 'Annual_Budget__c.field-meta.xml'), '<CustomField><valueSet><valueSetName>Bad Set</valueSetName></valueSet></CustomField>');
            fs.mkdirSync(path.join(objectFolderPath, 'fields', 'Folder__c.field-meta.xml'));

            const summary = await summarize([{ objectApiName: 'Account', fieldApiNames: ['Annual_Budget__c', 'Folder__c'] }]);

            expect(summary.skippedNameCount).toBe(2);
            expect(summary.recordTypes).toEqual(['Account.Business', 'Account.Partner']);
            expect(summary.unreadableFields).toEqual(['Account.Folder__c']);
            expect(RecipeCockpitMetadataDeploy.buildConfirmationDetail('recordTypes', 'T', 'qa', 'force-app', RecipeCockpitMetadataDeploy.listSummaryComponents(summary, 'recordTypes'), summary))
                .toContain('Skipped: 2 names that are not a Salesforce api name.');

        });

        it('matches an object folder case-insensitively and names it as the tree does', async () => {

            const summary = await summarize([{ objectApiName: 'account', fieldApiNames: ['annual_budget__c'] }]);

            expect(summary.customFields).toEqual(['account.annual_budget__c']);

        });

    });

    describe('readValueSetName', () => {

        it('answers the value set name, an empty name for a field with none, and undefined for a file that is not a CustomField', async () => {

            expect(await RecipeCockpitMetadataDeploy.readValueSetName('<CustomField><valueSet><valueSetName> X_Set </valueSetName></valueSet></CustomField>')).toBe('X_Set');
            expect(await RecipeCockpitMetadataDeploy.readValueSetName('<CustomField><type>Text</type></CustomField>')).toBe('');
            expect(await RecipeCockpitMetadataDeploy.readValueSetName('<CustomField/>')).toBe('');
            expect(await RecipeCockpitMetadataDeploy.readValueSetName('<CustomField><valueSet>text</valueSet></CustomField>')).toBe('');
            expect(await RecipeCockpitMetadataDeploy.readValueSetName('<Profile/>')).toBeUndefined();
            expect(await RecipeCockpitMetadataDeploy.readValueSetName('<CustomField>')).toBeUndefined();

        });

    });

    describe('buildPackageXml', () => {

        it('names only the components given, types and members sorted with "<", duplicates once, with the project\'s api version', () => {

            const packageXml = RecipeCockpitMetadataDeploy.buildPackageXml([
                { type: 'CustomField', member: 'b__c.Z__c' },
                { type: 'CustomField', member: 'Account.Rating__c' },
                { type: 'CustomField', member: 'Account.Rating__c' },
                { type: 'RecordType', member: 'Account.Business' },
                { type: 'GlobalValueSet', member: 'Account_Ratings' }
            ], '64.0');

            expect(packageXml).toBe([
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
                '    <types>',
                '        <members>Account.Rating__c</members>',
                '        <members>b__c.Z__c</members>',
                '        <name>CustomField</name>',
                '    </types>',
                '    <types>',
                '        <members>Account_Ratings</members>',
                '        <name>GlobalValueSet</name>',
                '    </types>',
                '    <types>',
                '        <members>Account.Business</members>',
                '        <name>RecordType</name>',
                '    </types>',
                '    <version>64.0</version>',
                '</Package>',
                ''
            ].join('\n'));

        });

        it('leaves the version out when the project names none in the shape a package.xml takes', () => {

            ['', '64', '64.0</version><x>', undefined].forEach(apiVersion => {
                expect(RecipeCockpitMetadataDeploy.buildPackageXml([{ type: 'PermissionSet', member: 'SDT_Tree' }], apiVersion)).not.toContain('<version>');
            });

        });

        it('names only CustomField members that are custom fields of an object when it deploys fields, so a broken layout or object definition cannot fail the deploy', async () => {

            const summary = await summarize();
            const packageXml = RecipeCockpitMetadataDeploy.buildPackageXml(RecipeCockpitMetadataDeploy.listSummaryComponents(summary, 'fields'));
            const typeNames = [...packageXml.matchAll(/<name>([^<]*)<\/name>/g)].map(match => match[1]);
            const members = [...packageXml.matchAll(/<members>([^<]*)<\/members>/g)].map(match => match[1]);

            expect(typeNames).toEqual(['CustomField']);
            expect(members.length).toBeGreaterThan(0);
            members.forEach(member => expect(member).toMatch(/^[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*__c$/));
            ['Layout', 'CustomObject', 'ListView', 'CompactLayout', 'ValidationRule', 'Account-Account_Layout', 'ParentId', 'LastName'].forEach(forbiddenText => {
                expect(packageXml).not.toContain(forbiddenText);
            });

        });

        it('refuses, writing nothing, a type the tab does not deploy, a member that is not an api name in its type\'s shape, and no component at all', () => {

            const refused: IMetadataDeployComponent[][] = [
                [{ type: 'Layout' as any, member: 'Account-Account Layout' }],
                [{ type: 'CustomObject' as any, member: 'Account' }],
                [{ type: 'CustomField', member: 'Account.ParentId' }],
                [{ type: 'CustomField', member: 'Account.Rating__pc' }],
                [{ type: 'CustomField', member: 'Account' }],
                [{ type: 'CustomField', member: 'Account.Rating__c.Extra' }],
                [{ type: 'RecordType', member: 'Account.Bad Name' }],
                [{ type: 'GlobalValueSet', member: '</members><members>*' }],
                [{ type: 'PermissionSet', member: 'Evil\n<types>' }],
                [{ type: 'PermissionSet', member: 7 as any }],
                []
            ];

            refused.forEach(components => expect(() => RecipeCockpitMetadataDeploy.buildPackageXml(components)).toThrow());
            expect(METADATA_DEPLOY_TYPES).toEqual(['CustomField', 'GlobalValueSet', 'PermissionSet', 'RecordType']);

        });

        it('escapes what it writes, though every member it accepts is already an api name', () => {

            expect(RecipeCockpitMetadataDeploy.escapeXmlText('<a & "b" \'c\'>')).toBe('&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;');

        });

    });

    describe('the package.xml file', () => {

        const deployDate = new Date(2026, 9, 16, 9, 5, 7);

        it('goes to treecipe/OrgOperations/<username>/<timestamp>-<operation>-package.xml, written with a .gitignore beside it, and a second in the same second takes -2', () => {

            const packageXmlFilePath = RecipeCockpitMetadataDeploy.buildPackageXmlFilePath(workspaceRoot, QA_USERNAME, 'field-deploy', deployDate) as string;

            expect(packageXmlFilePath).toBe(path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, QA_USERNAME, '20261016-090507-field-deploy-package.xml'));
            expect(RecipeCockpitMetadataDeploy.writePackageXml(workspaceRoot, packageXmlFilePath, '<Package/>')).toBe(packageXmlFilePath);
            expect(RecipeCockpitMetadataDeploy.writePackageXml(workspaceRoot, packageXmlFilePath, '<Package/>')).toBe(packageXmlFilePath.replace(/-package\.xml$/, '-2-package.xml'));
            expect(fs.readFileSync(path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, '.gitignore'), 'utf-8')).toBe('*\n');
            expect(RecipeCockpitMetadataDeploy.toManifestRelativePath(workspaceRoot, packageXmlFilePath)).toBe(`treecipe/${ORG_OPERATIONS_FOLDER_NAME}/${QA_USERNAME}/20261016-090507-field-deploy-package.xml`);

        });

        it('answers undefined when the folder cannot be made, or a hundred files already hold the name', () => {

            const packageXmlFilePath = RecipeCockpitMetadataDeploy.buildPackageXmlFilePath(workspaceRoot, QA_USERNAME, 'field-deploy', deployDate) as string;
            fs.mkdirSync(path.dirname(packageXmlFilePath), { recursive: true });
            fs.writeFileSync(packageXmlFilePath, '');
            for ( let attempt = 2; attempt <= 100; attempt++ ) {
                fs.writeFileSync(packageXmlFilePath.replace(/-package\.xml$/, `-${attempt}-package.xml`), '');
            }

            expect(RecipeCockpitMetadataDeploy.writePackageXml(workspaceRoot, packageXmlFilePath, '<Package/>')).toBeUndefined();

            fs.writeFileSync(path.join(workspaceRoot, 'treecipe', ORG_OPERATIONS_FOLDER_NAME, 'blocked'), '');
            expect(RecipeCockpitMetadataDeploy.writePackageXml(workspaceRoot, path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, 'blocked', 'x-package.xml'), '<Package/>')).toBeUndefined();

            const realWriteFileSync = fs.writeFileSync;
            jest.spyOn(fs, 'writeFileSync').mockImplementation((...writeArguments: any[]) => {
                if ( String(writeArguments[0]).endsWith('-package.xml') ) {
                    throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
                }
                return (realWriteFileSync as any)(...writeArguments);
            });
            expect(RecipeCockpitMetadataDeploy.writePackageXml(workspaceRoot, packageXmlFilePath.replace('field-deploy', 'record-type-deploy'), '<Package/>')).toBeUndefined();

        });

        it('refuses a username that could name another folder, and a folder linked out of the workspace', () => {

            ['', '.', '..', 'a/b', 'a\\b'].forEach(username => {
                expect(RecipeCockpitMetadataDeploy.buildPackageXmlFilePath(workspaceRoot, username, 'field-deploy', deployDate)).toBeUndefined();
            });

            const outsideFolderPath = path.join(temporaryRoot, 'outside');
            fs.mkdirSync(outsideFolderPath);
            fs.mkdirSync(path.join(workspaceRoot, 'treecipe', ORG_OPERATIONS_FOLDER_NAME), { recursive: true });
            fs.symlinkSync(outsideFolderPath, path.join(workspaceRoot, 'treecipe', ORG_OPERATIONS_FOLDER_NAME, QA_USERNAME));

            const linkedFilePath = path.join(path.resolve(workspaceRoot), 'treecipe', ORG_OPERATIONS_FOLDER_NAME, QA_USERNAME, 'x-field-deploy-package.xml');
            expect(RecipeCockpitMetadataDeploy.writePackageXml(workspaceRoot, linkedFilePath, '<Package/>')).toBeUndefined();
            expect(fs.readdirSync(outsideFolderPath)).toEqual([]);
            expect(RecipeCockpitMetadataDeploy.writePackageXml(workspaceRoot, path.join(temporaryRoot, 'x-package.xml'), '<Package/>')).toBeUndefined();

        });

    });

    describe('buildMetadataDeployArguments', () => {

        it('deploys the manifest by its relative path to the username, as JSON, and never ignores errors', () => {

            const deployArguments = RecipeCockpitMetadataDeploy.buildMetadataDeployArguments('treecipe/OrgOperations/qa/20261016-090507-field-deploy-package.xml', QA_USERNAME);

            expect(deployArguments).toEqual([
                'project', 'deploy', 'start', '--json', '--target-org', QA_USERNAME,
                '--manifest', 'treecipe/OrgOperations/qa/20261016-090507-field-deploy-package.xml'
            ]);
            expect(deployArguments).not.toContain('--ignore-errors');
            expect(deployArguments).not.toContain('--metadata');

        });

        it('refuses a manifest path that is absolute, climbs, is not a package.xml, or reads as a flag, and a username that is not a target org', () => {

            ['', '/abs/x-package.xml', 'C:/x-package.xml', '../x-package.xml', 'a/../x-package.xml', 'a\\x-package.xml', '--x-package.xml', 'a//x-package.xml', 'x.xml'].forEach(manifestPath => {
                expect(() => RecipeCockpitMetadataDeploy.buildMetadataDeployArguments(manifestPath, QA_USERNAME)).toThrow();
            });
            expect(() => RecipeCockpitMetadataDeploy.buildMetadataDeployArguments('x-package.xml', '--target-org')).toThrow();

        });

    });

    describe('parseMetadataDeployOutput', () => {

        const deployAnswer = (status: number, result: Record<string, unknown>) => invocation(JSON.stringify({ status: status, result: result }));

        it('counts a deploy as landed only on status 0, result.success true and no component failure', () => {

            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(deployAnswer(0, { success: true, numberComponentsDeployed: 3, details: { componentSuccesses: [{ fullName: 'A' }] } })))
                .toEqual({ kind: 'deployed', deployedComponentCount: 3 });
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(deployAnswer(0, { success: true, details: { componentSuccesses: [{ fullName: 'A' }, { fullName: 'package.xml' }] } })))
                .toEqual({ kind: 'deployed', deployedComponentCount: 1 });

            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(deployAnswer(1, { success: true })).kind).toBe('failed');
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(deployAnswer(0, { success: 'true' })).kind).toBe('failed');
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(deployAnswer(0, { success: true, details: { componentFailures: { fullName: 'Account.X__c', problem: 'bad' } } })).kind).toBe('failed');
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation('not json')).kind).toBe('failed');
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation('[]')).kind).toBe('failed');

        });

        it('names each component failure on one line, once, with secrets in it redacted', () => {

            const outcome = RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(deployAnswer(1, {
                success: false,
                details: {
                    componentFailures: [
                        { fullName: 'Account.Rating__c', problem: 'Value set\nAccount_Ratings not found' },
                        { fullName: 'Account.Rating__c', problem: 'Value set\nAccount_Ratings not found' },
                        { problem: '' },
                        'not an object'
                    ]
                }
            }));

            expect(outcome).toMatchObject({
                kind: 'failed',
                componentFailureCount: 4,
                componentFailureMessages: ['Account.Rating__c: Value set Account_Ratings not found', 'a component: it could not be deployed']
            });

        });

        it('says when the CLI is missing, could not start, stopped, or answered too much to read', () => {

            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation('', { spawnError: Object.assign(new Error('spawn sf ENOENT'), { code: 'ENOENT' }) })))
                .toMatchObject({ kind: 'cliNotInstalled', failureMessage: expect.stringContaining('is not installed or not on PATH') });
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation('', { spawnError: Object.assign(new Error('EACCES'), { code: 'EACCES' }) })))
                .toMatchObject({ kind: 'failed', failureMessage: 'The Salesforce CLI could not be started: EACCES' });
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation('', { timedOut: true })).kind).toBe('unconfirmed');
            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation('', { isOutputTooLarge: true })).kind).toBe('unconfirmed');

        });

    });

    describe('buildConfirmationDetail', () => {

        it('names the tree, the org, the package directory and every component up to a cap, then counts the rest', () => {

            const components = Array.from({ length: METADATA_DEPLOY_CONFIRMATION_SHOWN + 3 }, (_unused, componentIndex) => ({ type: 'CustomField' as const, member: `Account.F${String(componentIndex).padStart(2, '0')}__c` }));
            const detail = RecipeCockpitMetadataDeploy.buildConfirmationDetail('fields', 'Tree\nOne', 'qa · qa@example.com', 'force-app', components);

            expect(detail).toContain('Tree: Tree One');
            expect(detail).toContain('Org: qa · qa@example.com');
            expect(detail).toContain('From: force-app');
            expect(detail).toContain(`${components.length} CustomField: Account.F00__c, `);
            expect(detail).toContain('Account.F19__c and 3 more');
            expect(detail).not.toContain('Account.F20__c');
            expect(detail).not.toMatch(/[()]/);

        });

        it('lists standard fields as not deployed on purpose, and counts fields with no readable source and value sets the project lacks', async () => {

            const summary = await summarize();
            const fieldsDetail = RecipeCockpitMetadataDeploy.buildConfirmationDetail('fields', 'T', 'qa', 'force-app', RecipeCockpitMetadataDeploy.listSummaryComponents(summary, 'fields'), summary);
            const valueSetDetail = RecipeCockpitMetadataDeploy.buildConfirmationDetail('globalValueSets', 'T', 'qa', 'force-app', RecipeCockpitMetadataDeploy.listSummaryComponents(summary, 'globalValueSets'), summary);

            expect(fieldsDetail).toContain('Not deployed: standard fields — the org enables these through a feature or setting: Account.OwnerId, Account.ParentId, Contact.AccountId, Contact.LastName');
            expect(fieldsDetail).toContain('Not deployed: 2 custom fields whose source file is missing or could not be read: Account.Legacy_Code__c, Account.Regions__c');
            expect(valueSetDetail).toContain('1 GlobalValueSet: Account_Ratings');
            expect(valueSetDetail).toContain('Not deployed: 1 global value set a field names that this project does not hold: Missing_Set');
            expect(valueSetDetail).not.toContain('standard fields');

        });

    });

    it('imports no vscode', () => {

        const source = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitMetadataDeploy.ts'), 'utf-8');

        expect(source).not.toMatch(/from 'vscode'/);
        expect(source).not.toContain('--ignore-errors');

    });

});
