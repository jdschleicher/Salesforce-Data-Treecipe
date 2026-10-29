import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// THE MODULE IMPORTS NO vscode; THE SERVICES IT SHARES WITH THE DEPLOY DO, THROUGH THEIR OWN IMPORTS
jest.mock('vscode', () => ({}), { virtual: true });
// jszip COMES WITH @salesforce/core AND IS ONLY EVER USED IN TESTS: HERE, TO BUILD THE ZIP AN ORG ANSWERS WITH
import JSZip = require('jszip');

import {
    IMetadataRetrieveConnection,
    IMetadataRetrieveZipEntry,
    METADATA_RETRIEVE_DEFAULT_METHOD,
    METADATA_RETRIEVE_STATUS_CHECK_ATTEMPTS,
    METADATA_RETRIEVE_ZIP_ENTRY_MAX_BYTES,
    RecipeCockpitMetadataRetrievePackage
} from '../RecipeCockpitMetadataRetrievePackage';
import { IMetadataDeployComponent } from '../RecipeCockpitMetadataDeploy';
import { RecipeCockpitMetadataRetrieve } from '../RecipeCockpitMetadataRetrieve';
import { SfdxProjectService } from '../../SfdxProjectService/SfdxProjectService';

const NAMESPACE = 'http://soap.sforce.com/2006/04/metadata';
const RETRIEVE_ID = '09S000000000001AAA';

const ACCOUNT_OBJECT_XML = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<CustomObject xmlns="${NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    '    <fields>',
    '        <fullName>Rating__c</fullName>',
    '        <label>Rating &amp; Tier</label>',
    '        <type>Picklist</type>',
    '    </fields>',
    '    <fields>',
    '        <fullName>Annual_Budget__c</fullName>',
    '        <label>Annual Budget</label>',
    '        <precision>18</precision>',
    '        <scale>2</scale>',
    '        <type>Currency</type>',
    '    </fields>',
    '    <fields>',
    '        <fullName>Not_Asked__c</fullName>',
    '        <label>Not Asked</label>',
    '        <type>Text</type>',
    '    </fields>',
    '    <fields>',
    '        <fullName>../../Escape__c</fullName>',
    '        <label>Not an api name</label>',
    '    </fields>',
    '    <label>Account</label>',
    '    <listViews>',
    '        <fullName>All</fullName>',
    '        <filterScope>Everything</filterScope>',
    '        <label>All</label>',
    '    </listViews>',
    '    <recordTypes>',
    '        <fullName>Business</fullName>',
    '        <active>true</active>',
    '        <label>Business</label>',
    '    </recordTypes>',
    '    <validationRules>',
    '        <fullName>Budget_Not_Negative</fullName>',
    '        <active>true</active>',
    '        <errorConditionFormula>Annual_Budget__c &lt; 0</errorConditionFormula>',
    '        <errorMessage>No.</errorMessage>',
    '    </validationRules>',
    '</CustomObject>',
    ''
].join('\n');

const GLOBAL_VALUE_SET_XML = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<GlobalValueSet xmlns="${NAMESPACE}">`,
    '    <customValue>',
    '        <fullName>Hot</fullName>',
    '        <default>false</default>',
    '        <label>Hot</label>',
    '    </customValue>',
    '    <masterLabel>Account Ratings</masterLabel>',
    '</GlobalValueSet>',
    ''
].join('\n');

const field = (member: string): IMetadataDeployComponent => ({ type: 'CustomField', member: member });

const buildZip = async (files: Record<string, string>): Promise<Buffer> => {
    const zip = new JSZip();
    Object.entries(files).forEach(([name, content]) => zip.file(name, content));
    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};

const readEntries = async (files: Record<string, string>): Promise<IMetadataRetrieveZipEntry[]> => RecipeCockpitMetadataRetrievePackage.readZip(await buildZip(files));

describe('RecipeCockpitMetadataRetrievePackage (#506)', () => {

    let temporaryRoot: string;
    let workspaceRoot: string;

    beforeEach(() => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-retrieve-package-'));
        workspaceRoot = path.join(temporaryRoot, 'workspace');
        fs.mkdirSync(workspaceRoot);
    });

    afterEach(() => {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    });

    const writeWorkspaceFile = (relativePath: string, content: string) => {
        const filePath = path.join(workspaceRoot, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
        return filePath;
    };

    describe('readRetrieveMethod', () => {

        it('is jsforce only when the setting says exactly that, and the CLI otherwise', () => {
            expect(METADATA_RETRIEVE_DEFAULT_METHOD).toBe('cli');
            expect(RecipeCockpitMetadataRetrievePackage.readRetrieveMethod('jsforce')).toBe('jsforce');
            expect(RecipeCockpitMetadataRetrievePackage.readRetrieveMethod('cli')).toBe('cli');
            [undefined, null, 'JSFORCE', 'sdr', 1, {}].forEach(value => expect(RecipeCockpitMetadataRetrievePackage.readRetrieveMethod(value)).toBe('cli'));
        });

    });

    describe('buildRetrieveRequest', () => {

        it('names exactly the package.xml\'s members, one type entry each, sorted with "<", as a single package', () => {
            expect(RecipeCockpitMetadataRetrievePackage.buildRetrieveRequest([
                field('Account.Rating__c'),
                { type: 'GlobalValueSet', member: 'Account_Ratings' },
                field('Account.Annual_Budget__c'),
                field('Account.Rating__c')
            ], '62.0')).toEqual({
                apiVersion: 62,
                singlePackage: true,
                unpackaged: {
                    types: [
                        { members: ['Account.Annual_Budget__c', 'Account.Rating__c'], name: 'CustomField' },
                        { members: ['Account_Ratings'], name: 'GlobalValueSet' }
                    ],
                    version: '62.0'
                }
            });
        });

        it('orders every key as the Metadata API schema sequences its elements, since jsforce writes SOAP elements in key order', () => {
            const request = RecipeCockpitMetadataRetrievePackage.buildRetrieveRequest([field('Account.Rating__c')], '62.0');
            const unpackaged = request.unpackaged as { types: Array<Record<string, unknown>> };
            expect(Object.keys(request)).toEqual(['apiVersion', 'singlePackage', 'unpackaged']);
            expect(Object.keys(unpackaged)).toEqual(['types', 'version']);
            expect(Object.keys(unpackaged.types[0])).toEqual(['members', 'name']);
        });

        it('names a standard object for the Adapter, which a deploy never does', () => {
            expect(RecipeCockpitMetadataRetrievePackage.buildRetrieveRequest([{ type: 'CustomObject', member: 'Account' }], '61.0').unpackaged)
                .toEqual({ version: '61.0', types: [{ name: 'CustomObject', members: ['Account'] }] });
        });

        it('refuses a member that is not an api name in its type\'s shape, an API version that is not one, and an empty request', () => {
            expect(() => RecipeCockpitMetadataRetrievePackage.buildRetrieveRequest([field('Account.Name')], '62.0')).toThrow(/nothing was retrieved/);
            expect(() => RecipeCockpitMetadataRetrievePackage.buildRetrieveRequest([field('Account.<x>__c')], '62.0')).toThrow(/nothing was retrieved/);
            expect(() => RecipeCockpitMetadataRetrievePackage.buildRetrieveRequest([{ type: 'CustomObject', member: '../Account' }], '62.0')).toThrow(/nothing was retrieved/);
            expect(() => RecipeCockpitMetadataRetrievePackage.buildRetrieveRequest([field('Account.Rating__c')], 'latest')).toThrow(/not an API version/);
            expect(() => RecipeCockpitMetadataRetrievePackage.buildRetrieveRequest([], '62.0')).toThrow(/at least one component/);
        });

    });

    describe('readZip', () => {

        it('reads every entry of a DEFLATE zip, skipping folder entries', async () => {
            const zip = new JSZip();
            zip.folder('objects');
            zip.file('objects/Account.object', ACCOUNT_OBJECT_XML);
            zip.file('package.xml', '<Package/>', { compression: 'STORE' });
            const entries = RecipeCockpitMetadataRetrievePackage.readZip(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
            expect(entries.map(entry => entry.name).sort()).toEqual(['objects/Account.object', 'package.xml']);
            expect(entries.find(entry => entry.name === 'objects/Account.object')?.content.toString('utf-8')).toBe(ACCOUNT_OBJECT_XML);
        });

        it('refuses an entry name that climbs out, is absolute, carries a drive or a backslash', async () => {
            for ( const name of ['../escape.object', 'objects/../../escape.object', '/etc/passwd', 'C:/x.object', 'objects\\Account.object'] ) {
                const zipBuffer = await buildZip({ 'objects/Account.object': 'x' });
                // THE NAME IS WRITTEN OVER IN BOTH HEADERS, SAME LENGTH, SO THE ZIP IS OTHERWISE WHOLE
                const original = Buffer.from('objects/Account.object');
                const replacement = Buffer.from(name.padEnd(original.length, 'x').slice(0, original.length));
                let offset = zipBuffer.indexOf(original);
                while ( offset !== -1 ) {
                    replacement.copy(zipBuffer, offset);
                    offset = zipBuffer.indexOf(original, offset + 1);
                }
                expect(() => RecipeCockpitMetadataRetrievePackage.readZip(zipBuffer)).toThrow(/not a plain relative path|could not be read/);
            }
            expect(RecipeCockpitMetadataRetrievePackage.isPlainZipEntryName('objects/Account.object')).toBe(true);
            ['', '..', 'a//b', './a', 'a/./b', 'a\u0000b'].forEach(name => expect(RecipeCockpitMetadataRetrievePackage.isPlainZipEntryName(name)).toBe(false));
        });

        it('refuses an entry whose CRC does not match, one that claims more than the cap, an unknown compression method, and what is not a zip', async () => {

            const corrupted = await buildZip({ 'package.xml': 'x'.repeat(100) });
            const centralOffset = corrupted.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
            corrupted.writeUInt32LE(( corrupted.readUInt32LE(centralOffset + 16) ^ 1 ) >>> 0, centralOffset + 16);
            expect(() => RecipeCockpitMetadataRetrievePackage.readZip(corrupted)).toThrow(/size or CRC/);

            const oversized = await buildZip({ 'package.xml': 'x' });
            oversized.writeUInt32LE(METADATA_RETRIEVE_ZIP_ENTRY_MAX_BYTES + 1, oversized.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
            expect(() => RecipeCockpitMetadataRetrievePackage.readZip(oversized)).toThrow(/larger than/);

            const unknownMethod = await buildZip({ 'package.xml': 'x' });
            unknownMethod.writeUInt16LE(12, unknownMethod.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10);
            expect(() => RecipeCockpitMetadataRetrievePackage.readZip(unknownMethod)).toThrow(/compression method 12/);

            expect(() => RecipeCockpitMetadataRetrievePackage.readZip(Buffer.from('not a zip at all, but long enough to search'))).toThrow(/no end of central directory/);

        });

        it('decodes the RetrieveResult\'s zip, and reads one that carries none, or none that is base64, as none', () => {
            expect(RecipeCockpitMetadataRetrievePackage.readZipFile({ zipFile: Buffer.from('abc').toString('base64') })?.toString()).toBe('abc');
            [undefined, '', 'not base64!', 7].forEach(zipFile => expect(RecipeCockpitMetadataRetrievePackage.readZipFile({ zipFile: zipFile })).toBeUndefined());
        });

    });

    describe('convertToSourceFiles', () => {

        const relativePaths = (files: Array<{ relativeSegments: string[] }>) => files.map(file => file.relativeSegments.join('/')).sort();

        it('cuts only the asked-for fields out of the .object, each with the .object\'s namespaces, and writes no object file', async () => {

            const sourceFiles = await RecipeCockpitMetadataRetrievePackage.convertToSourceFiles(
                await readEntries({ 'package.xml': '<Package/>', 'objects/Account.object': ACCOUNT_OBJECT_XML }),
                [field('Account.Rating__c'), field('account.annual_budget__c')]
            ) ?? [];

            expect(relativePaths(sourceFiles)).toEqual(['objects/Account/fields/Annual_Budget__c.field-meta.xml', 'objects/Account/fields/Rating__c.field-meta.xml']);
            expect(sourceFiles.map(sourceFile => [sourceFile.type, sourceFile.fullName]).sort()).toEqual([['CustomField', 'Account.Annual_Budget__c'], ['CustomField', 'Account.Rating__c']]);
            expect(sourceFiles.find(sourceFile => sourceFile.fullName === 'Account.Rating__c')?.content).toBe([
                '<?xml version="1.0" encoding="UTF-8"?>',
                `<CustomField xmlns="${NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
                '    <fullName>Rating__c</fullName>',
                '    <label>Rating &amp; Tier</label>',
                '    <type>Picklist</type>',
                '</CustomField>',
                ''
            ].join('\n'));

        });

        it('writes a record type, a validation rule and a global value set only when asked, the value set as the org sent it', async () => {

            const entries = await readEntries({
                'objects/Account.object': ACCOUNT_OBJECT_XML,
                'globalValueSets/Account_Ratings.globalValueSet': GLOBAL_VALUE_SET_XML,
                'globalValueSets/Not_Asked.globalValueSet': GLOBAL_VALUE_SET_XML
            });

            const recordTypes = await RecipeCockpitMetadataRetrievePackage.convertToSourceFiles(entries, [{ type: 'RecordType', member: 'Account.Business' }]) ?? [];
            expect(relativePaths(recordTypes)).toEqual(['objects/Account/recordTypes/Business.recordType-meta.xml']);
            expect(recordTypes[0].content).toContain('<RecordType xmlns=');

            const rules = await RecipeCockpitMetadataRetrievePackage.convertToSourceFiles(entries, [{ type: 'ValidationRule', member: 'Account.Budget_Not_Negative' }]) ?? [];
            expect(relativePaths(rules)).toEqual(['objects/Account/validationRules/Budget_Not_Negative.validationRule-meta.xml']);
            expect(rules[0].content).toContain('<errorConditionFormula>Annual_Budget__c &lt; 0</errorConditionFormula>');

            const valueSets = await RecipeCockpitMetadataRetrievePackage.convertToSourceFiles(entries, [{ type: 'GlobalValueSet', member: 'Account_Ratings' }]) ?? [];
            expect(valueSets).toEqual([{ type: 'GlobalValueSet', fullName: 'Account_Ratings', relativeSegments: ['globalValueSets', 'Account_Ratings.globalValueSet-meta.xml'], content: GLOBAL_VALUE_SET_XML }]);

        });

        it('splits an asked-for object into every decomposed child and an object file holding what is left, for the Adapter\'s staging folder', async () => {

            const sourceFiles = await RecipeCockpitMetadataRetrievePackage.convertToSourceFiles(
                await readEntries({ 'unpackaged/objects/Account.object': ACCOUNT_OBJECT_XML }),
                [{ type: 'CustomObject', member: 'Account' }]
            ) ?? [];

            expect(relativePaths(sourceFiles)).toEqual([
                'objects/Account/Account.object-meta.xml',
                'objects/Account/fields/Annual_Budget__c.field-meta.xml',
                'objects/Account/fields/Not_Asked__c.field-meta.xml',
                'objects/Account/fields/Rating__c.field-meta.xml',
                'objects/Account/listViews/All.listView-meta.xml',
                'objects/Account/recordTypes/Business.recordType-meta.xml',
                'objects/Account/validationRules/Budget_Not_Negative.validationRule-meta.xml'
            ]);
            const objectFile = sourceFiles.find(sourceFile => sourceFile.type === 'CustomObject')?.content ?? '';
            expect(objectFile).toContain('<label>Account</label>');
            expect(objectFile).not.toContain('<fields>');
            expect(objectFile).not.toContain('<listViews>');

        });

        it('never makes a path of a child or object name that is not an api name', async () => {
            const sourceFiles = await RecipeCockpitMetadataRetrievePackage.convertToSourceFiles(
                await readEntries({ 'objects/Account.object': ACCOUNT_OBJECT_XML, 'objects/Bad Name.object': ACCOUNT_OBJECT_XML }),
                [{ type: 'CustomObject', member: 'Account' }, { type: 'CustomObject', member: 'Bad Name' }]
            ) ?? [];
            expect(sourceFiles.map(sourceFile => sourceFile.fullName)).not.toContainEqual(expect.stringContaining('Escape'));
            expect(sourceFiles.every(sourceFile => sourceFile.relativeSegments[1] === 'Account')).toBe(true);
        });

        it('gives the extension host its event loop back inside one large .object, not only between zip entries', async () => {
            const fieldElements = Array.from({ length: 450 }, (_, index) => `    <fields>\n        <fullName>Field_${index}__c</fullName>\n        <type>Text</type>\n    </fields>`);
            const entries = await readEntries({ 'objects/Account.object': `<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="${NAMESPACE}">\n${fieldElements.join('\n')}\n</CustomObject>` });
            const setImmediateSpy = jest.spyOn(global, 'setImmediate');
            const sourceFiles = await RecipeCockpitMetadataRetrievePackage.convertToSourceFiles(entries, [{ type: 'CustomObject', member: 'Account' }]) ?? [];
            expect(sourceFiles).toHaveLength(451);
            expect(setImmediateSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
        });

        it('refuses an .object that is not a <CustomObject> or not XML, and stops on a cancel', async () => {
            await expect(RecipeCockpitMetadataRetrievePackage.convertToSourceFiles(await readEntries({ 'objects/Account.object': '<Other/>' }), [field('Account.Rating__c')])).rejects.toThrow(/not a <CustomObject>/);
            await expect(RecipeCockpitMetadataRetrievePackage.convertToSourceFiles(await readEntries({ 'objects/Account.object': '<CustomObject>' }), [field('Account.Rating__c')])).rejects.toThrow(/could not be read as XML/);
            expect(await RecipeCockpitMetadataRetrievePackage.convertToSourceFiles(await readEntries({ 'objects/Account.object': ACCOUNT_OBJECT_XML }), [field('Account.Rating__c')], () => true)).toBeUndefined();
        });

    });

    describe('writeSourceFiles', () => {

        const PACKAGE_DIRECTORIES = ['force-app', 'unpackaged'];

        const convert = async (components: IMetadataDeployComponent[]) => await RecipeCockpitMetadataRetrievePackage.convertToSourceFiles(
            await readEntries({ 'objects/Account.object': ACCOUNT_OBJECT_XML, 'globalValueSets/Account_Ratings.globalValueSet': GLOBAL_VALUE_SET_XML }),
            components
        ) ?? [];

        it('writes over the project\'s own file wherever it is, matched case-insensitively, and a new one under the default package directory\'s main/default', async () => {

            const heldFieldPath = writeWorkspaceFile('unpackaged/objects/account/fields/rating__c.field-meta.xml', '<old/>');
            const heldValueSetPath = writeWorkspaceFile('unpackaged/main/globalValueSets/Account_Ratings.globalValueSet-meta.xml', '<old/>');
            fs.mkdirSync(path.join(workspaceRoot, 'force-app'));

            const fileResponses = await RecipeCockpitMetadataRetrievePackage.writeSourceFiles(
                workspaceRoot,
                { kind: 'project', packageDirectoryPaths: PACKAGE_DIRECTORIES, defaultPackageDirectoryPath: path.join(workspaceRoot, 'force-app') },
                await convert([field('Account.Rating__c'), field('Account.Annual_Budget__c'), { type: 'GlobalValueSet', member: 'Account_Ratings' }])
            );

            const newFieldPath = path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields', 'Annual_Budget__c.field-meta.xml');
            expect(fileResponses).toIncludeSameMembers([
                { fullName: 'Account.Rating__c', type: 'CustomField', state: 'Changed', filePath: heldFieldPath },
                { fullName: 'Account.Annual_Budget__c', type: 'CustomField', state: 'Created', filePath: newFieldPath },
                { fullName: 'Account_Ratings', type: 'GlobalValueSet', state: 'Changed', filePath: heldValueSetPath }
            ]);
            expect(fs.readFileSync(heldFieldPath, 'utf-8')).toContain('<fullName>Rating__c</fullName>');
            expect(fs.readFileSync(newFieldPath, 'utf-8')).toContain('<fullName>Annual_Budget__c</fullName>');
            expect(fs.readFileSync(heldValueSetPath, 'utf-8')).toBe(GLOBAL_VALUE_SET_XML);
            // NO TEMPORARY FILE IS LEFT BEHIND
            expect(fs.readdirSync(path.dirname(heldFieldPath))).toEqual(['rating__c.field-meta.xml']);

        });

        it('checks containment only for the held files it writes over, never for every file in the object\'s folders', async () => {

            const heldFieldPath = writeWorkspaceFile('force-app/main/default/objects/Account/fields/Rating__c.field-meta.xml', '<old/>');
            Array.from({ length: 30 }, (_, index) => writeWorkspaceFile(`force-app/main/default/objects/Account/fields/Untouched_${index}__c.field-meta.xml`, '<untouched/>'));
            const containmentSpy = jest.spyOn(SfdxProjectService, 'isPathContainedInWorkspace');

            await RecipeCockpitMetadataRetrievePackage.writeSourceFiles(workspaceRoot, { kind: 'project', packageDirectoryPaths: PACKAGE_DIRECTORIES, defaultPackageDirectoryPath: 'force-app' }, await convert([field('Account.Rating__c')]));

            expect(containmentSpy.mock.calls.map(([checkedPath]) => checkedPath).filter(checkedPath => /Untouched_/.test(String(checkedPath)))).toEqual([]);
            expect(containmentSpy.mock.calls.map(([checkedPath]) => checkedPath)).toContain(heldFieldPath);
            expect(fs.readFileSync(heldFieldPath, 'utf-8')).toContain('<fullName>Rating__c</fullName>');

        });

        it('leaves a destination .forceignore covers unwritten and unlisted, as the CLI does', async () => {

            writeWorkspaceFile('.forceignore', '**/Annual_Budget__c.field-meta.xml\n');

            const fileResponses = await RecipeCockpitMetadataRetrievePackage.writeSourceFiles(
                workspaceRoot,
                { kind: 'project', packageDirectoryPaths: PACKAGE_DIRECTORIES, defaultPackageDirectoryPath: 'force-app' },
                await convert([field('Account.Rating__c'), field('Account.Annual_Budget__c')])
            );

            expect(fileResponses.map(fileResponse => fileResponse.fullName)).toEqual(['Account.Rating__c']);
            expect(fs.existsSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields', 'Annual_Budget__c.field-meta.xml'))).toBe(false);

        });

        it('writes nothing through a linked folder or over a linked file, reports each as Failed, and still writes the rest', async () => {

            const outsideFolder = path.join(temporaryRoot, 'outside');
            fs.mkdirSync(outsideFolder);
            const outsideFile = path.join(temporaryRoot, 'outside.xml');
            fs.writeFileSync(outsideFile, 'outside');

            fs.mkdirSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account'), { recursive: true });
            fs.symlinkSync(outsideFolder, path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields'));
            fs.mkdirSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'recordTypes'));
            fs.symlinkSync(outsideFile, path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'recordTypes', 'Business.recordType-meta.xml'));

            const fileResponses = await RecipeCockpitMetadataRetrievePackage.writeSourceFiles(
                workspaceRoot,
                { kind: 'project', packageDirectoryPaths: PACKAGE_DIRECTORIES, defaultPackageDirectoryPath: 'force-app' },
                await convert([field('Account.Rating__c'), { type: 'RecordType', member: 'Account.Business' }, { type: 'GlobalValueSet', member: 'Account_Ratings' }])
            );

            expect(fileResponses.filter(fileResponse => fileResponse.state === 'Failed').map(fileResponse => fileResponse.fullName).sort()).toEqual(['Account.Business', 'Account.Rating__c']);
            expect(fileResponses.find(fileResponse => fileResponse.fullName === 'Account.Rating__c')?.error).toMatch(/link or not a folder/);
            expect(fileResponses.find(fileResponse => fileResponse.fullName === 'Account.Business')?.error).toMatch(/link or not a file/);
            expect(fs.readdirSync(outsideFolder)).toEqual([]);
            expect(fs.readFileSync(outsideFile, 'utf-8')).toBe('outside');
            expect(fileResponses.find(fileResponse => fileResponse.fullName === 'Account_Ratings')?.state).toBe('Created');

        });

        it('writes the Adapter\'s retrieve under its staging folder only, never over a project file', async () => {

            const heldFieldPath = writeWorkspaceFile('force-app/main/default/objects/Account/fields/Rating__c.field-meta.xml', '<old/>');
            const stagingFolderPath = path.join(workspaceRoot, 'treecipe', 'staging');
            fs.mkdirSync(stagingFolderPath, { recursive: true });

            const fileResponses = await RecipeCockpitMetadataRetrievePackage.writeSourceFiles(workspaceRoot, { kind: 'staging', stagingFolderPath: stagingFolderPath }, await convert([{ type: 'CustomObject', member: 'Account' }]));

            expect(fileResponses.every(fileResponse => fileResponse.state === 'Created' && ( fileResponse.filePath ?? '' ).startsWith(path.join(stagingFolderPath, 'main', 'default', 'objects', 'Account')))).toBe(true);
            expect(fileResponses).toHaveLength(7);
            expect(fs.readFileSync(heldFieldPath, 'utf-8')).toBe('<old/>');

        });

        it('refuses a file outside the workspace before making any folder', () => {
            expect(() => RecipeCockpitMetadataRetrievePackage.writeFileWithoutFollowingLinks(workspaceRoot, path.join(temporaryRoot, 'elsewhere', 'x.xml'), 'x')).toThrow(/outside the workspace/);
            expect(fs.existsSync(path.join(temporaryRoot, 'elsewhere'))).toBe(false);
        });

    });

    describe('toCliShapedPayload', () => {

        it('answers in the shape parseRetrieveOutput reads: written files counted, an entity the org lacks a failure named by its type and member', () => {

            const payload = RecipeCockpitMetadataRetrievePackage.toCliShapedPayload(
                RETRIEVE_ID,
                { done: 'true', success: 'true', status: 'Succeeded', messages: { fileName: 'package.xml', problem: "Entity of type 'CustomField' named 'Account.Gone__c' cannot be found" } },
                [{ fullName: 'Account.Rating__c', type: 'CustomField', state: 'Changed', filePath: '/w/Rating__c.field-meta.xml' }],
                [field('Account.Rating__c'), field('Account.Gone__c')]
            );

            expect(payload).toEqual(expect.objectContaining({ status: 0, retrieveId: RETRIEVE_ID, retrievedWith: 'jsforce' }));
            expect(RecipeCockpitMetadataRetrieve.parseRetrieveOutput('fields', { stdout: '', stderr: '', exitCode: 0 }, ['Account.Gone__c', 'Account.Rating__c'], payload)).toEqual({
                kind: 'retrieved',
                componentCount: 1,
                namesWithComponents: ['Account.Rating__c'],
                failureMessages: ["Account.Gone__c: Entity of type 'CustomField' named 'Account.Gone__c' cannot be found"]
            });

        });

        it('names a message it cannot parse by the retrieve\'s only type, and reads an unsuccessful retrieve as failed with the org\'s words', () => {

            const unparsed = RecipeCockpitMetadataRetrievePackage.toCliShapedPayload(RETRIEVE_ID, { done: true, success: true, messages: [{ fileName: 'objects/Account.object', problem: 'Something\nwent wrong' }] }, [], [{ type: 'RecordType', member: 'Account.Business' }]);
            expect(( unparsed.result as { files: unknown[] } ).files).toEqual([{ fullName: 'objects/Account.object', type: 'RecordType', state: 'Failed', problemType: 'Error', error: 'Something went wrong' }]);

            const failed = RecipeCockpitMetadataRetrievePackage.toCliShapedPayload(RETRIEVE_ID, { done: true, success: false, status: 'Failed', errorMessage: 'INVALID_SESSION_ID' }, [], [field('Account.Rating__c')]);
            expect(failed).toEqual(expect.objectContaining({ status: 1, message: 'INVALID_SESSION_ID' }));
            expect(RecipeCockpitMetadataRetrieve.parseRetrieveOutput('fields', { stdout: '', stderr: '', exitCode: 1 }, ['Account.Rating__c'], failed)).toEqual({ kind: 'failed', failureMessage: 'INVALID_SESSION_ID' });

        });

    });

    describe('runRetrieve', () => {

        let clock: number;
        const control = (overrides: Partial<Parameters<typeof RecipeCockpitMetadataRetrievePackage.runRetrieve>[2]> = {}) => ({
            isCancellationRequested: () => false,
            timeoutMilliseconds: 60000,
            pollIntervalMilliseconds: 10,
            requestWatchMilliseconds: 5,
            requestTimeoutMilliseconds: 1000,
            sleep: async (milliseconds: number) => { clock += milliseconds; await Promise.resolve(); },
            now: () => clock,
            ...overrides
        });
        const connectionWith = (statusAnswers: unknown[], retrieveAnswer: unknown = { id: RETRIEVE_ID, done: false }) => {
            const connection = {
                metadata: {
                    retrieve: jest.fn().mockImplementation(async () => retrieveAnswer),
                    checkRetrieveStatus: jest.fn().mockImplementation(async () => {
                        const answer = statusAnswers.length > 1 ? statusAnswers.shift() : statusAnswers[0];
                        if ( answer instanceof Error ) {
                            throw answer;
                        }
                        return answer;
                    })
                }
            };
            return connection as typeof connection & IMetadataRetrieveConnection;
        };

        beforeEach(() => {
            clock = 0;
        });

        it('sends the request, checks until the org says done, and answers its result', async () => {
            const connection = connectionWith([{ done: false }, { done: 'false' }, { done: 'true', success: 'true', zipFile: 'UEs=' }]);
            const request = { apiVersion: 62 };
            expect(await RecipeCockpitMetadataRetrievePackage.runRetrieve(connection, request, control())).toEqual({ kind: 'finished', retrieveId: RETRIEVE_ID, result: { done: 'true', success: 'true', zipFile: 'UEs=' } });
            expect(connection.metadata.retrieve).toHaveBeenCalledWith(request);
            expect(connection.metadata.checkRetrieveStatus).toHaveBeenCalledTimes(3);
            expect(connection.metadata.checkRetrieveStatus).toHaveBeenCalledWith(RETRIEVE_ID);
        });

        it('sends nothing on a cancel before it starts, and stops checking on a cancel while it runs', async () => {

            const notStarted = connectionWith([{ done: false }]);
            expect(await RecipeCockpitMetadataRetrievePackage.runRetrieve(notStarted, {}, control({ isCancellationRequested: () => true }))).toEqual({ kind: 'cancelled' });
            expect(notStarted.metadata.retrieve).not.toHaveBeenCalled();

            let checks = 0;
            const running = connectionWith([{ done: false }]);
            running.metadata.checkRetrieveStatus.mockImplementation(async () => { checks++; return { done: false }; });
            expect(await RecipeCockpitMetadataRetrievePackage.runRetrieve(running, {}, control({ isCancellationRequested: () => checks >= 2 }))).toEqual({ kind: 'cancelled', retrieveId: RETRIEVE_ID });
            expect(checks).toBe(2);

        });

        it('gives up on a request that never answers once cancelled, and times out a retrieve that never finishes', async () => {

            let isCancelled = false;
            const hanging = connectionWith([]);
            hanging.metadata.checkRetrieveStatus.mockImplementation(() => { isCancelled = true; return new Promise(() => undefined); });
            expect(await RecipeCockpitMetadataRetrievePackage.runRetrieve(hanging, {}, control({ isCancellationRequested: () => isCancelled }))).toEqual({ kind: 'cancelled', retrieveId: RETRIEVE_ID });

            expect(await RecipeCockpitMetadataRetrievePackage.runRetrieve(connectionWith([{ done: false }]), {}, control({ timeoutMilliseconds: 100 }))).toEqual({ kind: 'timedOut', retrieveId: RETRIEVE_ID });

        });

        it('fails, quoting no access token, when the request throws, answers no Id, or the status cannot be read three times running', async () => {

            const throwing = connectionWith([]);
            throwing.metadata.retrieve.mockRejectedValue(new Error('INVALID_SESSION_ID 00D000000000001!secretToken'));
            const thrown = await RecipeCockpitMetadataRetrievePackage.runRetrieve(throwing, {}, control());
            expect(thrown).toEqual({ kind: 'failed', failureMessage: expect.stringContaining('INVALID_SESSION_ID') });
            expect(JSON.stringify(thrown)).not.toContain('secretToken');

            expect(await RecipeCockpitMetadataRetrievePackage.runRetrieve(connectionWith([], { id: 'not an id' }), {}, control())).toEqual({ kind: 'failed', failureMessage: 'The org did not answer the retrieve request with a retrieve Id.' });

            const unreadable = connectionWith([new Error('socket hang up')]);
            expect(await RecipeCockpitMetadataRetrievePackage.runRetrieve(unreadable, {}, control())).toEqual({ kind: 'failed', retrieveId: RETRIEVE_ID, failureMessage: expect.stringContaining('socket hang up') });
            expect(unreadable.metadata.checkRetrieveStatus).toHaveBeenCalledTimes(METADATA_RETRIEVE_STATUS_CHECK_ATTEMPTS);

            const recovering = connectionWith([new Error('blip'), { done: true, success: true }]);
            expect(( await RecipeCockpitMetadataRetrievePackage.runRetrieve(recovering, {}, control()) ).kind).toBe('finished');

        });

    });

});
