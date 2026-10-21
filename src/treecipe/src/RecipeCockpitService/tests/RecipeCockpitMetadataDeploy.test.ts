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
                customObjects: ['OtherChildObject__c'],
                missingCustomObjects: [],
                unreadableCustomObjects: [],
                validationRules: ['Account.Budget_Not_Negative', 'OtherChildObject__c.Score_In_Range'],
                skippedNameCount: 0
            });

        });

        describe('custom objects and validation rules (#402)', () => {

            it('finds a custom object\'s .object-meta.xml, never a standard object\'s, and lists one it cannot read or the project lacks', async () => {

                const summary = await summarize([
                    ...ACCOUNT_TREE_DEPLOY_OBJECTS,
                    { objectApiName: 'Gadget__c', fieldApiNames: [] },
                    { objectApiName: 'Widget__c', fieldApiNames: [] }
                ]);

                // Account HAS AN Account.object-meta.xml, AND IS STILL NEVER A CustomObject MEMBER
                expect(summary.customObjects).toEqual(['OtherChildObject__c']);
                expect(summary.unreadableCustomObjects).toEqual(['Gadget__c']);
                expect(summary.missingCustomObjects).toEqual(['Widget__c']);

            });

            it('reads an .object-meta.xml whose name differs in case, and an empty <CustomObject/>, and never one that is not a <CustomObject>', async () => {

                const objectFolderPath = path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'OtherChildObject__c');
                fs.renameSync(path.join(objectFolderPath, 'OtherChildObject__c.object-meta.xml'), path.join(objectFolderPath, 'otherchildobject__c.object-meta.xml'));
                fs.writeFileSync(path.join(objectFolderPath, 'otherchildobject__c.object-meta.xml'), '<?xml version="1.0"?><CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"/>');

                expect((await summarize()).customObjects).toEqual(['OtherChildObject__c']);

                fs.writeFileSync(path.join(objectFolderPath, 'otherchildobject__c.object-meta.xml'), '<?xml version="1.0"?><CustomField><fullName>X</fullName></CustomField>');

                expect((await summarize()).unreadableCustomObjects).toEqual(['OtherChildObject__c']);

            });

            it('lists an .object-meta.xml it cannot read as unreadable, and names several missing or unreadable objects in the plural', async () => {

                const realReadFileSync = fs.readFileSync;
                jest.spyOn(fs, 'readFileSync').mockImplementation(((filePath: fs.PathOrFileDescriptor, options?: any) => {
                    if ( String(filePath).endsWith('OtherChildObject__c.object-meta.xml') ) {
                        throw new Error('EACCES');
                    }
                    return realReadFileSync(filePath, options);
                }) as typeof fs.readFileSync);

                const summary = await summarize([
                    ...ACCOUNT_TREE_DEPLOY_OBJECTS,
                    { objectApiName: 'Gadget__c', fieldApiNames: [] },
                    { objectApiName: 'Widget__c', fieldApiNames: [] },
                    { objectApiName: 'Sprocket__c', fieldApiNames: [] }
                ]);

                expect(summary.customObjects).toEqual([]);
                expect(summary.unreadableCustomObjects).toEqual(['Gadget__c', 'OtherChildObject__c']);
                expect(summary.missingCustomObjects).toEqual(['Sprocket__c', 'Widget__c']);

                const detail = RecipeCockpitMetadataDeploy.buildConfirmationDetail('fields', 'T', 'qa', 'force-app', RecipeCockpitMetadataDeploy.listSummaryComponents(summary, 'fields'), summary);
                expect(detail).toContain('Not deployed: 2 custom objects not in this project — the org must already have them, or their fields fail: Sprocket__c, Widget__c');
                expect(detail).toContain('Not deployed: 2 custom objects whose .object-meta.xml could not be read: Gadget__c, OtherChildObject__c');
                expect(detail).not.toContain('overwrites');
                expect(detail).not.toContain('standard object, so');

            });

            it('never reads an .object-meta.xml that is a link, so a file outside the workspace is not deployed', async () => {

                const objectFolderPath = path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'OtherChildObject__c');
                const outsideFilePath = path.join(temporaryRoot, 'Outside.object-meta.xml');
                fs.copyFileSync(path.join(objectFolderPath, 'OtherChildObject__c.object-meta.xml'), outsideFilePath);
                fs.rmSync(path.join(objectFolderPath, 'OtherChildObject__c.object-meta.xml'));
                fs.symlinkSync(outsideFilePath, path.join(objectFolderPath, 'OtherChildObject__c.object-meta.xml'));

                const summary = await summarize();

                expect(summary.customObjects).toEqual([]);
                expect(summary.missingCustomObjects).toEqual(['OtherChildObject__c']);

            });

            it('lists validation rules from every package directory once, and counts a rule file whose name is not an api name as skipped', async () => {

                const secondRuleFolderPath = path.join(workspaceRoot, 'unpackaged', 'objects', 'Account', 'validationRules');
                fs.mkdirSync(secondRuleFolderPath, { recursive: true });
                fs.writeFileSync(path.join(secondRuleFolderPath, 'Budget_Not_Negative.validationRule-meta.xml'), '<ValidationRule/>');
                fs.writeFileSync(path.join(secondRuleFolderPath, 'Extra_Rule.validationRule-meta.xml'), '<ValidationRule/>');
                fs.writeFileSync(path.join(secondRuleFolderPath, 'Bad Rule.validationRule-meta.xml'), '<ValidationRule/>');

                const summary = await summarize();

                expect(summary.validationRules).toEqual(['Account.Budget_Not_Negative', 'Account.Extra_Rule', 'OtherChildObject__c.Score_In_Range']);
                expect(summary.skippedNameCount).toBe(1);

            });

            it('adds the custom objects to a fields deploy, and the full set is validation rules, record types and the value sets the project holds', async () => {

                const summary = await summarize();

                expect(RecipeCockpitMetadataDeploy.listSummaryComponents(summary, 'fields').filter(component => component.type === 'CustomObject'))
                    .toEqual([{ type: 'CustomObject', member: 'OtherChildObject__c' }]);
                expect(RecipeCockpitMetadataDeploy.listSummaryComponents(summary, 'recordTypes').map(component => component.type)).toEqual(['RecordType', 'RecordType']);
                expect(RecipeCockpitMetadataDeploy.listFullSetComponents(summary)).toEqual([
                    { type: 'ValidationRule', member: 'Account.Budget_Not_Negative' },
                    { type: 'ValidationRule', member: 'OtherChildObject__c.Score_In_Range' },
                    { type: 'RecordType', member: 'Account.Business' },
                    { type: 'RecordType', member: 'Account.Partner' },
                    { type: 'GlobalValueSet', member: 'Account_Ratings' }
                ]);

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

        it('walks a folder once when two package directories overlap, and names one skipped or unreadable item in the singular', async () => {

            const summary = await summarize([{ objectApiName: 'Account', fieldApiNames: ['Annual_Budget__c', 'Regions__c', 'Bad Field__c'] }], ['force-app', 'force-app/main']);

            expect(summary.customFields).toEqual(['Account.Annual_Budget__c']);
            expect(summary.recordTypes).toEqual(['Account.Business', 'Account.Partner']);
            const detail = RecipeCockpitMetadataDeploy.buildConfirmationDetail('fields', 'T', 'qa', 'force-app', RecipeCockpitMetadataDeploy.listSummaryComponents(summary, 'fields'), { ...summary, missingGlobalValueSets: ['Only_Set'] });
            expect(detail).toContain('Not deployed: 1 custom field whose source file is missing or could not be read: Account.Regions__c');
            expect(detail).toContain('Skipped: 1 name that is not a Salesforce api name.');
            expect(RecipeCockpitMetadataDeploy.buildConfirmationDetail('globalValueSets', 'T', 'qa', 'force-app', [{ type: 'GlobalValueSet', member: 'A_Set' }], { ...summary, missingGlobalValueSets: ['Only_Set'] }))
                .toContain('Not deployed: 1 global value set a field names that this project does not hold: Only_Set');

        });

        it('reads one object\'s fields and record types from every package directory that holds a folder for it, the first file of a name winning', async () => {

            const secondObjectFolderPath = path.join(workspaceRoot, 'unpackaged', 'objects', 'Account');
            fs.mkdirSync(path.join(secondObjectFolderPath, 'fields'), { recursive: true });
            fs.mkdirSync(path.join(secondObjectFolderPath, 'recordTypes'), { recursive: true });
            fs.writeFileSync(path.join(secondObjectFolderPath, 'fields', 'Regions__c.field-meta.xml'), '<CustomField><type>MultiselectPicklist</type></CustomField>');
            fs.writeFileSync(path.join(secondObjectFolderPath, 'fields', 'Annual_Budget__c.field-meta.xml'), '<Profile/>');
            fs.writeFileSync(path.join(secondObjectFolderPath, 'recordTypes', 'Wholesale.recordType-meta.xml'), '<RecordType/>');

            const summary = await summarize([{ objectApiName: 'Account', fieldApiNames: ['Annual_Budget__c', 'Regions__c'] }]);

            expect(summary.customFields).toEqual(['Account.Annual_Budget__c', 'Account.Regions__c']);
            expect(summary.unreadableFields).toEqual([]);
            expect(summary.recordTypes).toEqual(['Account.Business', 'Account.Partner', 'Account.Wholesale']);

        });

        it('never lists a fields or recordTypes folder that is a link, even inside an object folder that is not', async () => {

            const outsideFolderPath = path.join(temporaryRoot, 'outside-fields');
            fs.mkdirSync(outsideFolderPath);
            fs.writeFileSync(path.join(outsideFolderPath, 'Outside__c.field-meta.xml'), '<CustomField><type>Text</type></CustomField>');
            fs.writeFileSync(path.join(outsideFolderPath, 'Outside.recordType-meta.xml'), '<RecordType/>');
            const contactFolderPath = path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Contact');
            fs.rmSync(path.join(contactFolderPath, 'fields'), { recursive: true });
            fs.symlinkSync(outsideFolderPath, path.join(contactFolderPath, 'fields'));
            fs.symlinkSync(outsideFolderPath, path.join(contactFolderPath, 'recordTypes'));

            const summary = await summarize([{ objectApiName: 'Contact', fieldApiNames: ['Outside__c'] }]);

            expect(summary.customFields).toEqual([]);
            expect(summary.unreadableFields).toEqual(['Contact.Outside__c']);
            expect(summary.recordTypes).toEqual([]);

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

        it('names only custom fields and the custom objects that hold them when it deploys fields, so a broken layout or a standard object cannot fail the deploy', async () => {

            const summary = await summarize();
            const packageXml = RecipeCockpitMetadataDeploy.buildPackageXml(RecipeCockpitMetadataDeploy.listSummaryComponents(summary, 'fields'));
            const typeNames = [...packageXml.matchAll(/<name>([^<]*)<\/name>/g)].map(match => match[1]);
            const members = [...packageXml.matchAll(/<members>([^<]*)<\/members>/g)].map(match => match[1]);

            expect(typeNames).toEqual(['CustomField', 'CustomObject']);
            expect(members.length).toBeGreaterThan(0);
            members.forEach(member => expect(member).toMatch(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)?__c$/));
            expect(members).toContain('OtherChildObject__c');
            expect(members).not.toContain('Account');
            expect(members).not.toContain('Contact');
            ['Layout', 'ListView', 'CompactLayout', 'ValidationRule', 'RecordType', 'Account-Account_Layout', 'ParentId', 'LastName'].forEach(forbiddenText => {
                expect(packageXml).not.toContain(forbiddenText);
            });

        });

        it('writes the full set\'s validation rules, record types and value sets beside the fields and objects when they are added', async () => {

            const summary = await summarize();
            const packageXml = RecipeCockpitMetadataDeploy.buildPackageXml([
                ...RecipeCockpitMetadataDeploy.listSummaryComponents(summary, 'fields'),
                ...RecipeCockpitMetadataDeploy.listFullSetComponents(summary)
            ]);

            expect([...packageXml.matchAll(/<name>([^<]*)<\/name>/g)].map(match => match[1])).toEqual(['CustomField', 'CustomObject', 'GlobalValueSet', 'RecordType', 'ValidationRule']);
            expect(packageXml).toContain('<members>Account.Budget_Not_Negative</members>');
            ['Layout', 'ListView', 'PermissionSet', 'Account-Account_Layout'].forEach(forbiddenText => expect(packageXml).not.toContain(forbiddenText));

        });

        it('refuses, writing nothing, a type the tab does not deploy, a member that is not an api name in its type\'s shape, and no component at all', () => {

            const refused: IMetadataDeployComponent[][] = [
                [{ type: 'Layout' as any, member: 'Account-Account Layout' }],
                [{ type: 'Layout' as any, member: 'Account-Account_Layout' }],
                [{ type: 'CustomObject', member: 'Account' }],
                [{ type: 'CustomObject', member: 'Gadget__mdt' }],
                [{ type: 'CustomObject', member: 'Account.Rating__c' }],
                [{ type: 'ValidationRule', member: 'Account' }],
                [{ type: 'ValidationRule', member: 'Account.Bad Rule' }],
                [{ type: 'ValidationRule', member: 'Account.Rule.Extra' }],
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
            expect(METADATA_DEPLOY_TYPES).toEqual(['CustomField', 'CustomObject', 'GlobalValueSet', 'PermissionSet', 'RecordType', 'ValidationRule']);
            expect(RecipeCockpitMetadataDeploy.buildPackageXml([{ type: 'CustomObject', member: 'Gadget__c' }, { type: 'ValidationRule', member: 'Account.Rule_1' }]))
                .toContain('<members>Gadget__c</members>');

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

        it('reads a result that is not an object as a failure that names no component', () => {

            expect(RecipeCockpitMetadataDeploy.parseMetadataDeployOutput(invocation(JSON.stringify({ status: 0, result: [] })))).toMatchObject({ kind: 'failed', componentFailureMessages: [] });
            expect(RecipeCockpitMetadataDeploy.readComponentFailureMessages(undefined)).toEqual([]);

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

        it('warns when sfdx-project.json has replacements that copy local files or environment variables into what is deployed', () => {

            const components = [{ type: 'RecordType' as const, member: 'Account.Business' }];

            expect(RecipeCockpitMetadataDeploy.buildConfirmationDetail('recordTypes', 'T', 'qa', 'force-app', components, undefined, true))
                .toContain('sfdx-project.json has "replacements" that copy local files or environment variables into the deployed metadata.');
            expect(RecipeCockpitMetadataDeploy.buildConfirmationDetail('recordTypes', 'T', 'qa', 'force-app', components)).not.toContain('replacements');

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

        it('names the custom objects, says deploying one overwrites the org\'s settings for it, and lists what the project lacks or cannot read (#402)', async () => {

            const summary = await summarize([
                ...ACCOUNT_TREE_DEPLOY_OBJECTS,
                { objectApiName: 'Gadget__c', fieldApiNames: [] },
                { objectApiName: 'Widget__c', fieldApiNames: [] }
            ]);
            const detail = RecipeCockpitMetadataDeploy.buildConfirmationDetail('fields', 'T', 'qa', 'force-app', RecipeCockpitMetadataDeploy.listSummaryComponents(summary, 'fields'), summary);

            expect(detail).toContain('6 CustomField: Account.Annual_Budget__c');
            expect(detail).toContain('1 CustomObject: OtherChildObject__c');
            expect(detail).toContain('Deploying a custom object overwrites the org\'s settings for it — its label, sharing model, name field and the rest — with this project\'s version.');
            expect(detail).toContain('Not deployed: 1 custom object not in this project — the org must already have it, or its fields fail: Widget__c');
            expect(detail).toContain('Not deployed: 1 custom object whose .object-meta.xml could not be read: Gadget__c');
            expect(detail).not.toMatch(/[()]/);
            expect(detail).not.toContain('Ticking the box');

        });

        it('says so when every object is standard, and describes the full set the box adds below the deploy\'s own components', async () => {

            const standardSummary = await summarize([{ objectApiName: 'Account', fieldApiNames: ['Annual_Budget__c'] }]);
            const standardDetail = RecipeCockpitMetadataDeploy.buildConfirmationDetail('fields', 'T', 'qa', 'force-app', RecipeCockpitMetadataDeploy.listSummaryComponents(standardSummary, 'fields'), standardSummary);

            expect(standardDetail).toContain('Every object of this tree is a standard object, so no CustomObject is deployed.');
            expect(standardDetail).not.toContain('overwrites');

            const summary = await summarize();
            const detail = RecipeCockpitMetadataDeploy.buildConfirmationDetail('fields', 'T', 'qa', 'force-app', RecipeCockpitMetadataDeploy.listSummaryComponents(summary, 'fields'), summary, false, RecipeCockpitMetadataDeploy.listFullSetComponents(summary));
            const lines = detail.split('\n');
            const boxLineIndex = lines.indexOf('Ticking the box below also deploys, in the same package.xml:');

            expect(boxLineIndex).toBeGreaterThan(lines.findIndex(line => line.startsWith('1 CustomObject:')));
            expect(lines.slice(boxLineIndex + 1, boxLineIndex + 4)).toEqual([
                '1 GlobalValueSet: Account_Ratings',
                '2 RecordType: Account.Business, Account.Partner',
                '2 ValidationRule: Account.Budget_Not_Negative, OtherChildObject__c.Score_In_Range'
            ]);
            expect(RecipeCockpitMetadataDeploy.buildConfirmationDetail('recordTypes', 'T', 'qa', 'force-app', RecipeCockpitMetadataDeploy.listSummaryComponents(summary, 'recordTypes'), summary))
                .not.toContain('CustomObject');

        });

    });

    it('imports no vscode', () => {

        const source = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitMetadataDeploy.ts'), 'utf-8');

        expect(source).not.toMatch(/from 'vscode'/);
        expect(source).not.toContain('--ignore-errors');

    });

});
