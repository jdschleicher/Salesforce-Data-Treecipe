import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

import {
    IRunHistoryStepRecord,
    RUN_HISTORY_DETAIL_MAX_LENGTH,
    RUN_HISTORY_STEPS,
    RUN_HISTORY_STEP_LABELS,
    RecipeCockpitRunHistory
} from '../RecipeCockpitRunHistory';
import { IRecipeCockpitRunArtifactsLocation, RecipeCockpitRunArtifacts } from '../RecipeCockpitRunArtifacts';
import { METADATA_DEPLOY_OPERATION_BY_KIND } from '../RecipeCockpitMetadataDeploy';
import { METADATA_RETRIEVE_OPERATION_BY_KIND } from '../RecipeCockpitMetadataRetrieve';
import { FIXTURE_RUN_FOLDER_NAME, makeTreeRunArtifactsLocation } from './RecipeCockpitRunArtifactsFixture';

const USERNAME = 'sandbox.user@example.com';

describe('RecipeCockpitRunHistory (#485)', () => {

    let temporaryRoot: string;
    let workspaceRoot: string;
    let location: IRecipeCockpitRunArtifactsLocation;

    const orgOperationsFolder = (runLocation: IRecipeCockpitRunArtifactsLocation = location, username: string = USERNAME) =>
        path.join(runLocation.folderPath, 'OrgOperations', username);

    const writeRunFile = (folderPath: string, fileName: string, content = '{}') => {
        fs.mkdirSync(folderPath, { recursive: true });
        const filePath = path.join(folderPath, fileName);
        fs.writeFileSync(filePath, content);
        return filePath;
    };

    const buildRecord = (overrides: Partial<IRunHistoryStepRecord> = {}): IRunHistoryStepRecord => ({
        step: 'field-deploy',
        outcome: 'succeeded',
        orgUsername: USERNAME,
        orgAlias: 'dev-sandbox',
        startedAt: new Date(2026, 9, 28, 10, 15, 30),
        finishedAt: new Date(2026, 9, 28, 10, 16, 5),
        succeededCount: 3,
        filePaths: [],
        ...overrides
    });

    beforeEach(() => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-run-history-'));
        workspaceRoot = path.join(temporaryRoot, 'workspace');
        fs.mkdirSync(workspaceRoot);
        location = makeTreeRunArtifactsLocation(workspaceRoot);
    });

    afterEach(() => {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    });

    it('imports no vscode', () => {

        const sourceText = fs.readFileSync(path.join(__dirname, '..', 'RecipeCockpitRunHistory.ts'), 'utf-8');
        expect(sourceText).not.toMatch(/from 'vscode'|require\('vscode'\)/);

    });

    it('names every deploy and retrieve operation, the assignment and generate as a step, each with a label', () => {

        const operationNames = [
            ...Object.values(METADATA_DEPLOY_OPERATION_BY_KIND),
            ...Object.values(METADATA_RETRIEVE_OPERATION_BY_KIND),
            'permission-set-assign',
            'permission-set-generate'
        ];

        expect([...RUN_HISTORY_STEPS].sort()).toEqual([...operationNames].sort());
        RUN_HISTORY_STEPS.forEach(step => expect(RUN_HISTORY_STEP_LABELS[step]).toEqual(expect.any(String)));

    });

    describe('parseRunFileName', () => {

        it.each([
            ['20261028-101530-field-deploy.json', 'field-deploy', 'result'],
            ['20261028-101530-field-deploy-2.json', 'field-deploy', 'result'],
            ['20261028-101530-field-deploy-package.xml', 'field-deploy', 'package'],
            ['20261028-101530-field-deploy-2-package.xml', 'field-deploy', 'package'],
            ['20261028-101530-validation-rule-retrieve-summary.json', 'validation-rule-retrieve', 'summary'],
            ['20261028-101530-permission-set-assign-summary-3.json', 'permission-set-assign', 'summary'],
            ['20261028-101530-permission-set-generate.json', 'permission-set-generate', 'result']
        ])('reads %s', (fileName, step, kind) => {

            expect(RecipeCockpitRunHistory.parseRunFileName(fileName)).toEqual({ timestamp: '20261028-101530', step: step, kind: kind });

        });

        it.each([
            '20261028-101530-scratch-create.json',
            '20261028-101530-adapter-retrieve.json',
            '20261328-101530-field-deploy.json',
            '20261028-251530-field-deploy.json',
            '20261028-101530-field-deploy-1.json',
            '20261028-101530-field-deploy.txt',
            'notes.json',
            '.gitignore'
        ])('refuses %s', fileName => {

            expect(RecipeCockpitRunHistory.parseRunFileName(fileName)).toBeUndefined();

        });

    });

    describe('writeSummary', () => {

        it('writes <ts>-<step>-summary.json beside the step\'s files, naming only those in its folder', () => {

            const resultFilePath = writeRunFile(orgOperationsFolder(), '20261028-101530-field-deploy.json');
            const outsideFilePath = path.join(location.folderPath, 'elsewhere.json');

            const summaryFilePath = RecipeCockpitRunHistory.writeSummary(location, buildRecord({ filePaths: [resultFilePath, undefined, outsideFilePath], detail: 'Deployed 3\ncomponents' }));

            expect(summaryFilePath).toBe(path.join(orgOperationsFolder(), '20261028-101530-field-deploy-summary.json'));
            const summary = JSON.parse(fs.readFileSync(summaryFilePath as string, 'utf-8'));
            expect(summary).toEqual({
                schemaVersion: 1,
                step: 'field-deploy',
                outcome: 'succeeded',
                orgUsername: USERNAME,
                orgAlias: 'dev-sandbox',
                startedAt: new Date(2026, 9, 28, 10, 15, 30).toISOString(),
                finishedAt: new Date(2026, 9, 28, 10, 16, 5).toISOString(),
                succeededCount: 3,
                detail: 'Deployed 3 components',
                fileNames: ['20261028-101530-field-deploy.json']
            });
            expect(RecipeCockpitRunHistory.parseSummary(fs.readFileSync(summaryFilePath as string, 'utf-8'))).toEqual(summary);

        });

        it('writes Generate permission set\'s summary under PermissionSets, with no org', () => {

            const summaryFilePath = RecipeCockpitRunHistory.writeSummary(location, buildRecord({ step: 'permission-set-generate', orgUsername: undefined, orgAlias: undefined }));

            expect(summaryFilePath).toBe(path.join(location.folderPath, 'PermissionSets', '20261028-101530-permission-set-generate-summary.json'));
            expect(JSON.parse(fs.readFileSync(summaryFilePath as string, 'utf-8')).orgUsername).toBeNull();

        });

        it('takes the next free name rather than replacing a summary, and writes the RunArtifacts .gitignore', () => {

            const first = RecipeCockpitRunHistory.writeSummary(location, buildRecord());
            const second = RecipeCockpitRunHistory.writeSummary(location, buildRecord({ outcome: 'failed' }));

            expect(path.basename(second as string)).toBe('20261028-101530-field-deploy-summary-2.json');
            expect(JSON.parse(fs.readFileSync(first as string, 'utf-8')).outcome).toBe('succeeded');
            expect(fs.readFileSync(path.join(location.folderPath, '.gitignore'), 'utf-8')).toBe('*\n');

        });

        it('cuts a long detail to a fixed length on one line', () => {

            const summaryFilePath = RecipeCockpitRunHistory.writeSummary(location, buildRecord({ outcome: 'failed', detail: `x\u2028${'y'.repeat(1000)}\u202e` }));
            const detail = JSON.parse(fs.readFileSync(summaryFilePath as string, 'utf-8')).detail as string;

            expect(detail.length).toBe(RUN_HISTORY_DETAIL_MAX_LENGTH);
            expect(detail.startsWith('x y')).toBe(true);
            expect(detail).not.toMatch(/[\u2028\u202e]/);

        });

        it('writes nothing, and never throws, for an org step with no usable username or a linked folder on the way', () => {

            expect(RecipeCockpitRunHistory.writeSummary(location, buildRecord({ orgUsername: undefined }))).toBeUndefined();
            expect(RecipeCockpitRunHistory.writeSummary(location, buildRecord({ orgUsername: '../escape' }))).toBeUndefined();

            const outsideFolderPath = path.join(temporaryRoot, 'outside');
            fs.mkdirSync(outsideFolderPath);
            fs.symlinkSync(outsideFolderPath, location.folderPath, 'dir');

            expect(RecipeCockpitRunHistory.writeSummary(location, buildRecord())).toBeUndefined();
            expect(fs.readdirSync(outsideFolderPath)).toEqual([]);

        });

    });

    it('writes nothing, and never throws, when making its folder throws', () => {

        jest.spyOn(RecipeCockpitRunArtifacts, 'makeFolder').mockImplementation(() => { throw new Error('EACCES'); });

        expect(RecipeCockpitRunHistory.writeSummary(location, buildRecord())).toBeUndefined();

    });

    it('reads a compact timestamp as local time, and answers undefined for one in another shape or not a real date', () => {

        expect(RecipeCockpitRunHistory.readCompactTimestamp('20261028-101530')).toBe(new Date(2026, 9, 28, 10, 15, 30).getTime());
        expect(RecipeCockpitRunHistory.readCompactTimestamp('2026-10-28T10:15:30')).toBeUndefined();
        expect(RecipeCockpitRunHistory.readCompactTimestamp('20260230-101530')).toBeUndefined();
        expect(RecipeCockpitRunHistory.formatTimeLabel(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('2026-01-02 03:04:05');

    });

    describe('parseSummary', () => {

        const validSummary = () => ({
            schemaVersion: 1,
            step: 'permission-set-assign',
            outcome: 'partial',
            orgUsername: USERNAME,
            startedAt: '2026-10-28T10:15:30.000Z',
            finishedAt: '2026-10-28T10:16:05.000Z',
            succeededCount: 1,
            failedCount: 1,
            detail: 'One could not be assigned',
            fileNames: ['20261028-101530-permission-set-assign.json']
        });

        it('reads a summary of the right shape', () => {

            expect(RecipeCockpitRunHistory.parseSummary(JSON.stringify(validSummary()))).toEqual(validSummary());

        });

        it.each([
            ['not JSON', '{'],
            ['an array', '[]'],
            ['another schema version', JSON.stringify({ ...validSummary(), schemaVersion: 2 })],
            ['an unknown step', JSON.stringify({ ...validSummary(), step: 'scratch-create' })],
            ['an unknown outcome', JSON.stringify({ ...validSummary(), outcome: 'great' })],
            ['an org name with a line break', JSON.stringify({ ...validSummary(), orgUsername: 'a\nb' })],
            ['an alias with a bidi character', JSON.stringify({ ...validSummary(), orgAlias: 'dev\u202e' })],
            ['a time that is not an instant', JSON.stringify({ ...validSummary(), startedAt: 'yesterday' })],
            ['a negative count', JSON.stringify({ ...validSummary(), failedCount: -1 })],
            ['a detail on two lines', JSON.stringify({ ...validSummary(), detail: 'a\nb' })],
            ['a detail past the length', JSON.stringify({ ...validSummary(), detail: 'x'.repeat(RUN_HISTORY_DETAIL_MAX_LENGTH + 1) })],
            ['a file name that is a path', JSON.stringify({ ...validSummary(), fileNames: ['../20261028-101530-field-deploy.json'] })],
            ['a file name that is not a step file', JSON.stringify({ ...validSummary(), fileNames: ['secrets.json'] })],
            ['no file names', JSON.stringify({ ...validSummary(), fileNames: undefined })]
        ])('refuses %s', (_description, summaryText) => {

            expect(RecipeCockpitRunHistory.parseSummary(summaryText)).toBeUndefined();

        });

    });

    describe('listTreeHistory', () => {

        it('lists a summarized step with its files and every field the summary holds', () => {

            const packageFilePath = writeRunFile(orgOperationsFolder(), '20261028-101530-field-deploy-package.xml', '<Package/>');
            const resultFilePath = writeRunFile(orgOperationsFolder(), '20261028-101540-field-deploy.json');
            RecipeCockpitRunHistory.writeSummary(location, buildRecord({ outcome: 'partial', failedCount: 1, detail: 'Account.Foo__c: invalid', filePaths: [packageFilePath, resultFilePath] }));

            const listing = RecipeCockpitRunHistory.listTreeHistory([location]);

            expect(listing).toEqual({
                rows: [{
                    step: 'field-deploy',
                    status: 'partial',
                    timeMs: new Date(2026, 9, 28, 10, 15, 30).getTime(),
                    runFolderName: FIXTURE_RUN_FOLDER_NAME,
                    orgUsername: USERNAME,
                    orgAlias: 'dev-sandbox',
                    finishedAtMs: new Date(2026, 9, 28, 10, 16, 5).getTime(),
                    succeededCount: 3,
                    failedCount: 1,
                    detail: 'Account.Foo__c: invalid',
                    filePaths: [packageFilePath, resultFilePath]
                }],
                hiddenRowCount: 0
            });

        });

        it('lists a step from before summaries as "not recorded", its manifest joined to its result', () => {

            const packageFilePath = writeRunFile(orgOperationsFolder(), '20261020-090000-record-type-deploy-package.xml');
            const resultFilePath = writeRunFile(orgOperationsFolder(), '20261020-090012-record-type-deploy.json');
            const lonePackageFilePath = writeRunFile(orgOperationsFolder(), '20261021-090000-field-retrieve-package.xml');
            const generateFilePath = writeRunFile(path.join(location.folderPath, 'PermissionSets'), '20261019-080000-permission-set-generate.json');

            const { rows } = RecipeCockpitRunHistory.listTreeHistory([location]);

            expect(rows.map(row => [row.step, row.status, row.orgUsername, row.filePaths])).toEqual([
                ['field-retrieve', 'unrecorded', USERNAME, [lonePackageFilePath]],
                ['record-type-deploy', 'unrecorded', USERNAME, [packageFilePath, resultFilePath]],
                ['permission-set-generate', 'unrecorded', undefined, [generateFilePath]]
            ]);

        });

        it('lists a summary out of shape as "unreadable", with the summary as its file, and never believes it', () => {

            const summaryFilePath = writeRunFile(orgOperationsFolder(), '20261028-101530-field-deploy-summary.json', JSON.stringify({ schemaVersion: 1, step: 'field-deploy', outcome: 'succeeded' }));
            const otherStepSummaryText = JSON.stringify({
                schemaVersion: 1, step: 'record-type-deploy', outcome: 'succeeded', orgUsername: null,
                startedAt: '2026-10-28T10:15:30.000Z', finishedAt: '2026-10-28T10:15:30.000Z', fileNames: []
            });
            writeRunFile(orgOperationsFolder(), '20261028-111530-field-deploy-summary.json', otherStepSummaryText);

            const { rows } = RecipeCockpitRunHistory.listTreeHistory([location]);

            expect(rows.map(row => row.status)).toEqual(['unreadable', 'unreadable']);
            expect(rows[1].filePaths).toEqual([summaryFilePath]);

        });

        it('lists every run given, newest first, each row naming its run, and a location listed twice once', () => {

            const olderLocation = makeTreeRunArtifactsLocation(workspaceRoot, 'recipe-2026-10-01T10-00-00');
            writeRunFile(orgOperationsFolder(olderLocation), '20261001-100000-permission-set-assign.json');
            writeRunFile(orgOperationsFolder(), '20261028-100000-field-retrieve.json');

            const { rows } = RecipeCockpitRunHistory.listTreeHistory([location, olderLocation, location]);

            expect(rows.map(row => [row.step, row.runFolderName])).toEqual([
                ['field-retrieve', FIXTURE_RUN_FOLDER_NAME],
                ['permission-set-assign', 'recipe-2026-10-01T10-00-00']
            ]);

        });

        it('keeps the newest rows up to the limit and counts the rest', () => {

            for ( let minute = 10; minute < 15; minute++ ) {
                writeRunFile(orgOperationsFolder(), `20261028-10${minute}00-field-retrieve.json`);
            }

            const listing = RecipeCockpitRunHistory.listTreeHistory([location], 2);

            expect(listing.rows.map(row => new Date(row.timeMs).getMinutes())).toEqual([14, 13]);
            expect(listing.hiddenRowCount).toBe(3);

        });

        it('follows no link: a linked RunArtifacts, org folder or file lists nothing', () => {

            const outsideFolderPath = path.join(temporaryRoot, 'outside');
            writeRunFile(outsideFolderPath, '20261028-100000-field-retrieve.json');

            fs.mkdirSync(path.join(location.folderPath, 'OrgOperations'), { recursive: true });
            fs.symlinkSync(outsideFolderPath, path.join(location.folderPath, 'OrgOperations', USERNAME), 'dir');
            fs.mkdirSync(path.join(location.folderPath, 'PermissionSets'));
            fs.symlinkSync(path.join(outsideFolderPath, '20261028-100000-field-retrieve.json'), path.join(location.folderPath, 'PermissionSets', '20261028-100000-permission-set-generate.json'));

            expect(RecipeCockpitRunHistory.listTreeHistory([location]).rows).toEqual([]);

            const linkedLocation = makeTreeRunArtifactsLocation(workspaceRoot, 'recipe-2026-10-02T10-00-00');
            fs.symlinkSync(location.folderPath, linkedLocation.folderPath, 'dir');
            expect(RecipeCockpitRunHistory.listTreeHistory([linkedLocation]).rows).toEqual([]);

        });

        it('lists what it can when a folder cannot be read', () => {

            writeRunFile(orgOperationsFolder(), '20261028-100000-field-retrieve.json');
            const generateFilePath = writeRunFile(path.join(location.folderPath, 'PermissionSets'), '20261028-110000-permission-set-generate.json');
            const unreadableFolderPath = orgOperationsFolder();
            const readFolder = fs.readdirSync;
            jest.spyOn(fs, 'readdirSync').mockImplementation(((folderPath: fs.PathLike, readOptions?: any) => {
                if ( String(folderPath) === unreadableFolderPath ) {
                    throw new Error('EACCES');
                }
                return readFolder(folderPath, readOptions);
            }) as typeof fs.readdirSync);

            expect(RecipeCockpitRunHistory.listTreeHistory([location]).rows.map(row => row.filePaths)).toEqual([[generateFilePath]]);

        });

        it('lists nothing for a tree with no RunArtifacts folder', () => {

            expect(RecipeCockpitRunHistory.listTreeHistory([location])).toEqual({ rows: [], hiddenRowCount: 0 });

        });

    });

});
