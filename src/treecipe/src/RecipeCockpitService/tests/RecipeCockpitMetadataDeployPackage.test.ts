import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as xml2js from 'xml2js';

// THE MODULE IMPORTS NO vscode; THE CLI SERVICE IT SHARES WITH THE OTHER RUNS DOES, THROUGH ITS OWN IMPORTS
jest.mock('vscode', () => ({}), { virtual: true });
// AN INDEPENDENT READER: jszip COMES WITH @salesforce/core AND IS ONLY EVER USED HERE, TO CHECK THE ZIP THIS EXTENSION WRITES
import JSZip = require('jszip');

import {
    IMetadataDeployConnection,
    METADATA_DEPLOY_DEFAULT_METHOD,
    METADATA_DEPLOY_JSFORCE_OPTIONS,
    METADATA_DEPLOY_STATUS_CHECK_ATTEMPTS,
    RecipeCockpitMetadataDeployPackage
} from '../RecipeCockpitMetadataDeployPackage';
import { IMetadataDeployComponent, RecipeCockpitMetadataDeploy } from '../RecipeCockpitMetadataDeploy';
import { ScratchOrgService } from '../../ScratchOrgService/ScratchOrgService';

const METADATA_DEPLOY_WORKSPACE_ROOT = path.join(__dirname, 'mocks', 'metadataDeployWorkspace');
const OBJECTS_PATH = path.join('force-app', 'main', 'default', 'objects');

const FIELD_COMPONENTS: IMetadataDeployComponent[] = [
    { type: 'CustomField', member: 'Account.Rating__c' },
    { type: 'CustomField', member: 'Account.Annual_Budget__c' },
    { type: 'CustomField', member: 'OtherChildObject__c.Score__c' },
    { type: 'CustomObject', member: 'OtherChildObject__c' }
];

const EVERY_TYPE_COMPONENTS: IMetadataDeployComponent[] = [
    ...FIELD_COMPONENTS,
    { type: 'RecordType', member: 'Account.Business' },
    { type: 'ValidationRule', member: 'Account.Budget_Not_Negative' },
    { type: 'GlobalValueSet', member: 'Account_Ratings' },
    { type: 'PermissionSet', member: 'Account_Tree_Access' },
    { type: 'PermissionSet', member: 'SDT_Account_thru_OtherChildObject_c' }
];

const readZip = async (zipBuffer: Buffer) => {
    const zip = await JSZip.loadAsync(zipBuffer, { checkCRC32: true });
    const entries: Record<string, string> = {};
    for ( const entryName of Object.keys(zip.files).sort() ) {
        entries[entryName] = await zip.files[entryName].async('string');
    }
    return entries;
};

const successResult = (overrides: Record<string, unknown> = {}) => ({
    id: '0Af000000000001AAA',
    done: true,
    status: 'Succeeded',
    success: true,
    numberComponentsDeployed: 4,
    details: { componentSuccesses: [{ fullName: 'package.xml' }, { fullName: 'Account.Rating__c' }], componentFailures: [] },
    ...overrides
});

describe('RecipeCockpitMetadataDeployPackage (#505)', () => {

    let temporaryRoot: string;
    let workspaceRoot: string;

    beforeEach(() => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-deploy-package-'));
        workspaceRoot = path.join(temporaryRoot, 'workspace');
        fs.cpSync(METADATA_DEPLOY_WORKSPACE_ROOT, workspaceRoot, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    });

    describe('readDeployMethod', () => {

        it('reads only cli or jsforce, anything else as the default, the CLI', () => {
            expect(METADATA_DEPLOY_DEFAULT_METHOD).toBe('cli');
            expect(RecipeCockpitMetadataDeployPackage.readDeployMethod('jsforce')).toBe('jsforce');
            expect(RecipeCockpitMetadataDeployPackage.readDeployMethod('cli')).toBe('cli');
            [undefined, null, '', 'JSFORCE', 'sdr', 1, {}].forEach(settingValue => expect(RecipeCockpitMetadataDeployPackage.readDeployMethod(settingValue)).toBe('cli'));
        });

    });

    describe('resolveSourceFiles', () => {

        it('finds every type\'s file across the package directories, matched case-insensitively, and lists a component with none', () => {

            const resolved = RecipeCockpitMetadataDeployPackage.resolveSourceFiles(workspaceRoot, ['force-app', 'unpackaged'], [
                ...EVERY_TYPE_COMPONENTS,
                { type: 'CustomField', member: 'account.rating__c' },
                { type: 'CustomField', member: 'Account.Legacy_Missing__c' },
                { type: 'GlobalValueSet', member: 'Nobody_Holds_This' }
            ]);

            const relativeByMember = Object.fromEntries(resolved.sourceFiles.map(sourceFile => [`${sourceFile.component.type}:${sourceFile.component.member}`, path.relative(workspaceRoot, sourceFile.filePath).split(path.sep).join('/')]));
            expect(relativeByMember).toEqual({
                'CustomField:Account.Rating__c': 'force-app/main/default/objects/Account/fields/Rating__c.field-meta.xml',
                'CustomField:Account.Annual_Budget__c': 'force-app/main/default/objects/Account/fields/Annual_Budget__c.field-meta.xml',
                'CustomField:OtherChildObject__c.Score__c': 'force-app/main/default/objects/OtherChildObject__c/fields/Score__c.field-meta.xml',
                'CustomObject:OtherChildObject__c': 'force-app/main/default/objects/OtherChildObject__c/OtherChildObject__c.object-meta.xml',
                'RecordType:Account.Business': 'force-app/main/default/objects/Account/recordTypes/Business.recordType-meta.xml',
                'ValidationRule:Account.Budget_Not_Negative': 'force-app/main/default/objects/Account/validationRules/Budget_Not_Negative.validationRule-meta.xml',
                'GlobalValueSet:Account_Ratings': 'unpackaged/globalValueSets/Account_Ratings.globalValueSet-meta.xml',
                'PermissionSet:Account_Tree_Access': 'force-app/main/default/permissionsets/Account_Tree_Access.permissionset-meta.xml',
                'PermissionSet:SDT_Account_thru_OtherChildObject_c': 'force-app/main/default/permissionsets/SDT_Treecipe/SDT_Account_thru_OtherChildObject_c.permissionset-meta.xml',
                'CustomField:account.rating__c': 'force-app/main/default/objects/Account/fields/Rating__c.field-meta.xml'
            });
            expect(resolved.missingComponents).toEqual([
                { type: 'CustomField', member: 'Account.Legacy_Missing__c' },
                { type: 'GlobalValueSet', member: 'Nobody_Holds_This' }
            ]);

        });

        it('never reads a field file through a link', () => {

            const fieldsPath = path.join(workspaceRoot, OBJECTS_PATH, 'Account', 'fields');
            fs.renameSync(path.join(fieldsPath, 'Rating__c.field-meta.xml'), path.join(temporaryRoot, 'Rating__c.field-meta.xml'));
            fs.symlinkSync(path.join(temporaryRoot, 'Rating__c.field-meta.xml'), path.join(fieldsPath, 'Rating__c.field-meta.xml'));

            const resolved = RecipeCockpitMetadataDeployPackage.resolveSourceFiles(workspaceRoot, ['force-app'], [{ type: 'CustomField', member: 'Account.Rating__c' }]);

            expect(resolved.sourceFiles).toEqual([]);
            expect(resolved.missingComponents).toEqual([{ type: 'CustomField', member: 'Account.Rating__c' }]);

        });

    });

    describe('planDeployMethod', () => {

        it('deploys through the CLI when the setting says so, and through jsforce otherwise', () => {
            expect(RecipeCockpitMetadataDeployPackage.planDeployMethod('cli', workspaceRoot, ['force-app', 'unpackaged'], EVERY_TYPE_COMPONENTS)).toEqual({ method: 'cli', reason: 'setting' });
            expect(RecipeCockpitMetadataDeployPackage.planDeployMethod('jsforce', workspaceRoot, ['force-app', 'unpackaged'], EVERY_TYPE_COMPONENTS)).toEqual({ method: 'jsforce' });
        });

        it('falls back to the CLI for any sfdx-project.json replacements, since the CLI applies them to what it sends', () => {

            const sfdxProjectFilePath = path.join(workspaceRoot, 'sfdx-project.json');
            const sfdxProject = JSON.parse(fs.readFileSync(sfdxProjectFilePath, 'utf-8'));
            fs.writeFileSync(sfdxProjectFilePath, JSON.stringify({ ...sfdxProject, replacements: [{ filename: 'force-app/x.cls', stringToReplace: 'a', replaceWithEnv: 'B' }] }));

            expect(RecipeCockpitMetadataDeployPackage.hasReplacements(workspaceRoot)).toBe(true);
            expect(RecipeCockpitMetadataDeployPackage.planDeployMethod('jsforce', workspaceRoot, ['force-app'], FIELD_COMPONENTS)).toEqual({ method: 'cli', reason: 'replacements' });

            fs.writeFileSync(sfdxProjectFilePath, JSON.stringify({ ...sfdxProject, replacements: [] }));
            expect(RecipeCockpitMetadataDeployPackage.planDeployMethod('jsforce', workspaceRoot, ['force-app'], FIELD_COMPONENTS)).toEqual({ method: 'jsforce' });

        });

        it('falls back to the CLI when .forceignore covers a file being deployed, and not for one that covers nothing deployed', () => {

            const forceIgnoreFilePath = path.join(workspaceRoot, '.forceignore');

            fs.writeFileSync(forceIgnoreFilePath, 'package.xml\n**/jsconfig.json\n**/.eslintrc.json\n**/__tests__/**\n');
            expect(RecipeCockpitMetadataDeployPackage.planDeployMethod('jsforce', workspaceRoot, ['force-app'], FIELD_COMPONENTS)).toEqual({ method: 'jsforce' });

            fs.writeFileSync(forceIgnoreFilePath, '# a team keeps this field out of every deploy\n**/Annual_Budget__c.field-meta.xml\n');
            const plan = RecipeCockpitMetadataDeployPackage.planDeployMethod('jsforce', workspaceRoot, ['force-app'], FIELD_COMPONENTS);
            expect(plan).toEqual({ method: 'cli', reason: 'forceIgnore', ignoredFilePaths: [path.join(workspaceRoot, OBJECTS_PATH, 'Account', 'fields', 'Annual_Budget__c.field-meta.xml')] });

        });

        it('falls back to the CLI when a component\'s source file is not where it looks', () => {
            expect(RecipeCockpitMetadataDeployPackage.planDeployMethod('jsforce', workspaceRoot, ['force-app'], [{ type: 'CustomField', member: 'Account.Nowhere__c' }])).toEqual({ method: 'cli', reason: 'missingSource' });
        });

        it('says in the confirmation which way the deploy goes, and why it is the CLI when the setting asked for jsforce', () => {
            expect(RecipeCockpitMetadataDeployPackage.describeDeployMethod({ method: 'cli', reason: 'setting' })).toEqual(['Only these components are deployed, through a generated package.xml.', 'Nothing else in the object folders is.']);
            expect(RecipeCockpitMetadataDeployPackage.describeDeployMethod({ method: 'jsforce' }).join(' ')).toContain('not through the Salesforce CLI');
            expect(RecipeCockpitMetadataDeployPackage.describeDeployMethod({ method: 'cli', reason: 'replacements' }).at(-1)).toContain('"replacements"');
            expect(RecipeCockpitMetadataDeployPackage.describeDeployMethod({ method: 'cli', reason: 'forceIgnore' }).at(-1)).toContain('.forceignore');
        });

    });

    describe('buildDeployZip', () => {

        it('holds exactly the package.xml and the named components in Metadata API format', async () => {

            const packageXml = RecipeCockpitMetadataDeploy.buildPackageXml(EVERY_TYPE_COMPONENTS, '64.0');
            const resolved = RecipeCockpitMetadataDeployPackage.resolveSourceFiles(workspaceRoot, ['force-app', 'unpackaged'], EVERY_TYPE_COMPONENTS);
            const entries = await readZip(await RecipeCockpitMetadataDeployPackage.buildDeployZip(packageXml, resolved.sourceFiles));

            expect(Object.keys(entries)).toEqual([
                'globalValueSets/Account_Ratings.globalValueSet',
                'objects/Account.object',
                'objects/OtherChildObject__c.object',
                'package.xml',
                'permissionsets/Account_Tree_Access.permissionset',
                'permissionsets/SDT_Account_thru_OtherChildObject_c.permissionset'
            ]);
            expect(entries['package.xml']).toBe(packageXml);
            expect(entries['globalValueSets/Account_Ratings.globalValueSet']).toBe(fs.readFileSync(path.join(workspaceRoot, 'unpackaged', 'globalValueSets', 'Account_Ratings.globalValueSet-meta.xml'), 'utf-8'));
            expect(entries['permissionsets/Account_Tree_Access.permissionset']).toBe(fs.readFileSync(path.join(workspaceRoot, 'force-app', 'main', 'default', 'permissionsets', 'Account_Tree_Access.permissionset-meta.xml'), 'utf-8'));

            const account = (await xml2js.parseStringPromise(entries['objects/Account.object'])).CustomObject;
            expect(account.$).toEqual({ xmlns: 'http://soap.sforce.com/2006/04/metadata' });
            // Account IS NOT A COMPONENT: ITS OWN SETTINGS ARE NOT SENT, ONLY THE CHILDREN THE PACKAGE.XML NAMES
            expect(Object.keys(account)).toEqual(['$', 'fields', 'recordTypes', 'validationRules']);
            expect(account.fields.map((field: any) => field.fullName[0])).toEqual(['Rating__c', 'Annual_Budget__c']);
            expect(account.fields[0].valueSet[0].valueSetName).toEqual(['Account_Ratings']);
            expect(account.recordTypes.map((recordType: any) => recordType.fullName[0])).toEqual(['Business']);
            expect(account.validationRules.map((rule: any) => rule.fullName[0])).toEqual(['Budget_Not_Negative']);
            expect(entries['objects/Account.object']).not.toContain('Partner');

            const otherChild = (await xml2js.parseStringPromise(entries['objects/OtherChildObject__c.object'])).CustomObject;
            const objectSource = (await xml2js.parseStringPromise(fs.readFileSync(path.join(workspaceRoot, OBJECTS_PATH, 'OtherChildObject__c', 'OtherChildObject__c.object-meta.xml'), 'utf-8'))).CustomObject;
            const ownKeys = Object.keys(objectSource).filter(key => key !== '$');
            // ITS OWN SETTINGS, AS THE SOURCE HOLDS THEM, AND ONLY THE ONE FIELD NAMED, IN ELEMENT-NAME ORDER
            expect(Object.keys(otherChild)).toEqual(['$', ...[...ownKeys, 'fields'].sort()]);
            ownKeys.forEach(key => expect(otherChild[key]).toEqual(objectSource[key]));
            expect(otherChild.fields.map((field: any) => field.fullName[0])).toEqual(['Score__c']);

        });

        it('writes a field\'s value back escaped, so a formula keeps its operators', async () => {

            const fieldFilePath = path.join(workspaceRoot, OBJECTS_PATH, 'Account', 'fields', 'Rating__c.field-meta.xml');
            fs.writeFileSync(fieldFilePath, '<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>Rating__c</fullName>\n    <formula>IF(A &amp;&amp; B &lt; 3, "x", "y")</formula>\n    <type>Text</type>\n</CustomField>\n');

            const components: IMetadataDeployComponent[] = [{ type: 'CustomField', member: 'Account.Rating__c' }];
            const resolved = RecipeCockpitMetadataDeployPackage.resolveSourceFiles(workspaceRoot, ['force-app'], components);
            const entries = await readZip(await RecipeCockpitMetadataDeployPackage.buildDeployZip(RecipeCockpitMetadataDeploy.buildPackageXml(components), resolved.sourceFiles));

            expect(entries['objects/Account.object']).toContain('<formula>IF(A &amp;&amp; B &lt; 3, "x", "y")</formula>');
            expect((await xml2js.parseStringPromise(entries['objects/Account.object'])).CustomObject.fields[0].formula).toEqual(['IF(A && B < 3, "x", "y")']);

        });

        it('refuses, sending nothing, a source file that is not its type\'s root element', async () => {

            const fieldFilePath = path.join(workspaceRoot, OBJECTS_PATH, 'Account', 'fields', 'Rating__c.field-meta.xml');
            const components: IMetadataDeployComponent[] = [{ type: 'CustomField', member: 'Account.Rating__c' }];
            const resolved = RecipeCockpitMetadataDeployPackage.resolveSourceFiles(workspaceRoot, ['force-app'], components);

            fs.writeFileSync(fieldFilePath, '<RecordType xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>X</fullName></RecordType>');
            await expect(RecipeCockpitMetadataDeployPackage.buildDeployZip(RecipeCockpitMetadataDeploy.buildPackageXml(components), resolved.sourceFiles)).rejects.toThrow('The source file of CustomField Account.Rating__c is not a <CustomField>, so nothing was deployed.');

            fs.writeFileSync(fieldFilePath, '<CustomField><unclosed>');
            await expect(RecipeCockpitMetadataDeployPackage.buildDeployZip(RecipeCockpitMetadataDeploy.buildPackageXml(components), resolved.sourceFiles)).rejects.toThrow('could not be read as XML');

        });

    });

    describe('buildZip', () => {

        it('makes the same bytes from the same entries, readable with every CRC checked', async () => {

            const entries = [{ name: 'package.xml', content: Buffer.from('<Package/>') }, { name: 'objects/Ünïcode__c.object', content: Buffer.from('x'.repeat(5000)) }, { name: 'empty.txt', content: Buffer.alloc(0) }];
            const first = RecipeCockpitMetadataDeployPackage.buildZip(entries);

            expect(RecipeCockpitMetadataDeployPackage.buildZip(entries).equals(first)).toBe(true);
            expect(await readZip(first)).toEqual({ 'empty.txt': '', 'objects/Ünïcode__c.object': 'x'.repeat(5000), 'package.xml': '<Package/>' });
            expect(RecipeCockpitMetadataDeployPackage.computeCrc32(Buffer.from('123456789'))).toBe(0xcbf43926);

        });

    });

    describe('toCliShapedPayload', () => {

        it('reads the org\'s answer in the CLI\'s --json shape, so the CLI\'s readers count it', () => {

            const payload = RecipeCockpitMetadataDeployPackage.toCliShapedPayload(successResult({ success: 'true', done: 'true', numberComponentsDeployed: '4' }));

            expect(payload.status).toBe(0);
            expect(ScratchOrgService.readDeployComponentCounts(payload)).toEqual({ isSucceeded: true, componentSuccessCount: 1, componentFailureCount: 0, numberComponentsDeployed: 4 });

        });

        it('is a failure for a failed deploy, one component failure arriving as the entry itself, and an answer that is not an object', () => {

            const failed = RecipeCockpitMetadataDeployPackage.toCliShapedPayload(successResult({
                success: false,
                status: 'Failed',
                errorMessage: 'Deploy failed',
                details: { componentFailures: { fullName: 'Account.Rating__c', problem: 'Value set Account_Ratings not found' } }
            }));

            expect(failed.status).toBe(1);
            expect(failed.message).toBe('Deploy failed');
            expect(ScratchOrgService.readDeployComponentCounts(failed)).toEqual(expect.objectContaining({ isSucceeded: false, componentFailureCount: 1 }));
            expect(RecipeCockpitMetadataDeploy.readComponentFailureMessages(failed)).toEqual(['Account.Rating__c: Value set Account_Ratings not found']);

            [undefined, null, 'Succeeded', [successResult()]].forEach(answer => expect(RecipeCockpitMetadataDeployPackage.toCliShapedPayload(answer).status).toBe(1));
            // success WITHOUT done IS NOT FINISHED, SO NOT A SUCCESS
            expect(RecipeCockpitMetadataDeployPackage.toCliShapedPayload(successResult({ done: false })).status).toBe(1);

        });

    });

    describe('runDeploy', () => {

        let deployCalls: Array<{ zipInput: Buffer; options: Record<string, unknown> }>;
        let statusAnswers: Array<unknown>;
        let cancelCalls: string[];
        let isCancellationRequested: boolean;
        let clock: number;

        const connection = (): IMetadataDeployConnection => ({
            metadata: {
                deploy: jest.fn().mockImplementation(async (zipInput: Buffer, options: Record<string, unknown>) => {
                    deployCalls.push({ zipInput: zipInput, options: options });
                    return { id: '0Af000000000001AAA', done: false, state: 'Queued' };
                }),
                checkDeployStatus: jest.fn().mockImplementation(async () => {
                    const answer = statusAnswers.length > 1 ? statusAnswers.shift() : statusAnswers[0];
                    if ( answer instanceof Error ) {
                        throw answer;
                    }
                    return answer;
                }),
                cancelDeploy: jest.fn().mockImplementation(async (deployId: string) => { cancelCalls.push(deployId); return { done: false, id: deployId }; })
            }
        });

        const control = (overrides: Record<string, unknown> = {}) => ({
            isCancellationRequested: () => isCancellationRequested,
            timeoutMilliseconds: 60000,
            pollIntervalMilliseconds: 1000,
            cancelWaitMilliseconds: 10000,
            sleep: async (milliseconds: number) => { clock += milliseconds; },
            now: () => clock,
            ...overrides
        });

        beforeEach(() => {
            deployCalls = [];
            statusAnswers = [];
            cancelCalls = [];
            isCancellationRequested = false;
            clock = 0;
        });

        it('sends the zip with rollbackOnError and nothing that ignores an error, and reads the org\'s finished answer', async () => {

            statusAnswers = [{ done: false, status: 'InProgress' }, successResult()];
            const zipInput = Buffer.from('zip');

            const run = await RecipeCockpitMetadataDeployPackage.runDeploy(connection(), zipInput, control());

            expect(deployCalls).toEqual([{ zipInput: zipInput, options: { rollbackOnError: true, singlePackage: true, ignoreWarnings: false, checkOnly: false } }]);
            expect(METADATA_DEPLOY_JSFORCE_OPTIONS).toEqual({ rollbackOnError: true, singlePackage: true, ignoreWarnings: false, checkOnly: false });
            expect(Object.keys(METADATA_DEPLOY_JSFORCE_OPTIONS)).not.toContain('allowMissingFiles');
            expect(run).toEqual({ kind: 'finished', deployId: '0Af000000000001AAA', payload: expect.objectContaining({ status: 0 }) });
            expect(cancelCalls).toEqual([]);

        });

        it('asks the org to cancel on a cancel, and reports a deploy the org cancelled as cancelled', async () => {

            statusAnswers = [{ done: false, status: 'InProgress' }, { done: false, status: 'Canceling' }, { done: true, status: 'Canceled', success: false }];
            const deployConnection = connection();
            (deployConnection.metadata.checkDeployStatus as jest.Mock).mockImplementationOnce(async () => {
                isCancellationRequested = true;
                return { done: false, status: 'InProgress' };
            });

            const run = await RecipeCockpitMetadataDeployPackage.runDeploy(deployConnection, Buffer.from('zip'), control());

            expect(cancelCalls).toEqual(['0Af000000000001AAA']);
            expect(run).toEqual({ kind: 'cancelled', deployId: '0Af000000000001AAA', payload: expect.objectContaining({ status: 1 }), isTimedOut: false });

        });

        it('reads a deploy that finished before its cancel arrived like any other', async () => {

            statusAnswers = [successResult()];
            isCancellationRequested = false;
            const deployConnection = connection();
            (deployConnection.metadata.deploy as jest.Mock).mockImplementationOnce(async () => {
                isCancellationRequested = true;
                return { id: '0Af000000000001AAA' };
            });

            const run = await RecipeCockpitMetadataDeployPackage.runDeploy(deployConnection, Buffer.from('zip'), control());

            expect(cancelCalls).toEqual(['0Af000000000001AAA']);
            expect(run.kind).toBe('finished');

        });

        it('is unknown when the org does not answer a cancel in time, and cancels in the org on a timeout', async () => {

            statusAnswers = [{ done: false, status: 'InProgress' }];
            isCancellationRequested = true;
            const cancelledRun = await RecipeCockpitMetadataDeployPackage.runDeploy(connection(), Buffer.from('zip'), control());
            // A CANCEL BEFORE ANYTHING WAS SENT SENDS NOTHING
            expect(deployCalls).toEqual([]);
            expect(cancelledRun).toEqual({ kind: 'unconfirmed', failureMessage: 'The deploy was cancelled before it was sent, so nothing was deployed.', isCancelled: true });

            isCancellationRequested = false;
            const deployConnection = connection();
            (deployConnection.metadata.deploy as jest.Mock).mockImplementationOnce(async () => { isCancellationRequested = true; return { id: '0Af000000000001AAA' }; });
            const unansweredRun = await RecipeCockpitMetadataDeployPackage.runDeploy(deployConnection, Buffer.from('zip'), control());
            expect(unansweredRun).toEqual(expect.objectContaining({ kind: 'unconfirmed', deployId: '0Af000000000001AAA', isCancelled: true }));

            isCancellationRequested = false;
            cancelCalls = [];
            statusAnswers = [{ done: false, status: 'InProgress' }];
            const timedOutRun = await RecipeCockpitMetadataDeployPackage.runDeploy(connection(), Buffer.from('zip'), control({ timeoutMilliseconds: 5000 }));
            expect(cancelCalls).toEqual(['0Af000000000001AAA']);
            expect(timedOutRun).toEqual(expect.objectContaining({ kind: 'unconfirmed', isCancelled: false, failureMessage: 'The deploy did not finish in time; it was asked to cancel and has not answered, so whether it landed is unknown.' }));

            statusAnswers = [{ done: false, status: 'InProgress' }, { done: true, status: 'Canceled' }];
            const timedOutCancelledRun = await RecipeCockpitMetadataDeployPackage.runDeploy(connection(), Buffer.from('zip'), control({ timeoutMilliseconds: 500 }));
            expect(timedOutCancelledRun).toEqual(expect.objectContaining({ kind: 'cancelled', isTimedOut: true }));

        });

        it('is unknown, quoting no credential, when the request fails, answers no Id, or its status cannot be read', async () => {

            const failingConnection = connection();
            (failingConnection.metadata.deploy as jest.Mock).mockRejectedValueOnce(new Error('INVALID_SESSION_ID: sid=00Dxx!AQ0AQ secret\nmore'));
            const failedRun = await RecipeCockpitMetadataDeployPackage.runDeploy(failingConnection, Buffer.from('zip'), control());
            expect(failedRun.kind).toBe('unconfirmed');
            expect((failedRun as any).failureMessage).toStartWith('The deploy request failed, so whether it landed is unknown: INVALID_SESSION_ID:');
            expect((failedRun as any).failureMessage).not.toContain('00Dxx!AQ0AQ');
            expect((failedRun as any).failureMessage).not.toContain('\n');

            const noIdConnection = connection();
            (noIdConnection.metadata.deploy as jest.Mock).mockResolvedValueOnce({ id: '../x' });
            expect(await RecipeCockpitMetadataDeployPackage.runDeploy(noIdConnection, Buffer.from('zip'), control())).toEqual(expect.objectContaining({ kind: 'unconfirmed', isCancelled: false }));

            statusAnswers = [new Error('socket hang up')];
            const unreadableRun = await RecipeCockpitMetadataDeployPackage.runDeploy(connection(), Buffer.from('zip'), control());
            expect(unreadableRun).toEqual(expect.objectContaining({ kind: 'unconfirmed', deployId: '0Af000000000001AAA', failureMessage: 'The deploy\'s status could not be read, so whether it landed is unknown: socket hang up' }));

            // ONE FAILED CHECK IS RETRIED
            statusAnswers = [new Error('socket hang up'), successResult()];
            expect((await RecipeCockpitMetadataDeployPackage.runDeploy(connection(), Buffer.from('zip'), control())).kind).toBe('finished');
            expect(METADATA_DEPLOY_STATUS_CHECK_ATTEMPTS).toBe(3);

        });

    });

});
