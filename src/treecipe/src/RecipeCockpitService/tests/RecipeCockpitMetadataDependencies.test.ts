import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as xml2js from 'xml2js';

// THE MODULES IMPORT NO vscode; THE CLI SERVICE THEY SHARE WITH THE OTHER RUNS DOES, THROUGH ITS OWN IMPORTS
jest.mock('vscode', () => ({}), { virtual: true });
// AN INDEPENDENT READER, AS RecipeCockpitMetadataDeployPackage.test.ts USES IT
import JSZip = require('jszip');

import {
    IMetadataDeployComponent,
    METADATA_DEPLOY_TYPES,
    METADATA_DEPLOY_ZIP_SUFFIX,
    METADATA_FIELDS_DEPLOY_PACKAGE_XML_TYPES,
    RecipeCockpitMetadataDeploy
} from '../RecipeCockpitMetadataDeploy';
import { RecipeCockpitMetadataDeployPackage } from '../RecipeCockpitMetadataDeployPackage';
import { RecipeCockpitConfirmContent } from '../RecipeCockpitConfirmContent';
import { makeTreeRunArtifactsLocation } from './RecipeCockpitRunArtifactsFixture';

/*
    #547: a deployed custom object's file can name a FlexiPage, a component or a compact layout the
    org lacks. The fields deploy ships what the project holds and sets the rest back to the standard
    one in the copy it sends, never in the project.
*/

const DEPENDENCY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'metadataDependencyWorkspace');
const ORDER_FOLDER_PATH = path.join('force-app', 'main', 'default', 'objects', 'Order__c');
const ORDER_FILE_PATH = path.join(ORDER_FOLDER_PATH, 'Order__c.object-meta.xml');

const ORDER_TREE_DEPLOY_OBJECTS = [
    { objectApiName: 'Order__c', fieldApiNames: ['Status__c', 'Supplier__c', 'Account__c'] },
    { objectApiName: 'Shipment__c', fieldApiNames: ['Order__c'] }
];

const readZip = async (zipBuffer: Buffer) => {
    const zip = await JSZip.loadAsync(zipBuffer, { checkCRC32: true });
    const entries: Record<string, string> = {};
    for ( const entryName of Object.keys(zip.files).sort() ) {
        entries[entryName] = await zip.files[entryName].async('string');
    }
    return entries;
};

const readActionOverrides = async (objectXml: string) => {
    const parsed = await xml2js.parseStringPromise(objectXml);
    return ( parsed.CustomObject.actionOverrides as Record<string, string[]>[] ).map(actionOverride => ({
        actionName: actionOverride.actionName?.[0],
        formFactor: actionOverride.formFactor?.[0],
        type: actionOverride.type?.[0],
        content: actionOverride.content?.[0]
    }));
};

describe('RecipeCockpitMetadataDeploy: what a deployed object names (#547)', () => {

    let temporaryRoot: string;
    let workspaceRoot: string;

    beforeEach(() => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-metadata-dependencies-'));
        workspaceRoot = path.join(temporaryRoot, 'workspace');
        fs.cpSync(DEPENDENCY_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    });

    const summarize = (deployObjects = ORDER_TREE_DEPLOY_OBJECTS) =>
        RecipeCockpitMetadataDeploy.summarizeTreeMetadata(workspaceRoot, ['force-app'], deployObjects);

    describe('summarizeTreeMetadata', () => {

        it('ships the held FlexiPage and compact layout, and sets back a missing or unreadable page, a component override and a missing compact layout', async () => {

            const summary = await summarize();

            expect(summary.customObjects).toEqual(['Order__c', 'Shipment__c']);
            expect(summary.flexiPages).toEqual(['Order_Record_Page']);
            expect(summary.compactLayouts).toEqual(['Order__c.Order_Compact']);
            expect(summary.objectReferenceResets).toEqual([
                { objectApiName: 'Order__c', reference: 'Edit override, Large form factor, FlexiPage Missing_Page', reason: 'FlexiPage Missing_Page is not in this project' },
                { objectApiName: 'Order__c', reference: 'New override, Large form factor, LightningComponent c:newOrder', reason: 'a LightningComponent override is never deployed with the fields' },
                { objectApiName: 'Order__c', reference: 'View override, Small form factor, FlexiPage Broken_Page', reason: 'its FlexiPage file could not be read' },
                { objectApiName: 'Shipment__c', reference: 'compact layout Missing_Compact', reason: 'CompactLayout Missing_Compact is not in this project' }
            ]);

        });

        it('names a lookup to a custom object the deploy does not carry, never one to a standard object or a tree object', async () => {

            expect((await summarize()).outOfTreeLookups).toEqual(['Order__c.Supplier__c → Supplier__c']);

        });

        it('counts a lookup to a tree object that is excluded from the deploy as out of the tree', async () => {

            expect((await summarize([{ objectApiName: 'Shipment__c', fieldApiNames: ['Order__c'] }])).outOfTreeLookups).toEqual(['Shipment__c.Order__c → Order__c']);

        });

        it('matches a FlexiPage name case-insensitively and lists it as its file spells it', async () => {

            const objectFilePath = path.join(workspaceRoot, ORDER_FILE_PATH);
            fs.writeFileSync(objectFilePath, fs.readFileSync(objectFilePath, 'utf-8').replace('<content>Order_Record_Page</content>', '<content>order_record_page</content>'));

            expect((await summarize()).flexiPages).toEqual(['Order_Record_Page']);

        });

        it('sets back an override naming no page, or a page name that is not an api name, and finds no file for either', async () => {

            const objectFilePath = path.join(workspaceRoot, ORDER_FILE_PATH);
            fs.writeFileSync(objectFilePath, fs.readFileSync(objectFilePath, 'utf-8')
                .replace('<content>Missing_Page</content>', '')
                .replace('<content>Order_Record_Page</content>', '<content>../Order_Record_Page</content>'));

            const summary = await summarize();

            expect(summary.flexiPages).toEqual([]);
            expect(summary.objectReferenceResets.map(reset => `${reset.reference}: ${reset.reason}`)).toIncludeAllMembers([
                'Edit override, Large form factor, FlexiPage: it names no page',
                'View override, Large form factor, FlexiPage ../Order_Record_Page: its page name is not a Salesforce api name'
            ]);

        });

        it('sets back a compact layout whose file is not a <CompactLayout>', async () => {

            fs.writeFileSync(path.join(workspaceRoot, ORDER_FOLDER_PATH, 'compactLayouts', 'Order_Compact.compactLayout-meta.xml'), '<FlexiPage/>');

            const summary = await summarize();

            expect(summary.compactLayouts).toEqual([]);
            expect(summary.objectReferenceResets).toContainEqual({ objectApiName: 'Order__c', reference: 'compact layout Order_Compact', reason: 'its CompactLayout file could not be read' });

        });

        it('reads each referenced FlexiPage file once however many overrides name it', async () => {

            const objectFilePath = path.join(workspaceRoot, ORDER_FILE_PATH);
            fs.writeFileSync(objectFilePath, fs.readFileSync(objectFilePath, 'utf-8').replace('<content>Missing_Page</content>', '<content>Order_Record_Page</content>'));
            const readFileSyncSpy = jest.spyOn(fs, 'readFileSync');

            const summary = await summarize();

            expect(readFileSyncSpy.mock.calls.filter(([filePath]) => String(filePath).endsWith('Order_Record_Page.flexipage-meta.xml'))).toHaveLength(1);
            expect(summary.objectReferenceResets.map(reset => reset.reference)).not.toContain('Edit override, Large form factor, FlexiPage Order_Record_Page');

        });

        it('changes nothing for an object with no override, an unreadable object file or a standard object', async () => {

            fs.writeFileSync(path.join(workspaceRoot, ORDER_FILE_PATH), '<CustomObject><actionOverrides>');

            const summary = await summarize([...ORDER_TREE_DEPLOY_OBJECTS, { objectApiName: 'Account', fieldApiNames: [] }]);

            expect(summary.unreadableCustomObjects).toEqual(['Order__c']);
            expect(summary.flexiPages).toEqual([]);
            expect(summary.compactLayouts).toEqual([]);
            expect(summary.objectReferenceResets.map(reset => reset.objectApiName)).toEqual(['Shipment__c']);

        });

        it('lists the FlexiPages and compact layouts as components of a fields deploy only', async () => {

            const summary = await summarize();

            expect(RecipeCockpitMetadataDeploy.listSummaryComponents(summary, 'fields')).toIncludeAllMembers([
                { type: 'FlexiPage', member: 'Order_Record_Page' },
                { type: 'CompactLayout', member: 'Order__c.Order_Compact' }
            ]);
            expect(RecipeCockpitMetadataDeploy.listSummaryComponents(summary, 'recordTypes')).toEqual([]);

        });

    });

    describe('resolveObjectReferences', () => {

        const objectContent = {
            actionOverrides: [
                { actionName: ['View'], content: ['Shipped'], formFactor: ['Large'], skipRecordTypeSelect: ['false'], type: ['Flexipage'] },
                { actionName: ['Edit'], content: ['NotShipped'], type: ['Flexipage'] },
                { actionName: ['Tab'], content: ['OrderTab'], type: ['Visualforce'] },
                { actionName: ['List'], content: ['legacy'], type: ['Scontrol'] },
                { actionName: ['View'], type: ['Default'] }
            ],
            compactLayoutAssignment: ['SYSTEM'],
            label: ['Order']
        };

        it('keeps a shipped page, resets every other page and component override to Default with no content, and keeps every other element', () => {

            const resolved = RecipeCockpitMetadataDeploy.resolveObjectReferences('Order__c', objectContent, name => name === 'Shipped' ? name : undefined, () => undefined);

            expect(resolved.objectContent.actionOverrides).toEqual([
                { actionName: ['View'], content: ['Shipped'], formFactor: ['Large'], skipRecordTypeSelect: ['false'], type: ['Flexipage'] },
                { actionName: ['Edit'], type: ['Default'] },
                { actionName: ['Tab'], type: ['Default'] },
                { actionName: ['List'], type: ['Default'] },
                { actionName: ['View'], type: ['Default'] }
            ]);
            expect(resolved.objectContent.label).toEqual(['Order']);
            expect(resolved.objectContent.compactLayoutAssignment).toEqual(['SYSTEM']);
            expect(resolved.resets.map(reset => reset.reference)).toEqual([
                'Edit override, FlexiPage NotShipped',
                'Tab override, Visualforce OrderTab',
                'List override, Scontrol legacy'
            ]);

        });

        it('never changes the object it was handed, and hands back the same object when nothing is reset', () => {

            const before = JSON.stringify(objectContent);
            RecipeCockpitMetadataDeploy.resolveObjectReferences('Order__c', objectContent, () => undefined, () => undefined);
            expect(JSON.stringify(objectContent)).toBe(before);

            const untouched = { actionOverrides: [{ actionName: ['View'], type: ['Default'] }], compactLayoutAssignment: ['SYSTEM'] };
            const resolved = RecipeCockpitMetadataDeploy.resolveObjectReferences('Order__c', untouched, () => undefined, () => undefined);
            expect(resolved.objectContent).toBe(untouched);
            expect(resolved.resets).toEqual([]);

        });

        it('sets a compact layout that does not ship to SYSTEM, keeps one that does, and refuses a name that is not an api name', () => {

            expect(RecipeCockpitMetadataDeploy.resolveObjectReferences('Order__c', { compactLayoutAssignment: ['Compact'] }, () => undefined, name => name === 'Compact' ? name : undefined).objectContent.compactLayoutAssignment).toEqual(['Compact']);
            expect(RecipeCockpitMetadataDeploy.resolveObjectReferences('Order__c', { compactLayoutAssignment: ['Compact'] }, () => undefined, () => undefined).objectContent.compactLayoutAssignment).toEqual(['SYSTEM']);
            const forged = RecipeCockpitMetadataDeploy.resolveObjectReferences('Order__c', { compactLayoutAssignment: ['a b'] }, () => undefined, name => name);
            expect(forged.objectContent.compactLayoutAssignment).toEqual(['SYSTEM']);
            expect(forged.resets[0].reason).toBe('its name is not a Salesforce api name');

        });

        it('writes a kept reference in the shipped file\'s spelling, since the two are matched ignoring case', () => {

            const resolved = RecipeCockpitMetadataDeploy.resolveObjectReferences(
                'Order__c',
                { actionOverrides: [{ actionName: ['View'], content: ['order_record_page'], type: ['Flexipage'] }], compactLayoutAssignment: ['order_compact'] },
                name => name.toLowerCase() === 'order_record_page' ? 'Order_Record_Page' : undefined,
                name => name.toLowerCase() === 'order_compact' ? 'Order_Compact' : undefined
            );

            expect(resolved.resets).toEqual([]);
            expect(resolved.objectContent.actionOverrides).toEqual([{ actionName: ['View'], content: ['Order_Record_Page'], type: ['Flexipage'] }]);
            expect(resolved.objectContent.compactLayoutAssignment).toEqual(['Order_Compact']);

        });

        it('writes every reset on one line, whatever the file says', () => {

            const resolved = RecipeCockpitMetadataDeploy.resolveObjectReferences('Order__c', {
                actionOverrides: [{ actionName: ['View\nInjected'], content: ['c:page\u2028x'], type: ['LightningComponent'] }]
            }, () => undefined, () => undefined);

            expect(resolved.resets[0].reference).toBe('View Injected override, LightningComponent c:page x');

        });

        it('passes over an override that is not an element', () => {

            const resolved = RecipeCockpitMetadataDeploy.resolveObjectReferences('Order__c', { actionOverrides: ['text', null] }, () => undefined, () => undefined);

            expect(resolved.resets).toEqual([]);
            expect(resolved.objectContent.actionOverrides).toEqual(['text', null]);

        });

    });

    describe('readFieldReferences', () => {

        it('reads a lookup or master-detail\'s parent, and no parent for any other type', async () => {

            expect(await RecipeCockpitMetadataDeploy.readFieldReferences('<CustomField><type>Lookup</type><referenceTo>Supplier__c</referenceTo></CustomField>')).toEqual({ valueSetName: '', referenceTo: 'Supplier__c' });
            expect(await RecipeCockpitMetadataDeploy.readFieldReferences('<CustomField><type>MasterDetail</type><referenceTo> Order__c </referenceTo></CustomField>')).toEqual({ valueSetName: '', referenceTo: 'Order__c' });
            expect(await RecipeCockpitMetadataDeploy.readFieldReferences('<CustomField><type>Text</type><referenceTo>Supplier__c</referenceTo></CustomField>')).toEqual({ valueSetName: '', referenceTo: '' });
            expect(await RecipeCockpitMetadataDeploy.readFieldReferences('<CustomObject/>')).toBeUndefined();

        });

    });

    describe('the package.xml', () => {

        it('admits FlexiPage and CompactLayout only when the fields deploy passes its own types', () => {

            const components: IMetadataDeployComponent[] = [
                { type: 'CustomField', member: 'Order__c.Status__c' },
                { type: 'FlexiPage', member: 'Order_Record_Page' },
                { type: 'CompactLayout', member: 'Order__c.Order_Compact' }
            ];

            expect(RecipeCockpitMetadataDeploy.buildPackageXml(components, '64.0', undefined, METADATA_FIELDS_DEPLOY_PACKAGE_XML_TYPES)).toBe([
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
                '    <types>',
                '        <members>Order__c.Order_Compact</members>',
                '        <name>CompactLayout</name>',
                '    </types>',
                '    <types>',
                '        <members>Order__c.Status__c</members>',
                '        <name>CustomField</name>',
                '    </types>',
                '    <types>',
                '        <members>Order_Record_Page</members>',
                '        <name>FlexiPage</name>',
                '    </types>',
                '    <version>64.0</version>',
                '</Package>',
                ''
            ].join('\n'));
            expect(() => RecipeCockpitMetadataDeploy.buildPackageXml(components, '64.0')).toThrow('"FlexiPage" is not a type the Troubleshooting tab deploys, so nothing was deployed.');
            expect(METADATA_DEPLOY_TYPES).not.toContain('FlexiPage');

        });

        it('refuses a FlexiPage or CompactLayout member that is not an api name in its type\'s shape', () => {

            expect(() => RecipeCockpitMetadataDeploy.buildPackageXml([{ type: 'FlexiPage', member: 'a/b' }], undefined, undefined, METADATA_FIELDS_DEPLOY_PACKAGE_XML_TYPES)).toThrow('is not a FlexiPage api name');
            expect(() => RecipeCockpitMetadataDeploy.buildPackageXml([{ type: 'CompactLayout', member: 'Order_Compact' }], undefined, undefined, METADATA_FIELDS_DEPLOY_PACKAGE_XML_TYPES)).toThrow('is not a CompactLayout api name');

        });

    });

    describe('the metadata zip the CLI sends', () => {

        it('is named after its package.xml, written once, and passed as a plain --metadata-dir with --single-package', () => {

            const location = makeTreeRunArtifactsLocation(workspaceRoot);
            const packageXmlFilePath = RecipeCockpitMetadataDeploy.buildPackageXmlFilePath(location, 'qa@example.com.qa', 'field-deploy', new Date(Date.UTC(2026, 9, 29, 12, 0, 0))) as string;
            const zipFilePath = RecipeCockpitMetadataDeploy.buildMetadataZipFilePath(packageXmlFilePath);

            expect(zipFilePath.endsWith(`-field-deploy${METADATA_DEPLOY_ZIP_SUFFIX}`)).toBe(true);

            const writtenFilePath = RecipeCockpitMetadataDeploy.writeMetadataZip(location, zipFilePath, Buffer.from([1, 2, 3])) as string;
            const secondFilePath = RecipeCockpitMetadataDeploy.writeMetadataZip(location, zipFilePath, Buffer.from([4])) as string;

            expect(writtenFilePath).toBe(zipFilePath);
            expect([...fs.readFileSync(writtenFilePath)]).toEqual([1, 2, 3]);
            expect(secondFilePath.endsWith(`-field-deploy-2${METADATA_DEPLOY_ZIP_SUFFIX}`)).toBe(true);

            const relativePath = RecipeCockpitMetadataDeploy.toManifestRelativePath(workspaceRoot, writtenFilePath);
            expect(RecipeCockpitMetadataDeploy.buildMetadataZipDeployArguments(relativePath, 'qa@example.com.qa')).toEqual([
                'project', 'deploy', 'start', '--json', '--target-org', 'qa@example.com.qa', '--metadata-dir', relativePath, '--single-package'
            ]);

        });

        it('refuses a zip path outside the workspace or not ending in its suffix, and writes nothing outside it', () => {

            ['', '/tmp/x-metadata.zip', 'C:/x-metadata.zip', '../x-metadata.zip', 'a/./x-metadata.zip', '-x-metadata.zip', 'x-package.xml', 'a\\x-metadata.zip'].forEach(zipPath => {
                expect(() => RecipeCockpitMetadataDeploy.buildMetadataZipDeployArguments(zipPath, 'qa@example.com.qa')).toThrow('The metadata zip path is not a plain path inside the workspace, so nothing was deployed.');
            });

            expect(RecipeCockpitMetadataDeploy.writeMetadataZip(makeTreeRunArtifactsLocation(workspaceRoot), path.join(temporaryRoot, `outside${METADATA_DEPLOY_ZIP_SUFFIX}`), Buffer.from([1]))).toBeUndefined();
            expect(fs.existsSync(path.join(temporaryRoot, `outside${METADATA_DEPLOY_ZIP_SUFFIX}`))).toBe(false);

        });

    });

    describe('the confirmation', () => {

        const org = { alias: 'qa', username: 'qa@example.com.qa' };

        it('warns that references are set back in the deployed copy, lists each, and warns about a lookup out of the tree', async () => {

            const summary = await summarize();
            const detail = RecipeCockpitConfirmContent.flatten(RecipeCockpitMetadataDeploy.buildConfirmationContent('fields', 'Order tree', org, 'force-app', RecipeCockpitMetadataDeploy.listSummaryComponents(summary, 'fields'), summary));

            expect(detail).toContain('4 references a custom object makes to a page or compact layout this deploy does not carry are set back to the standard one in the deployed copy; this project\'s files are not changed.');
            expect(detail).toContain('Set back to the standard one in the deployed copy · 4');
            expect(detail).toContain('Order__c: Edit override, Large form factor, FlexiPage Missing_Page — FlexiPage Missing_Page is not in this project');
            expect(detail).toContain('Shipment__c: compact layout Missing_Compact — CompactLayout Missing_Compact is not in this project');
            expect(detail).toContain('1 lookup points to a custom object this deploy does not carry — the org must already have it, or the field fails: Order__c.Supplier__c → Supplier__c');
            expect(detail).toContain('1 FlexiPage: Order_Record_Page');
            expect(detail).toContain('1 CompactLayout: Order__c.Order_Compact');

        });

        it('says the references could not be set back, and why, when the deploy sends the project\'s own files', async () => {

            const summary = await summarize();
            const detail = RecipeCockpitConfirmContent.flatten(RecipeCockpitMetadataDeploy.buildConfirmationContent('fields', 'Order tree', org, 'force-app', [], summary, true, [], undefined, 'sfdx-project.json has "replacements"'));

            expect(detail).toContain('4 references a custom object makes to a page or compact layout this deploy does not carry could not be set back, because sfdx-project.json has "replacements": the org must already have them, or the object fails.');
            expect(detail).toContain('Could not be set back · 4');
            expect(detail).not.toContain('are set back to the standard one');

        });

        it('adds nothing for a tree whose objects name nothing', async () => {

            fs.rmSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Order__c'), { recursive: true });
            fs.writeFileSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Shipment__c', 'Shipment__c.object-meta.xml'), '<CustomObject><label>Shipment</label></CustomObject>');

            const summary = await summarize([{ objectApiName: 'Shipment__c', fieldApiNames: [] }]);
            const content = RecipeCockpitMetadataDeploy.buildConfirmationContent('fields', 'Order tree', org, 'force-app', [], summary);

            expect(content.warnings).not.toContainEqual(expect.stringContaining('set back'));
            expect(content.sections?.find(section => section.title.startsWith('Set back'))?.lines).toEqual([]);

        });

    });

});

describe('RecipeCockpitMetadataDeployPackage: what a deployed object names (#547)', () => {

    let temporaryRoot: string;
    let workspaceRoot: string;

    beforeEach(() => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-metadata-dependencies-zip-'));
        workspaceRoot = path.join(temporaryRoot, 'workspace');
        fs.cpSync(DEPENDENCY_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    });

    const fieldComponents = async () => RecipeCockpitMetadataDeploy.listSummaryComponents(
        await RecipeCockpitMetadataDeploy.summarizeTreeMetadata(workspaceRoot, ['force-app'], ORDER_TREE_DEPLOY_OBJECTS),
        'fields'
    );

    it('finds the FlexiPage and compact layout source files', async () => {

        const resolved = RecipeCockpitMetadataDeployPackage.resolveSourceFiles(workspaceRoot, ['force-app'], await fieldComponents());

        expect(resolved.missingComponents).toEqual([]);
        expect(resolved.sourceFiles.find(sourceFile => sourceFile.component.type === 'FlexiPage')?.filePath).toBe(path.join(workspaceRoot, 'force-app', 'main', 'default', 'flexipages', 'Order_Record_Page.flexipage-meta.xml'));
        expect(resolved.sourceFiles.find(sourceFile => sourceFile.component.type === 'CompactLayout')?.filePath).toBe(path.join(workspaceRoot, ORDER_FOLDER_PATH, 'compactLayouts', 'Order_Compact.compactLayout-meta.xml'));

    });

    it('zips the FlexiPage as it is, the compact layout inside its object, and every other reference set back, leaving the project file byte-identical', async () => {

        const components = await fieldComponents();
        const projectObjectXml = fs.readFileSync(path.join(workspaceRoot, ORDER_FILE_PATH));
        const packageXml = RecipeCockpitMetadataDeploy.buildPackageXml(components, '64.0', undefined, METADATA_FIELDS_DEPLOY_PACKAGE_XML_TYPES);
        const resolved = RecipeCockpitMetadataDeployPackage.resolveSourceFiles(workspaceRoot, ['force-app'], components);

        const entries = await readZip(await RecipeCockpitMetadataDeployPackage.buildDeployZip(packageXml, resolved.sourceFiles) as Buffer);

        expect(Object.keys(entries)).toEqual(['flexipages/Order_Record_Page.flexipage', 'objects/Order__c.object', 'objects/Shipment__c.object', 'package.xml']);
        expect(entries['flexipages/Order_Record_Page.flexipage']).toBe(fs.readFileSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'flexipages', 'Order_Record_Page.flexipage-meta.xml'), 'utf-8'));
        expect(await readActionOverrides(entries['objects/Order__c.object'])).toEqual([
            { actionName: 'Edit', formFactor: 'Large', type: 'Default', content: undefined },
            { actionName: 'New', formFactor: 'Large', type: 'Default', content: undefined },
            { actionName: 'View', formFactor: 'Large', type: 'Flexipage', content: 'Order_Record_Page' },
            { actionName: 'View', formFactor: 'Small', type: 'Default', content: undefined },
            { actionName: 'View', formFactor: undefined, type: 'Default', content: undefined }
        ]);

        const order = ( await xml2js.parseStringPromise(entries['objects/Order__c.object']) ).CustomObject;
        expect(order.compactLayoutAssignment).toEqual(['Order_Compact']);
        expect(order.compactLayouts[0].fullName).toEqual(['Order_Compact']);
        expect(order.compactLayouts[0].fields).toEqual(['Name', 'Status__c']);
        expect(( await xml2js.parseStringPromise(entries['objects/Shipment__c.object']) ).CustomObject.compactLayoutAssignment).toEqual(['SYSTEM']);

        expect(fs.readFileSync(path.join(workspaceRoot, ORDER_FILE_PATH)).equals(projectObjectXml)).toBe(true);

    });

    it('writes the object\'s references in the spelling of the files it ships', async () => {

        const objectFilePath = path.join(workspaceRoot, ORDER_FILE_PATH);
        fs.writeFileSync(objectFilePath, fs.readFileSync(objectFilePath, 'utf-8')
            .replace('<content>Order_Record_Page</content>', '<content>order_record_page</content>')
            .replace('<compactLayoutAssignment>Order_Compact</compactLayoutAssignment>', '<compactLayoutAssignment>ORDER_COMPACT</compactLayoutAssignment>'));
        const components = await fieldComponents();
        const resolved = RecipeCockpitMetadataDeployPackage.resolveSourceFiles(workspaceRoot, ['force-app'], components);

        const entries = await readZip(await RecipeCockpitMetadataDeployPackage.buildDeployZip(RecipeCockpitMetadataDeploy.buildPackageXml(components, '64.0', undefined, METADATA_FIELDS_DEPLOY_PACKAGE_XML_TYPES), resolved.sourceFiles) as Buffer);
        const order = ( await xml2js.parseStringPromise(entries['objects/Order__c.object']) ).CustomObject;

        expect(( await readActionOverrides(entries['objects/Order__c.object']) ).find(actionOverride => actionOverride.type === 'Flexipage')?.content).toBe('Order_Record_Page');
        expect(order.compactLayoutAssignment).toEqual(['Order_Compact']);

    });

    it('sets a held page back too when it is not in the zip, by the same rule the confirmation listed it by', async () => {

        const components = ( await fieldComponents() ).filter(component => component.type !== 'FlexiPage' && component.type !== 'CompactLayout');
        const packageXml = RecipeCockpitMetadataDeploy.buildPackageXml(components, '64.0');
        const resolved = RecipeCockpitMetadataDeployPackage.resolveSourceFiles(workspaceRoot, ['force-app'], components);

        const entries = await readZip(await RecipeCockpitMetadataDeployPackage.buildDeployZip(packageXml, resolved.sourceFiles) as Buffer);

        expect(( await readActionOverrides(entries['objects/Order__c.object']) ).filter(actionOverride => actionOverride.type !== 'Default')).toEqual([]);
        expect(( await xml2js.parseStringPromise(entries['objects/Order__c.object']) ).CustomObject.compactLayoutAssignment).toEqual(['SYSTEM']);

    });

    it('refuses a FlexiPage file that is not a <FlexiPage>, sending nothing', async () => {

        const components: IMetadataDeployComponent[] = [{ type: 'FlexiPage', member: 'Broken_Page' }];
        const resolved = RecipeCockpitMetadataDeployPackage.resolveSourceFiles(workspaceRoot, ['force-app'], components);

        await expect(RecipeCockpitMetadataDeployPackage.buildDeployZip('<Package/>', resolved.sourceFiles)).rejects.toThrow('The source file of FlexiPage Broken_Page could not be read as XML, so nothing was deployed.');

    });

    describe('planDeployMethod', () => {

        it('keeps the CLI\'s --manifest when no object is edited, and sends the zip through the CLI when one is', async () => {

            const components = await fieldComponents();

            expect(RecipeCockpitMetadataDeployPackage.planDeployMethod('cli', workspaceRoot, ['force-app'], components)).toEqual({ method: 'cli', reason: 'setting' });
            expect(RecipeCockpitMetadataDeployPackage.planDeployMethod('cli', workspaceRoot, ['force-app'], components, true).method).toBe('cliMetadataDir');
            expect(RecipeCockpitMetadataDeployPackage.planDeployMethod('jsforce', workspaceRoot, ['force-app'], components, true).method).toBe('jsforce');

        });

        it('falls back to --manifest when the zip cannot be what the CLI would send, and says the edits are not made', async () => {

            const components = await fieldComponents();
            const projectJsonPath = path.join(workspaceRoot, 'sfdx-project.json');
            fs.writeFileSync(projectJsonPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8')), replacements: [{ filename: 'x', stringToReplace: 'a', replaceWithEnv: 'B' }] }));

            const plan = RecipeCockpitMetadataDeployPackage.planDeployMethod('cli', workspaceRoot, ['force-app'], components, true);

            expect(plan).toEqual({ method: 'cli', reason: 'replacements' });
            expect(RecipeCockpitMetadataDeployPackage.describeEditsNotApplied(plan)).toBe('sfdx-project.json has "replacements", which only the CLI applies to the project\'s own files');
            expect(RecipeCockpitMetadataDeployPackage.describeEditsNotApplied({ method: 'cli', reason: 'forceIgnore' })).toContain('.forceignore');
            expect(RecipeCockpitMetadataDeployPackage.describeEditsNotApplied({ method: 'cli', reason: 'missingSource' })).toContain('source file');
            expect(RecipeCockpitMetadataDeployPackage.describeEditsNotApplied({ method: 'cliMetadataDir', sourceFiles: [] })).toBeUndefined();

        });

        it('says how the zip goes through the CLI, and that nothing changed for a cliMetadataDir plan', () => {

            const lines = RecipeCockpitMetadataDeployPackage.describeDeployMethod({ method: 'cliMetadataDir', sourceFiles: [] });

            expect(lines.join(' ')).toContain('--metadata-dir');
            expect(RecipeCockpitMetadataDeployPackage.describeChangedPlan({ method: 'cliMetadataDir', sourceFiles: [] })).toBe('');

        });

    });

});
