import * as fs from 'fs';

import * as os from 'os';
import * as path from 'path';

// THE MODULE IMPORTS NO vscode ITSELF; THE CLI HELPER IT SHARES WITH THE OTHER RETRIEVES DOES, THROUGH ITS OWN IMPORTS
jest.mock('vscode', () => ({ workspace: { getConfiguration: jest.fn() }, window: {} }), { virtual: true });

import { IComparedField, RecipeCockpitOrgChangeDetection } from '../RecipeCockpitOrgChangeDetection';
import { SfdxProjectService } from '../../SfdxProjectService/SfdxProjectService';

const WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'orgChangeWorkspace');
const STAGING_FOLDER_PATH = path.join(WORKSPACE_ROOT, 'treecipe', 'OrgOperations', 'qa@example.com.qa', '20261023-100000-adapter-retrieve');
const PACKAGE_DIRECTORY_PATHS = ['force-app', 'unpackaged'];

const detect = (objectApiNames: string[], workspaceRoot = WORKSPACE_ROOT, stagingFolderPath = STAGING_FOLDER_PATH) =>
    RecipeCockpitOrgChangeDetection.detectFieldChanges(workspaceRoot, PACKAGE_DIRECTORY_PATHS, stagingFolderPath, objectApiNames);

describe('RecipeCockpitOrgChangeDetection (#445)', () => {

    it('imports no vscode', () => {

        const source = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitOrgChangeDetection.ts'), 'utf8');
        expect(source).not.toMatch(/from 'vscode'/);

    });

    describe('detectFieldChanges', () => {

        it('lists a custom field the project lacks as new and a field whose XML differs as changed, new first, each by name', async () => {

            const [accountChanges] = await detect(['Account']);

            expect(accountChanges.objectApiName).toBe('Account');
            expect(accountChanges.isRetrieved).toBe(true);
            expect(accountChanges.fieldChanges.map(fieldChange => [fieldChange.fieldApiName, fieldChange.status])).toEqual([
                ['Is_Priority__c', 'new'],
                ['Legacy_Code__c', 'changed'],
                ['Rating__c', 'changed']
            ]);
            expect(accountChanges.fieldChanges[0]).toMatchObject({ fieldType: 'Checkbox', fieldLabel: 'Is Priority', differences: [] });

        });

        it('orders several new and changed fields new first, each by name', async () => {

            const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-org-change-'));
            try {
                const workspaceRoot = path.join(temporaryRoot, 'workspace');
                fs.cpSync(WORKSPACE_ROOT, workspaceRoot, { recursive: true });
                const stagingFolderPath = path.join(workspaceRoot, path.relative(WORKSPACE_ROOT, STAGING_FOLDER_PATH));
                const stagedFieldsFolder = path.join(stagingFolderPath, 'main', 'default', 'objects', 'Account', 'fields');
                ['Zebra__c', 'Aardvark__c'].forEach(fieldApiName => fs.writeFileSync(path.join(stagedFieldsFolder, `${fieldApiName}.field-meta.xml`), `<CustomField><type>Text</type><label>${fieldApiName}</label></CustomField>`));

                const [accountChanges] = await detect(['Account'], workspaceRoot, stagingFolderPath);

                expect(accountChanges.fieldChanges.map(fieldChange => fieldChange.fieldApiName)).toEqual(['Aardvark__c', 'Is_Priority__c', 'Zebra__c', 'Legacy_Code__c', 'Rating__c']);
            } finally {
                fs.rmSync(temporaryRoot, { recursive: true, force: true });
            }

        });

        it('says what changed, one line per difference', async () => {

            const [accountChanges] = await detect(['Account']);
            const differencesOf = (fieldApiName: string) => accountChanges.fieldChanges.find(fieldChange => fieldChange.fieldApiName === fieldApiName)!.differences;

            expect(differencesOf('Legacy_Code__c')).toEqual(['length: 80 → 255', 'required: false → true']);
            expect(differencesOf('Rating__c')).toEqual(['picklist values added: Frozen', 'picklist values removed: Cold']);

        });

        it('counts a field held the same in a second package directory as unchanged, and never lists a standard field the project lacks as new', async () => {

            const [accountChanges] = await detect(['Account']);

            // Name and Second_Dir__c are the same; Site is a standard field only the org's files carry
            expect(accountChanges.unchangedFieldCount).toBe(2);
            expect(accountChanges.fieldChanges.map(fieldChange => fieldChange.fieldApiName)).not.toContain('Site');

        });

        it('counts a field file either side cannot read, rather than calling it new or changed', async () => {

            const [contactChanges] = await detect(['Contact']);

            expect(contactChanges.fieldChanges).toEqual([
                { fieldApiName: 'Email_Opt_In__c', status: 'new', fieldType: 'Checkbox', fieldLabel: 'Email_Opt_In__c', differences: [] }
            ]);
            expect(contactChanges.unreadableFieldCount).toBe(2);

        });

        it('says an object the retrieve did not bring was not retrieved, in the order asked', async () => {

            const objectChanges = await detect(['OtherChildObject__c', 'Account']);

            expect(objectChanges.map(objectChange => [objectChange.objectApiName, objectChange.isRetrieved])).toEqual([['OtherChildObject__c', false], ['Account', true]]);
            expect(objectChanges[0].fieldChanges).toEqual([]);

        });

        it('follows no link: a linked fields folder or field file is not read', async () => {

            const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-org-change-'));
            try {
                const workspaceRoot = path.join(temporaryRoot, 'workspace');
                fs.cpSync(WORKSPACE_ROOT, workspaceRoot, { recursive: true });
                const stagingFolderPath = path.join(workspaceRoot, path.relative(WORKSPACE_ROOT, STAGING_FOLDER_PATH));
                const outsideFolderPath = path.join(temporaryRoot, 'outside');
                fs.mkdirSync(outsideFolderPath);
                fs.writeFileSync(path.join(outsideFolderPath, 'Outside__c.field-meta.xml'), '<CustomField><type>Text</type></CustomField>');

                const stagedContactFolder = path.join(stagingFolderPath, 'main', 'default', 'objects', 'Contact');
                fs.rmSync(path.join(stagedContactFolder, 'fields'), { recursive: true });
                fs.symlinkSync(outsideFolderPath, path.join(stagedContactFolder, 'fields'));
                fs.symlinkSync(path.join(outsideFolderPath, 'Outside__c.field-meta.xml'), path.join(stagingFolderPath, 'main', 'default', 'objects', 'Account', 'fields', 'Linked__c.field-meta.xml'));

                const [accountChanges, contactChanges] = await detect(['Account', 'Contact'], workspaceRoot, stagingFolderPath);

                expect(contactChanges.fieldChanges).toEqual([]);
                expect(accountChanges.fieldChanges.map(fieldChange => fieldChange.fieldApiName)).not.toContain('Linked__c');
            } finally {
                fs.rmSync(temporaryRoot, { recursive: true, force: true });
            }

        });

        it('counts as unreadable a field file that is too large, has another root, or cannot be opened', async () => {

            const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-org-change-'));
            try {
                const workspaceRoot = path.join(temporaryRoot, 'workspace');
                fs.cpSync(WORKSPACE_ROOT, workspaceRoot, { recursive: true });
                const stagingFolderPath = path.join(workspaceRoot, path.relative(WORKSPACE_ROOT, STAGING_FOLDER_PATH));
                const stagedFieldsFolder = path.join(stagingFolderPath, 'main', 'default', 'objects', 'Account', 'fields');
                fs.writeFileSync(path.join(stagedFieldsFolder, 'Huge__c.field-meta.xml'), '<CustomField>' + 'x'.repeat(1024 * 1024) + '</CustomField>');
                fs.writeFileSync(path.join(stagedFieldsFolder, 'Other_Root__c.field-meta.xml'), '<CustomObject><type>Text</type></CustomObject>');
                const realOpenSync = fs.openSync;
                jest.spyOn(fs, 'openSync').mockImplementation(((filePath: fs.PathLike, ...rest: any[]) => {
                    if ( String(filePath).endsWith('Second_Dir__c.field-meta.xml') && String(filePath).includes('adapter-retrieve') ) {
                        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
                    }
                    return (realOpenSync as any)(filePath, ...rest);
                }) as any);

                const [accountChanges] = await detect(['Account'], workspaceRoot, stagingFolderPath);

                expect(accountChanges.unreadableFieldCount).toBe(3);
                expect(accountChanges.fieldChanges.map(fieldChange => fieldChange.fieldApiName)).toEqual(['Is_Priority__c', 'Legacy_Code__c', 'Rating__c']);
            } finally {
                fs.rmSync(temporaryRoot, { recursive: true, force: true });
            }

        });

    });

    describe('compareFields', () => {

        const field = (overrides: Partial<IComparedField> = {}): IComparedField => ({
            fieldType: 'Number', fieldLabel: 'Amount', length: '', precision: '18', scale: '2', required: 'false', referenceTo: '', valueSetName: '', picklistValues: [], ...overrides
        });

        it('says nothing differs for the same field, whatever its label', () => {

            expect(RecipeCockpitOrgChangeDetection.compareFields(field(), field({ fieldLabel: 'Renamed' }))).toEqual([]);

        });

        it('names each difference in a fixed order, an empty value as none', () => {

            expect(RecipeCockpitOrgChangeDetection.compareFields(
                field({ fieldType: 'Text', length: '80', precision: '', scale: '' }),
                field({ fieldType: 'Lookup', length: '', precision: '', scale: '', referenceTo: 'Account', valueSetName: 'Regions' })
            )).toEqual(['type: Text → Lookup', 'length: 80 → none', 'lookup to: none → Account', 'value set: none → Regions']);

        });

        it('lists at most five picklist values added or removed, and counts the rest', () => {

            const localValues = ['a', 'b'];
            const stagedValues = ['a', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];

            expect(RecipeCockpitOrgChangeDetection.compareFields(field({ picklistValues: localValues }), field({ picklistValues: stagedValues })))
                .toEqual(['picklist values added: c, d, e, f, g and 2 more', 'picklist values removed: b']);

        });

    });

    describe('the retrieve', () => {

        it('writes no version when none is given', () => {

            expect(RecipeCockpitOrgChangeDetection.buildObjectRetrievePackageXml(['Account'])).not.toContain('<version>');

        });

        it('names every object, standard ones included, as a CustomObject member once, sorted', () => {

            expect(RecipeCockpitOrgChangeDetection.buildObjectRetrievePackageXml(['Contact', 'Account', 'Contact', 'Widget__c'], '62.0')).toBe([
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
                '    <types>',
                '        <members>Account</members>',
                '        <members>Contact</members>',
                '        <members>Widget__c</members>',
                '        <name>CustomObject</name>',
                '    </types>',
                '    <version>62.0</version>',
                '</Package>',
                ''
            ].join('\n'));

        });

        it('refuses a name that is not an api name, or no name at all', () => {

            expect(() => RecipeCockpitOrgChangeDetection.buildObjectRetrievePackageXml(['Account</members><members>*'])).toThrow('is not an object api name');
            expect(() => RecipeCockpitOrgChangeDetection.buildObjectRetrievePackageXml([])).toThrow('No object was named');

        });

        it('stages under treecipe/OrgOperations/<username>/, the package.xml beside it, and refuses a folder name that could be another folder', () => {

            const stagingFolderPath = RecipeCockpitOrgChangeDetection.buildStagingFolderPath('/workspace', 'qa@example.com.qa', new Date(2026, 9, 23, 10, 0, 0));

            expect(stagingFolderPath).toBe(path.join('/workspace', 'treecipe', 'OrgOperations', 'qa@example.com.qa', '20261023-100000-adapter-retrieve'));
            expect(RecipeCockpitOrgChangeDetection.buildPackageXmlFilePath(stagingFolderPath!)).toBe(`${stagingFolderPath}-package.xml`);
            expect(RecipeCockpitOrgChangeDetection.buildStagingFolderPath('/workspace', '..', new Date())).toBeUndefined();
            expect(RecipeCockpitOrgChangeDetection.buildStagingFolderPath('/workspace', 'a/b', new Date())).toBeUndefined();

        });

        it('retrieves into the staging folder only, never a package directory', () => {

            expect(RecipeCockpitOrgChangeDetection.buildRetrieveArguments('treecipe/OrgOperations/qa/1-adapter-retrieve-package.xml', 'treecipe/OrgOperations/qa/1-adapter-retrieve', 'qa@example.com.qa')).toEqual([
                'project', 'retrieve', 'start', '--json', '--target-org', 'qa@example.com.qa',
                '--manifest', 'treecipe/OrgOperations/qa/1-adapter-retrieve-package.xml',
                '--output-dir', 'treecipe/OrgOperations/qa/1-adapter-retrieve'
            ]);
            expect(() => RecipeCockpitOrgChangeDetection.buildRetrieveArguments('treecipe/OrgOperations/qa/1-adapter-retrieve-package.xml', 'force-app', 'qa@example.com.qa')).toThrow('not under treecipe/');
            expect(() => RecipeCockpitOrgChangeDetection.buildRetrieveArguments('treecipe/OrgOperations/qa/1-adapter-retrieve-package.xml', '--output-dir=force-app', 'qa@example.com.qa')).toThrow();

        });

        it('holds --output-dir to a plain path under treecipe/ in the workspace', () => {

            expect(RecipeCockpitOrgChangeDetection.toOutputDirectoryArgument('/workspace', path.join('/workspace', 'treecipe', 'OrgOperations', 'qa', 'x'))).toBe('treecipe/OrgOperations/qa/x');
            expect(() => RecipeCockpitOrgChangeDetection.toOutputDirectoryArgument('/workspace', path.join('/workspace', 'force-app'))).toThrow();
            expect(() => RecipeCockpitOrgChangeDetection.toOutputDirectoryArgument('/workspace', '/elsewhere/treecipe')).toThrow();

        });

        it('makes a new staging folder each time, the next free name when one is there', () => {

            const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-org-change-'));
            try {
                const plannedFolderPath = RecipeCockpitOrgChangeDetection.buildStagingFolderPath(temporaryRoot, 'qa@example.com.qa', new Date())!;
                expect(RecipeCockpitOrgChangeDetection.makeStagingFolder(temporaryRoot, plannedFolderPath)).toBe(plannedFolderPath);
                expect(fs.statSync(plannedFolderPath).isDirectory()).toBe(true);
                expect(fs.readFileSync(path.join(temporaryRoot, 'treecipe', 'OrgOperations', '.gitignore'), 'utf-8')).toBe('*\n');
                expect(RecipeCockpitOrgChangeDetection.makeStagingFolder(temporaryRoot, plannedFolderPath)).toBe(`${plannedFolderPath}-2`);
            } finally {
                fs.rmSync(temporaryRoot, { recursive: true, force: true });
            }

        });

        it('makes no staging folder and plans none when the workspace check refuses the path', () => {

            const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-org-change-'));
            try {
                const plannedFolderPath = RecipeCockpitOrgChangeDetection.buildStagingFolderPath(temporaryRoot, 'qa@example.com.qa', new Date())!;
                jest.spyOn(SfdxProjectService, 'isPathContainedInWorkspace').mockReturnValue(false);
                expect(RecipeCockpitOrgChangeDetection.buildStagingFolderPath(temporaryRoot, 'qa@example.com.qa', new Date())).toBeUndefined();
                expect(RecipeCockpitOrgChangeDetection.makeStagingFolder(temporaryRoot, plannedFolderPath)).toBeUndefined();
            } finally {
                fs.rmSync(temporaryRoot, { recursive: true, force: true });
            }

        });

        it('makes no staging folder when its parent cannot be made, when making it fails, or when every name is taken', () => {

            const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-org-change-'));
            try {
                fs.writeFileSync(path.join(temporaryRoot, 'treecipe'), 'a file where the folder would be');
                expect(RecipeCockpitOrgChangeDetection.makeStagingFolder(temporaryRoot, path.join(temporaryRoot, 'treecipe', 'OrgOperations', 'qa', 'x'))).toBeUndefined();
                fs.rmSync(path.join(temporaryRoot, 'treecipe'));

                const plannedFolderPath = RecipeCockpitOrgChangeDetection.buildStagingFolderPath(temporaryRoot, 'qa@example.com.qa', new Date())!;
                const realMkdirSync = fs.mkdirSync;
                const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(((folderPath: fs.PathLike, options?: any) => {
                    if ( options?.recursive ) { return (realMkdirSync as any)(folderPath, options); }
                    throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
                }) as any);
                expect(RecipeCockpitOrgChangeDetection.makeStagingFolder(temporaryRoot, plannedFolderPath)).toBeUndefined();

                mkdirSpy.mockImplementation(((folderPath: fs.PathLike, options?: any) => {
                    if ( options?.recursive ) { return (realMkdirSync as any)(folderPath, options); }
                    throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
                }) as any);
                expect(RecipeCockpitOrgChangeDetection.makeStagingFolder(temporaryRoot, plannedFolderPath)).toBeUndefined();
            } finally {
                fs.rmSync(temporaryRoot, { recursive: true, force: true });
            }

        });

        it.each([
            ['a success', { stdout: '', stderr: '', exitCode: 0 }, { status: 0, result: { success: true } }, { isSucceeded: true }],
            ['no CLI', { stdout: '', stderr: '', exitCode: null, spawnError: Object.assign(new Error('x'), { code: 'ENOENT' }) }, undefined, { isSucceeded: false, failureMessage: expect.stringContaining('could not be run') }],
            ['a timeout', { stdout: '', stderr: '', exitCode: 1, timedOut: true }, undefined, { isSucceeded: false, failureMessage: 'The retrieve did not finish in time.' }],
            ['a failure with a message', { stdout: '', stderr: '', exitCode: 1 }, { status: 1, message: 'INVALID_SESSION_ID\nline two' }, { isSucceeded: false, failureMessage: 'INVALID_SESSION_ID line two' }],
            ['an answer that is not JSON', { stdout: 'oops', stderr: '', exitCode: 1 }, undefined, { isSucceeded: false, failureMessage: 'The org did not confirm the retrieve.' }],
            ['a success the result does not confirm', { stdout: '', stderr: '', exitCode: 0 }, { status: 0, result: { success: 'yes' } }, { isSucceeded: false, failureMessage: 'The org did not confirm the retrieve.' }]
        ])('reads %s', (_description, invocation, payload, expected) => {

            expect(RecipeCockpitOrgChangeDetection.readRetrieveSucceeded(invocation as any, payload as any)).toEqual(expected);

        });

    });

    describe('applying the retrieved files', () => {

        const withWorkspaceCopy = async (runTest: (workspaceRoot: string, stagingFolderPath: string) => Promise<void> | void) => {
            const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-org-change-apply-'));
            try {
                const workspaceRoot = path.join(temporaryRoot, 'workspace');
                fs.cpSync(WORKSPACE_ROOT, workspaceRoot, { recursive: true });
                await runTest(workspaceRoot, path.join(workspaceRoot, path.relative(WORKSPACE_ROOT, STAGING_FOLDER_PATH)));
            } finally {
                fs.rmSync(temporaryRoot, { recursive: true, force: true });
            }
        };

        const relativeTargets = (workspaceRoot: string, fieldFileCopies: { status: string; targetFilePath: string }[]) =>
            fieldFileCopies.map(fieldFileCopy => [fieldFileCopy.status, path.relative(workspaceRoot, fieldFileCopy.targetFilePath).split(path.sep).join('/')]);

        it('plans a changed field over the project file it was compared with, and a new one into the default package directory', async () => {

            await withWorkspaceCopy(async (workspaceRoot, stagingFolderPath) => {
                const fieldFileCopies = await RecipeCockpitOrgChangeDetection.planFieldFileCopies(workspaceRoot, PACKAGE_DIRECTORY_PATHS, 'unpackaged', stagingFolderPath, ['Account', 'Contact']);

                expect(relativeTargets(workspaceRoot, fieldFileCopies)).toEqual([
                    ['new', 'unpackaged/main/default/objects/Account/fields/Is_Priority__c.field-meta.xml'],
                    ['changed', 'force-app/main/default/objects/Account/fields/Legacy_Code__c.field-meta.xml'],
                    ['changed', 'force-app/main/default/objects/Account/fields/Rating__c.field-meta.xml'],
                    ['new', 'unpackaged/main/default/objects/Contact/fields/Email_Opt_In__c.field-meta.xml']
                ]);
                expect(fieldFileCopies.every(fieldFileCopy => fieldFileCopy.stagedFilePath.startsWith(stagingFolderPath))).toBe(true);
            });

        });

        it('copies each planned file byte for byte, after which nothing is new or changed', async () => {

            await withWorkspaceCopy(async (workspaceRoot, stagingFolderPath) => {
                const fieldFileCopies = await RecipeCockpitOrgChangeDetection.planFieldFileCopies(workspaceRoot, PACKAGE_DIRECTORY_PATHS, path.join(workspaceRoot, 'force-app'), stagingFolderPath, ['Account']);

                expect(RecipeCockpitOrgChangeDetection.copyFieldFiles(workspaceRoot, fieldFileCopies)).toEqual({ copiedCount: 3, failures: [] });
                fieldFileCopies.forEach(fieldFileCopy => expect(fs.readFileSync(fieldFileCopy.targetFilePath, 'utf-8')).toBe(fs.readFileSync(fieldFileCopy.stagedFilePath, 'utf-8')));
                expect(fs.readdirSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields')).filter(fileName => fileName.endsWith('.tmp'))).toEqual([]);

                const [accountChanges] = await detect(['Account'], workspaceRoot, stagingFolderPath);
                expect(accountChanges.fieldChanges).toEqual([]);
            });

        });

        it('writes through no link and outside no workspace, names each file it could not write, and carries on', async () => {

            await withWorkspaceCopy(async (workspaceRoot, stagingFolderPath) => {
                const outsideFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-org-change-outside-'));
                try {
                    const linkedTarget = path.join(workspaceRoot, 'force-app', 'linked.field-meta.xml');
                    fs.symlinkSync(path.join(outsideFolder, 'target.xml'), linkedTarget);
                    const linkedFolder = path.join(workspaceRoot, 'force-app', 'linkedFolder');
                    fs.symlinkSync(outsideFolder, linkedFolder, 'dir');
                    const stagedFilePath = path.join(stagingFolderPath, 'main', 'default', 'objects', 'Account', 'fields', 'Is_Priority__c.field-meta.xml');

                    const copyResult = RecipeCockpitOrgChangeDetection.copyFieldFiles(workspaceRoot, [
                        { objectApiName: 'Account', fieldApiName: 'Gone__c', status: 'new', stagedFilePath: path.join(stagingFolderPath, 'missing.field-meta.xml'), targetFilePath: path.join(workspaceRoot, 'force-app', 'x.field-meta.xml') },
                        { objectApiName: 'Account', fieldApiName: 'Linked__c', status: 'changed', stagedFilePath: stagedFilePath, targetFilePath: linkedTarget },
                        { objectApiName: 'Account', fieldApiName: 'Outside__c', status: 'new', stagedFilePath: stagedFilePath, targetFilePath: path.join(outsideFolder, 'new', 'Outside__c.field-meta.xml') },
                        { objectApiName: 'Account', fieldApiName: 'ThroughLink__c', status: 'new', stagedFilePath: stagedFilePath, targetFilePath: path.join(linkedFolder, 'deeper', 'ThroughLink__c.field-meta.xml') },
                        { objectApiName: 'Account', fieldApiName: 'Is_Priority__c', status: 'new', stagedFilePath: stagedFilePath, targetFilePath: path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields', 'Is_Priority__c.field-meta.xml') }
                    ]);

                    expect(copyResult.copiedCount).toBe(1);
                    expect(copyResult.failures).toEqual([
                        'Account.Gone__c: the retrieved file could not be read',
                        'Account.Linked__c: the project file is not a plain file, so it was left as it is',
                        'Account.Outside__c: its folder is not inside this workspace',
                        'Account.ThroughLink__c: its folder is not inside this workspace'
                    ]);
                    expect(fs.readdirSync(outsideFolder)).toEqual([]);
                    expect(fs.lstatSync(linkedTarget).isSymbolicLink()).toBe(true);
                } finally {
                    fs.rmSync(outsideFolder, { recursive: true, force: true });
                }
            });

        });

        it('refuses a folder that leads out of the workspace once it is made, and names a thrown value that is not an error', async () => {

            await withWorkspaceCopy(async (workspaceRoot, stagingFolderPath) => {
                const stagedFilePath = path.join(stagingFolderPath, 'main', 'default', 'objects', 'Account', 'fields', 'Is_Priority__c.field-meta.xml');
                const targetFilePath = path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields', 'Is_Priority__c.field-meta.xml');
                const containmentSpy = jest.spyOn(SfdxProjectService, 'isPathContainedInWorkspace').mockReturnValueOnce(true).mockReturnValueOnce(false);

                expect(RecipeCockpitOrgChangeDetection.copyFieldFiles(workspaceRoot, [{ objectApiName: 'Account', fieldApiName: 'Is_Priority__c', status: 'new', stagedFilePath, targetFilePath }]))
                    .toEqual({ copiedCount: 0, failures: ['Account.Is_Priority__c: its folder is not inside this workspace'] });

                containmentSpy.mockRestore();
                const thrownValue: unknown = 'disk full';
                jest.spyOn(fs, 'renameSync').mockImplementation(() => { throw thrownValue; });
                expect(RecipeCockpitOrgChangeDetection.copyFieldFiles(workspaceRoot, [{ objectApiName: 'Account', fieldApiName: 'Is_Priority__c', status: 'new', stagedFilePath, targetFilePath }]))
                    .toEqual({ copiedCount: 0, failures: ['Account.Is_Priority__c: disk full'] });
            });

        });

        it('names the error of a write that fails, leaving no temporary file', async () => {

            await withWorkspaceCopy(async (workspaceRoot, stagingFolderPath) => {
                const stagedFilePath = path.join(stagingFolderPath, 'main', 'default', 'objects', 'Account', 'fields', 'Is_Priority__c.field-meta.xml');
                const targetFilePath = path.join(workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Account', 'fields', 'Is_Priority__c.field-meta.xml');
                jest.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('EPERM: rename\nrefused'); });

                const copyResult = RecipeCockpitOrgChangeDetection.copyFieldFiles(workspaceRoot, [{ objectApiName: 'Account', fieldApiName: 'Is_Priority__c', status: 'new', stagedFilePath, targetFilePath }]);

                expect(copyResult).toEqual({ copiedCount: 0, failures: ['Account.Is_Priority__c: EPERM: rename refused'] });
                expect(fs.readdirSync(path.dirname(targetFilePath)).filter(fileName => fileName.endsWith('.tmp'))).toEqual([]);
            });

        });

    });

    describe('the hints', () => {

        const treeObjectNames = [{ objectApiName: 'Account', objectLabel: 'Account' }, { objectApiName: 'Gadget__c', objectLabel: 'Gadget (Lab)' }];

        it('lists source tracking rows naming a tree object, as Salesforce reads names, and counts what it cannot read', () => {

            const hintList = RecipeCockpitOrgChangeDetection.parseSourceMembers({ records: [
                { MemberType: 'CustomField', MemberName: 'account.Rating__c', RevisionCounter: 9, LastModifiedDate: '2026-10-20T08:15:00.000+0000' },
                { MemberType: 'CustomObject', MemberName: 'Gadget__c', LastModifiedDate: 'yesterday' },
                { MemberType: 'CustomField', MemberName: 'Case.Origin__c' },
                { MemberType: 'ApexClass', MemberName: 'Account' },
                { MemberType: 'CustomField', MemberName: 'Account.Bad Name' },
                { MemberType: 'CustomField', MemberName: 'Account..x' },
                { MemberType: 'CustomField' },
                null
            ] }, treeObjectNames);

            expect(hintList).toEqual({
                rows: [
                    { objectApiName: 'Account', text: 'CustomField account.Rating__c', changedAt: '2026-10-20T08:15:00.000+0000' },
                    { objectApiName: 'Gadget__c', text: 'CustomObject Gadget__c', changedAt: '' }
                ],
                moreCount: 0,
                skippedCount: 5
            });

        });

        it('lists audit trail rows naming a tree object by api name or label as a whole word, and ignores the rest', () => {

            const hintList = RecipeCockpitOrgChangeDetection.parseSetupAuditTrail({ records: [
                { Display: 'Created custom field Tier (Picklist) on Account', CreatedDate: '2026-10-21T09:00:00Z', CreatedBy: { Name: 'Ada\nLovelace' } },
                { Display: 'Changed Gadget (Lab) page layout', CreatedDate: 'nope' },
                { Display: 'Changed Accounts settings' },
                { Display: 'Created custom field on Opportunity' },
                { Display: '' },
                { Section: 'Manage Users' },
                null
            ] }, treeObjectNames);

            expect(hintList).toEqual({
                rows: [
                    { objectApiName: 'Account', text: 'Created custom field Tier (Picklist) on Account · Ada Lovelace', changedAt: '2026-10-21T09:00:00Z' },
                    { objectApiName: 'Gadget__c', text: 'Changed Gadget (Lab) page layout', changedAt: '' }
                ],
                moreCount: 0,
                skippedCount: 3
            });

        });

        it('keeps the first rows past its limit and counts the rest', () => {

            const records = Array.from({ length: 53 }, (_unused, index) => ({ MemberType: 'CustomField', MemberName: `Account.Field_${index}__c` }));
            const hintList = RecipeCockpitOrgChangeDetection.parseSourceMembers({ records }, treeObjectNames);

            expect(hintList.rows).toHaveLength(50);
            expect(hintList.rows[0].text).toBe('CustomField Account.Field_0__c');
            expect(hintList.moreCount).toBe(3);

        });

        it('throws on an answer with no records list, which the reader turns into a note', () => {

            expect(() => RecipeCockpitOrgChangeDetection.parseSourceMembers({ totalSize: 1 }, treeObjectNames)).toThrow('no records list');
            expect(() => RecipeCockpitOrgChangeDetection.parseSetupAuditTrail('nope', treeObjectNames)).toThrow('no records list');

        });

        it('reads each hint on its own query, and a failed one is a note naming only a plain error code', async () => {

            const toolingQuery = jest.fn().mockRejectedValue(Object.assign(new Error('sObject type SourceMember is not supported'), { errorCode: 'INVALID_TYPE' }));
            const query = jest.fn().mockResolvedValue({ records: [{ Display: 'Changed Account field Rating' }] });

            const hints = await RecipeCockpitOrgChangeDetection.readChangeHints({ query, toolingQuery }, treeObjectNames);

            expect(toolingQuery).toHaveBeenCalledWith(expect.stringMatching(/^SELECT MemberType, MemberName, RevisionCounter, LastModifiedDate FROM SourceMember /));
            expect(query).toHaveBeenCalledWith(expect.stringMatching(/FROM SetupAuditTrail WHERE CreatedDate = LAST_N_DAYS:180 /));
            expect(hints.sourceTracking).toEqual({ rows: [], moreCount: 0, skippedCount: 0, note: expect.stringContaining('does not track source') });
            expect(hints.auditTrail.rows).toHaveLength(1);

            const failingHints = await RecipeCockpitOrgChangeDetection.readChangeHints({
                query: jest.fn().mockRejectedValue(Object.assign(new Error('token 00Dxx!secret'), { errorCode: 'INSUFFICIENT_ACCESS' })),
                toolingQuery: jest.fn().mockResolvedValue({ size: 0 })
            }, treeObjectNames);

            expect(failingHints.sourceTracking.note).toBe('Source tracking could not be read. The marks come from the files alone.');
            expect(failingHints.auditTrail.note).toBe('The setup audit trail could not be read (INSUFFICIENT_ACCESS). The user may lack View Setup and Configuration.');
            expect(JSON.stringify(failingHints)).not.toContain('secret');

            const thrownValueHints = await RecipeCockpitOrgChangeDetection.readChangeHints({
                query: jest.fn().mockRejectedValue('refused'),
                toolingQuery: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { errorCode: 'not a code' }))
            }, treeObjectNames);
            expect(thrownValueHints.auditTrail.note).toBe('The setup audit trail could not be read. The user may lack View Setup and Configuration.');
            expect(thrownValueHints.sourceTracking.note).toBe('Source tracking could not be read. The marks come from the files alone.');

        });

    });

    describe('listNewChildObjects', () => {

        it('lists each object\'s custom child objects the tree lacks, once each, sorted, and leaves out an object with none', () => {

            const newChildObjectsByObject = RecipeCockpitOrgChangeDetection.listNewChildObjects([
                { objectApiName: 'Account', childRelationships: [
                    { childObjectApiName: 'Zeta__c', fieldApiName: 'Account__c' },
                    { childObjectApiName: 'Alpha__c', fieldApiName: 'Second_Account__c' },
                    { childObjectApiName: 'Zeta__c', fieldApiName: 'Beta_Account__c' },
                    { childObjectApiName: 'Alpha__c', fieldApiName: 'Third_Account__c' },
                    { childObjectApiName: 'Alpha__c', fieldApiName: 'Account__c' },
                    { childObjectApiName: 'alpha__c', fieldApiName: 'account__c' },
                    { childObjectApiName: 'Contact', fieldApiName: 'AccountId' },
                    { childObjectApiName: 'gadget__c', fieldApiName: 'Account__c' },
                    { childObjectApiName: 'Bad Name__c', fieldApiName: 'Account__c' }
                ] },
                { objectApiName: 'Gadget__c', childRelationships: [] },
                { objectApiName: 'Contact' }
            ], ['Account', 'Gadget__c', 'Contact']);

            expect([...newChildObjectsByObject.entries()]).toEqual([
                ['Account', { childObjects: [
                    { childObjectApiName: 'Alpha__c', fieldApiName: 'Account__c' },
                    { childObjectApiName: 'Alpha__c', fieldApiName: 'Second_Account__c' },
                    { childObjectApiName: 'Alpha__c', fieldApiName: 'Third_Account__c' },
                    { childObjectApiName: 'Zeta__c', fieldApiName: 'Account__c' },
                    { childObjectApiName: 'Zeta__c', fieldApiName: 'Beta_Account__c' }
                ], moreCount: 0 }]
            ]);

        });

        it('lists at most its limit and counts the rest', () => {

            const childRelationships = Array.from({ length: 103 }, (_unused, index) => ({ childObjectApiName: `Child_${String(index).padStart(3, '0')}__c`, fieldApiName: 'Account__c' }));
            const { childObjects, moreCount } = RecipeCockpitOrgChangeDetection.listNewChildObjects([{ objectApiName: 'Account', childRelationships }], ['Account']).get('Account')!;

            expect(childObjects).toHaveLength(100);
            expect(moreCount).toBe(3);

        });

    });

});
