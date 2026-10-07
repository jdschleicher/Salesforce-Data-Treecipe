import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as matchers from 'jest-extended';
expect.extend(matchers);

import {
    DatasetSourceService,
    DATASET_COLLECTIONS_API_FOLDER_NAME,
    DATASET_SOURCE_FILE_NAME,
    IDatasetSource,
    IKnownRecipeRun
} from '../DatasetSourceService';

const mockWorkspacePath = path.join(__dirname, 'mocks', 'workspace', 'treecipe');
const mockGeneratedRecipesPath = path.join(mockWorkspacePath, 'GeneratedRecipes');
const mockFakeDataSetsPath = path.join(mockWorkspacePath, 'FakeDataSets');

const fakerJsRunFolderName = 'recipe-fakerjs-2026-09-01T08-00-00';
const snowfakeryRunFolderName = 'recipe-2026-09-04T11-22-07';

const readFixture = (datasetFolderName: string) => DatasetSourceService.readDatasetSource(
    path.join(mockFakeDataSetsPath, datasetFolderName),
    DatasetSourceService.findKnownRecipeRuns(mockGeneratedRecipesPath)
);

describe('DatasetSourceService', () => {

    describe('the service boundary', () => {

        test('imports fs and path only, so it runs without vscode', () => {

            const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'DatasetSourceService.ts'), 'utf8');
            const importedModules = [...serviceSource.matchAll(/from '([^']+)'/g)].map(importMatch => importMatch[1]);

            expect(importedModules).toEqual(['fs', 'path']);

        });

    });

    describe('isSafeFolderOrFileName', () => {

        test.each([
            ['recipe-fakerjs-2026-09-01T08-00-00', true],
            ['Account-thru-Contact', true],
            ['', false],
            ['..', false],
            ['../../etc', false],
            ['a..b', false],
            ['run/tree', false],
            ['run\\tree', false]
        ])('given "%s", answers %s', (candidateName, expectedAnswer) => {

            expect(DatasetSourceService.isSafeFolderOrFileName(candidateName)).toBe(expectedAnswer);

        });

    });

    describe('resolveRecipeSourceNames', () => {

        test('given a recipe in a run tree folder, names the run, the tree and the file', () => {

            const recipeFilePath = path.join(mockGeneratedRecipesPath, fakerJsRunFolderName, 'Account-thru-Contact', 'recipe-fakerjs--Account-thru-Contact-2026-09-01T08-00-00.yml');

            expect(DatasetSourceService.resolveRecipeSourceNames(mockGeneratedRecipesPath, recipeFilePath)).toEqual({
                recipeRunFolderName: fakerJsRunFolderName,
                recipeTreeFolderName: 'Account-thru-Contact',
                recipeFileName: 'recipe-fakerjs--Account-thru-Contact-2026-09-01T08-00-00.yml'
            });

        });

        test('given a recipe directly under GeneratedRecipes, records null for the run and the tree', () => {

            const recipeFilePath = path.join(mockGeneratedRecipesPath, 'recipe-loose.yml');

            expect(DatasetSourceService.resolveRecipeSourceNames(mockGeneratedRecipesPath, recipeFilePath)).toEqual({
                recipeRunFolderName: null,
                recipeTreeFolderName: null,
                recipeFileName: 'recipe-loose.yml'
            });

        });

        test('given a recipe directly in a run folder, records the run and a null tree', () => {

            const recipeFilePath = path.join(mockGeneratedRecipesPath, snowfakeryRunFolderName, 'recipe.yml');

            expect(DatasetSourceService.resolveRecipeSourceNames(mockGeneratedRecipesPath, recipeFilePath)).toEqual({
                recipeRunFolderName: snowfakeryRunFolderName,
                recipeTreeFolderName: null,
                recipeFileName: 'recipe.yml'
            });

        });

        test('given a recipe outside GeneratedRecipes, throws rather than recording a path', () => {

            const recipeFilePath = path.join(mockWorkspacePath, 'elsewhere', 'recipe.yml');

            expect(() => DatasetSourceService.resolveRecipeSourceNames(mockGeneratedRecipesPath, recipeFilePath))
                .toThrow('is not inside the GeneratedRecipes folder');

        });

        test('given a name shaped like a command link on a refused path, the error names no part of the path', () => {

            const commandLinkFileName = '[Fix recipe](command:workbench.action.terminal.sendSequence?%7B%22text%22%3A%22x%22%7D).yml';
            const recipeFilePath = path.join(mockGeneratedRecipesPath, 'recipe-x', 'a..b', commandLinkFileName);

            let thrownMessage = '';
            try {
                DatasetSourceService.resolveRecipeSourceNames(mockGeneratedRecipesPath, recipeFilePath);
            } catch (thrownError) {
                thrownMessage = (thrownError as Error).message;
            }

            expect(thrownMessage).toContain('is not inside the GeneratedRecipes folder');
            expect(thrownMessage).not.toContain('command:');
            expect(thrownMessage).not.toContain('a..b');

        });

    });

    describe('countRecordsByObject', () => {

        test('counts the transformed Collections API records of each object', () => {

            const collectionsApiContentBySObject = new Map<string, { records?: unknown }>([
                ['Account', { records: [{}, {}] }],
                ['Contact', { records: [{}, {}, {}] }],
                ['Case', {}]
            ]);

            expect(DatasetSourceService.countRecordsByObject(collectionsApiContentBySObject)).toEqual({
                Account: 2,
                Contact: 3,
                Case: 0
            });

        });

        test('given an object named __proto__, keeps its count as an own key', () => {

            const recordCountsByObject = DatasetSourceService.countRecordsByObject(new Map([['__proto__', { records: [{}, {}] }]]));

            expect(Object.prototype.hasOwnProperty.call(recordCountsByObject, '__proto__')).toBeTrue();
            expect(recordCountsByObject['__proto__']).toBe(2);
            expect(JSON.parse(JSON.stringify(recordCountsByObject))).toEqual(JSON.parse('{"__proto__":2}'));

        });

    });

    describe('writeDatasetSourceFile', () => {

        let temporaryDirectoryPath: string;

        beforeEach(() => {
            temporaryDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'dataset-source-'));
        });

        afterEach(() => {
            fs.rmSync(temporaryDirectoryPath, { recursive: true, force: true });
        });

        test.each([
            ['faker-js' as const],
            ['snowfakery' as const]
        ])('given %s, writes a file the reader type-checks back to the same source', (fakerService) => {

            const datasetSource = DatasetSourceService.buildDatasetSource(
                { recipeRunFolderName: null, recipeTreeFolderName: null, recipeFileName: 'recipe-loose.yml' },
                fakerService,
                '2026-09-02T10:00:00.000Z',
                { Lead: 4 }
            );

            const writtenFilePath = DatasetSourceService.writeDatasetSourceFile(temporaryDirectoryPath, datasetSource);

            expect(path.basename(writtenFilePath)).toBe(DATASET_SOURCE_FILE_NAME);
            expect(Object.keys(JSON.parse(fs.readFileSync(writtenFilePath, 'utf8')))).toEqual([
                'schemaVersion',
                'origin',
                'recipeRunFolderName',
                'recipeTreeFolderName',
                'recipeFileName',
                'fakerService',
                'generatedAt',
                'recordCountsByObject'
            ]);
            expect(DatasetSourceService.typeCheckDatasetSource(JSON.parse(fs.readFileSync(writtenFilePath, 'utf8')))).toEqual(datasetSource);

        });

    });

    describe('parseDatasetFolderName', () => {

        test.each([
            ['dataset-2026-09-04T12-00-00', { fakerService: 'snowfakery', timestamp: '2026-09-04T12-00-00', collisionSuffix: null }],
            ['dataset-fakerjs-2026-09-02T10-00-00', { fakerService: 'faker-js', timestamp: '2026-09-02T10-00-00', collisionSuffix: null }],
            ['dataset-fakerjs-2026-09-02T10-00-00-2', { fakerService: 'faker-js', timestamp: '2026-09-02T10-00-00', collisionSuffix: 2 }],
            ['dataset-2026-09-02T10-00-00-13', { fakerService: 'snowfakery', timestamp: '2026-09-02T10-00-00', collisionSuffix: 13 }]
        ])('given "%s", reads its faker service, timestamp and suffix', (datasetFolderName, expectedDetail) => {

            expect(DatasetSourceService.parseDatasetFolderName(datasetFolderName)).toEqual(expectedDetail);

        });

        test.each([
            'notADataset',
            'dataset-2026-09-02T10-00-00-1',
            'dataset-2026-09-02T10-00-00-02',
            'dataset-2026-09-02',
            'recipe-2026-09-04T11-22-07'
        ])('given "%s", is not a data set folder', (datasetFolderName) => {

            expect(DatasetSourceService.parseDatasetFolderName(datasetFolderName)).toBeUndefined();

        });

    });

    describe('findKnownRecipeRuns', () => {

        test('lists every run folder with its tree folders, and nothing that is not a run', () => {

            expect(DatasetSourceService.findKnownRecipeRuns(mockGeneratedRecipesPath)).toEqual([
                { runFolderName: snowfakeryRunFolderName, treeFolderNames: ['Case-ONLY'] },
                { runFolderName: fakerJsRunFolderName, treeFolderNames: ['Account-thru-Contact'] }
            ]);

        });

        test('given no GeneratedRecipes folder, lists nothing rather than throwing', () => {

            expect(DatasetSourceService.findKnownRecipeRuns(path.join(mockWorkspacePath, 'missing'))).toEqual([]);

        });

    });

    describe('readDatasetSource -- a recorded datasetSource.json', () => {

        test('given a faker-js data set naming a run and tree on disk, is linked', () => {

            const readResult = readFixture('dataset-fakerjs-2026-09-02T10-00-00');

            expect(readResult).toMatchObject({
                status: 'linked',
                basis: 'recorded',
                recipeRunFolderName: fakerJsRunFolderName,
                recipeTreeFolderName: 'Account-thru-Contact'
            });
            expect(readResult.datasetSource?.recordCountsByObject).toEqual({ Account: 1, Contact: 3 });
            expect(readResult.datasetSource?.fakerService).toBe('faker-js');

        });

        test('given a snowfakery data set naming a run and tree on disk, is linked', () => {

            const readResult = readFixture('dataset-2026-09-05T09-00-00');

            expect(readResult).toMatchObject({
                status: 'linked',
                basis: 'recorded',
                recipeRunFolderName: snowfakeryRunFolderName,
                recipeTreeFolderName: 'Case-ONLY'
            });
            expect(readResult.datasetSource?.fakerService).toBe('snowfakery');

        });

        test('given a folder carrying the same-second suffix, reads it like any other', () => {

            expect(readFixture('dataset-fakerjs-2026-09-02T10-00-00-2').status).toBe('linked');

        });

        test('given a recipe that was directly under GeneratedRecipes, is linked with no run or tree', () => {

            expect(readFixture('dataset-fakerjs-2026-09-06T00-00-00')).toMatchObject({
                status: 'linked',
                basis: 'recorded',
                recipeRunFolderName: null,
                recipeTreeFolderName: null
            });

        });

        test('given a hand-edited "../../etc" run folder name, is unknown', () => {

            const readResult = readFixture('dataset-fakerjs-2026-09-07T00-00-00');

            expect(readResult.status).toBe('unknown');
            expect(readResult.recipeRunFolderName).toBeNull();

        });

        test('given malformed JSON, is unreadable and does not throw', () => {

            expect(readFixture('dataset-fakerjs-2026-09-08T00-00-00')).toMatchObject({
                status: 'unreadable',
                recipeRunFolderName: null,
                recipeTreeFolderName: null
            });

        });

        test('given a run folder that is no longer on disk, is unknown', () => {

            expect(readFixture('dataset-fakerjs-2026-09-09T00-00-00').status).toBe('unknown');

        });

        test('given a run folder that is gone, still names the recorded tree as a hint, which a linked or unsafe result never carries', () => {

            expect(readFixture('dataset-fakerjs-2026-09-09T00-00-00').treeFolderNameHint).toBe(readFixture('dataset-fakerjs-2026-09-09T00-00-00').datasetSource?.recipeTreeFolderName);
            expect(readFixture('dataset-fakerjs-2026-09-09T00-00-00').treeFolderNameHint).toBeString();
            expect(readFixture('dataset-fakerjs-2026-09-02T10-00-00')).not.toHaveProperty('treeFolderNameHint');
            expect(readFixture('dataset-fakerjs-2026-09-07T00-00-00')).not.toHaveProperty('treeFolderNameHint');

        });

        test('given a tree folder the named run does not have, is unknown', () => {

            const knownRecipeRuns: IKnownRecipeRun[] = [{ runFolderName: fakerJsRunFolderName, treeFolderNames: ['Other-ONLY'] }];

            expect(DatasetSourceService.readDatasetSource(path.join(mockFakeDataSetsPath, 'dataset-fakerjs-2026-09-02T10-00-00'), knownRecipeRuns).status)
                .toBe('unknown');

        });

    });

    describe('typeCheckDatasetSource', () => {

        const validDatasetSource: IDatasetSource = {
            schemaVersion: 1,
            origin: 'runFaker',
            recipeRunFolderName: fakerJsRunFolderName,
            recipeTreeFolderName: 'Account-thru-Contact',
            recipeFileName: 'recipe.yml',
            fakerService: 'faker-js',
            generatedAt: '2026-09-02T10:00:00.000Z',
            recordCountsByObject: { Account: 1 }
        };

        test('accepts a valid source', () => {

            expect(DatasetSourceService.typeCheckDatasetSource(validDatasetSource)).toEqual(validDatasetSource);

        });

        test.each([
            ['an array', []],
            ['null', null],
            ['a string', 'datasetSource'],
            ['another schema version', { ...validDatasetSource, schemaVersion: 2 }],
            ['another origin', { ...validDatasetSource, origin: 'createInOrg' }],
            ['a numeric run folder name', { ...validDatasetSource, recipeRunFolderName: 7 }],
            ['a missing tree folder name', { ...validDatasetSource, recipeTreeFolderName: undefined }],
            ['a null recipe file name', { ...validDatasetSource, recipeFileName: null }],
            ['an unknown faker service', { ...validDatasetSource, fakerService: 'mimesis' }],
            ['a numeric generatedAt', { ...validDatasetSource, generatedAt: 0 }],
            ['record counts as an array', { ...validDatasetSource, recordCountsByObject: [1] }],
            ['a negative record count', { ...validDatasetSource, recordCountsByObject: { Account: -1 } }],
            ['a fractional record count', { ...validDatasetSource, recordCountsByObject: { Account: 1.5 } }],
            ['a string record count', { ...validDatasetSource, recordCountsByObject: { Account: '1' } }]
        ])('refuses %s', (_description, candidate) => {

            expect(DatasetSourceService.typeCheckDatasetSource(candidate)).toBeUndefined();

        });

        test('given an object named __proto__, keeps it as an own count', () => {

            const parsedDatasetSource = JSON.parse(JSON.stringify(validDatasetSource).replace('"Account"', '"__proto__"'));

            const typeCheckedSource = DatasetSourceService.typeCheckDatasetSource(parsedDatasetSource);

            expect(Object.prototype.hasOwnProperty.call(typeCheckedSource?.recordCountsByObject, '__proto__')).toBeTrue();
            expect(typeCheckedSource?.recordCountsByObject['__proto__']).toBe(1);

        });

    });

    describe('readDatasetSource -- a data set written before datasetSource.json', () => {

        test('given one recipe copy and one wrapper copy naming a run and tree on disk, infers the link', () => {

            expect(readFixture('dataset-2026-09-04T12-00-00')).toEqual({
                status: 'linked',
                basis: 'inferred',
                recipeRunFolderName: snowfakeryRunFolderName,
                recipeTreeFolderName: 'Case-ONLY',
                reason: expect.any(String)
            });

        });

        test('given two wrapper copies, is unknown', () => {

            expect(readFixture('dataset-2026-09-04T12-30-00')).toMatchObject({
                status: 'unknown',
                basis: 'inferred',
                recipeRunFolderName: null
            });

        });

        test('given a recipe copy with no wrapper copy, is unknown', () => {

            expect(readFixture('dataset-fakerjs-2026-09-03T00-00-00').status).toBe('unknown');

        });

        test('given no BaseArtifactFiles at all, is absent', () => {

            expect(readFixture('dataset-2026-09-10T00-00-00')).toMatchObject({
                status: 'absent',
                basis: 'none'
            });

        });

        describe('given copies in a temporary data set', () => {

            let temporaryDatasetPath: string;

            const writeBaseArtifact = (fileName: string) => {
                fs.mkdirSync(path.join(temporaryDatasetPath, 'BaseArtifactFiles'), { recursive: true });
                fs.writeFileSync(path.join(temporaryDatasetPath, 'BaseArtifactFiles', fileName), '');
            };

            const knownRecipeRuns: IKnownRecipeRun[] = [
                { runFolderName: snowfakeryRunFolderName, treeFolderNames: ['Case-ONLY'] },
                { runFolderName: 'recipe-fakerjs-2026-09-04T11-22-07', treeFolderNames: ['Case-ONLY'] }
            ];

            beforeEach(() => {
                temporaryDatasetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-dataset-'));
            });

            afterEach(() => {
                fs.rmSync(temporaryDatasetPath, { recursive: true, force: true });
            });

            test('given a faker-js recipe copy, picks the faker-js run of the same second', () => {

                writeBaseArtifact('originalRecipe-recipe-fakerjs--Case-ONLY-2026-09-04T11-22-07.yml');
                writeBaseArtifact('originalTreecipeWrapper-treecipeObjectsWrapper-2026-09-04T11-22-07.json');

                expect(DatasetSourceService.readDatasetSource(temporaryDatasetPath, knownRecipeRuns)).toMatchObject({
                    status: 'linked',
                    recipeRunFolderName: 'recipe-fakerjs-2026-09-04T11-22-07'
                });

            });

            test('given copies naming two different runs, is unknown', () => {

                writeBaseArtifact('originalRecipe-recipe--Case-ONLY-2026-09-04T11-22-07.yml');
                writeBaseArtifact('originalTreecipeWrapper-treecipeObjectsWrapper-2026-09-01T08-00-00.json');

                expect(DatasetSourceService.readDatasetSource(temporaryDatasetPath, knownRecipeRuns).status).toBe('unknown');

            });

            test('given two recipe copies, is unknown', () => {

                writeBaseArtifact('originalRecipe-recipe--Case-ONLY-2026-09-04T11-22-07.yml');
                writeBaseArtifact('originalRecipe-recipe--Lead-ONLY-2026-09-04T11-22-07.yml');
                writeBaseArtifact('originalTreecipeWrapper-treecipeObjectsWrapper-2026-09-04T11-22-07.json');

                expect(DatasetSourceService.readDatasetSource(temporaryDatasetPath, knownRecipeRuns).status).toBe('unknown');

            });

            test('given a tree folder the run does not have, is unknown', () => {

                writeBaseArtifact('originalRecipe-recipe--Lead-ONLY-2026-09-04T11-22-07.yml');
                writeBaseArtifact('originalTreecipeWrapper-treecipeObjectsWrapper-2026-09-04T11-22-07.json');

                expect(DatasetSourceService.readDatasetSource(temporaryDatasetPath, knownRecipeRuns).status).toBe('unknown');

            });

            test('given a run no longer on disk, is unknown', () => {

                writeBaseArtifact('originalRecipe-recipe--Case-ONLY-2026-09-04T11-22-07.yml');
                writeBaseArtifact('originalTreecipeWrapper-treecipeObjectsWrapper-2026-09-04T11-22-07.json');

                expect(DatasetSourceService.readDatasetSource(temporaryDatasetPath, []).status).toBe('unknown');

            });

            test('given copies naming a run no longer on disk or another run, keeps the copied tree name as a hint', () => {

                writeBaseArtifact('originalRecipe-recipe--Case-ONLY-2026-09-04T11-22-07.yml');
                writeBaseArtifact('originalTreecipeWrapper-treecipeObjectsWrapper-2026-09-04T11-22-07.json');

                expect(DatasetSourceService.readDatasetSource(temporaryDatasetPath, [])).toMatchObject({ status: 'unknown', treeFolderNameHint: 'Case-ONLY' });

                writeBaseArtifact('originalTreecipeWrapper-treecipeObjectsWrapper-2026-09-01T08-00-00.json');
                fs.rmSync(path.join(temporaryDatasetPath, 'BaseArtifactFiles', 'originalTreecipeWrapper-treecipeObjectsWrapper-2026-09-04T11-22-07.json'));

                expect(DatasetSourceService.readDatasetSource(temporaryDatasetPath, knownRecipeRuns)).toMatchObject({ status: 'unknown', treeFolderNameHint: 'Case-ONLY' });

            });

            test('given a copied tree name that is not a plain folder name, carries no hint', () => {

                writeBaseArtifact('originalRecipe-recipe--a..b-2026-09-04T11-22-07.yml');
                writeBaseArtifact('originalTreecipeWrapper-treecipeObjectsWrapper-2026-09-04T11-22-07.json');

                const readResult = DatasetSourceService.readDatasetSource(temporaryDatasetPath, []);

                expect(readResult.status).toBe('unknown');
                expect(readResult).not.toHaveProperty('treeFolderNameHint');

            });

            test('given a recorded run that is gone and no tree, carries no hint', () => {

                fs.mkdirSync(path.join(temporaryDatasetPath, 'BaseArtifactFiles'), { recursive: true });
                DatasetSourceService.writeDatasetSourceFile(path.join(temporaryDatasetPath, 'BaseArtifactFiles'), DatasetSourceService.buildDatasetSource(
                    { recipeRunFolderName: 'recipe-2026-01-01T00-00-00', recipeTreeFolderName: null, recipeFileName: 'recipe.yml' },
                    'snowfakery', '2026-01-02T00:00:00.000Z', {}
                ));

                const readResult = DatasetSourceService.readDatasetSource(temporaryDatasetPath, knownRecipeRuns);

                expect(readResult.status).toBe('unknown');
                expect(readResult).not.toHaveProperty('treeFolderNameHint');

            });

            test('given copy names that carry no timestamp, is unknown', () => {

                writeBaseArtifact('originalRecipe-hand-written.yml');
                writeBaseArtifact('originalTreecipeWrapper-treecipeObjectsWrapper-latest.json');

                expect(DatasetSourceService.readDatasetSource(temporaryDatasetPath, knownRecipeRuns).status).toBe('unknown');

            });

            test('given a datasetSource.json that cannot be read as a file, is unreadable and does not throw', () => {

                fs.mkdirSync(path.join(temporaryDatasetPath, 'BaseArtifactFiles', DATASET_SOURCE_FILE_NAME), { recursive: true });

                expect(DatasetSourceService.readDatasetSource(temporaryDatasetPath, knownRecipeRuns).status).toBe('unreadable');

            });

        });

    });

    describe('countLegacyRecordsByObject', () => {

        let temporaryDatasetPath: string;

        const writeCollectionsApiFile = (fileName: string, fileContent: string) => {
            fs.mkdirSync(path.join(temporaryDatasetPath, DATASET_COLLECTIONS_API_FOLDER_NAME), { recursive: true });
            fs.writeFileSync(path.join(temporaryDatasetPath, DATASET_COLLECTIONS_API_FOLDER_NAME, fileName), fileContent);
        };

        beforeEach(() => {
            temporaryDatasetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-counts-'));
        });

        afterEach(() => {
            fs.rmSync(temporaryDatasetPath, { recursive: true, force: true });
        });

        test('counts each Collections API file\'s records under the object its name carries', () => {

            writeCollectionsApiFile('collectionsApi-Account.json', JSON.stringify({ allOrNone: true, records: [{}, {}] }));
            writeCollectionsApiFile('collectionsApi-Contact.json', JSON.stringify({ allOrNone: true, records: [] }));
            writeCollectionsApiFile('notes.txt', 'not a Collections API file');

            expect(DatasetSourceService.countLegacyRecordsByObject(temporaryDatasetPath)).toEqual({
                recordCountsByObject: { Account: 2, Contact: 0 },
                unreadableFileNames: []
            });

        });

        test('lists a file that is not JSON, or has no records array, rather than counting it as zero', () => {

            writeCollectionsApiFile('collectionsApi-Lead.json', '{ not json');
            writeCollectionsApiFile('collectionsApi-Case.json', JSON.stringify({ records: 'many' }));

            expect(DatasetSourceService.countLegacyRecordsByObject(temporaryDatasetPath)).toEqual({
                recordCountsByObject: {},
                unreadableFileNames: ['collectionsApi-Case.json', 'collectionsApi-Lead.json']
            });

        });

        test('keeps an object named __proto__ as a count rather than a prototype', () => {

            writeCollectionsApiFile('collectionsApi-__proto__.json', JSON.stringify({ records: [{}] }));

            const { recordCountsByObject } = DatasetSourceService.countLegacyRecordsByObject(temporaryDatasetPath);

            expect(Object.keys(recordCountsByObject)).toEqual(['__proto__']);
            expect(recordCountsByObject['__proto__']).toBe(1);

        });

        test('given no Collections API folder, counts nothing and does not throw', () => {

            expect(DatasetSourceService.countLegacyRecordsByObject(path.join(temporaryDatasetPath, 'missing'))).toEqual({
                recordCountsByObject: {},
                unreadableFileNames: []
            });

        });

    });

    describe('findDatasets', () => {

        test('lists every data set folder, suffixed ones included, each with its source', () => {

            const datasetListings = DatasetSourceService.findDatasets(
                mockFakeDataSetsPath,
                DatasetSourceService.findKnownRecipeRuns(mockGeneratedRecipesPath)
            );

            expect(datasetListings.map(datasetListing => [datasetListing.datasetFolderName, datasetListing.source.status])).toEqual([
                ['dataset-2026-09-04T12-00-00', 'linked'],
                ['dataset-2026-09-04T12-30-00', 'unknown'],
                ['dataset-2026-09-05T09-00-00', 'linked'],
                ['dataset-2026-09-10T00-00-00', 'absent'],
                ['dataset-fakerjs-2026-09-02T10-00-00', 'linked'],
                ['dataset-fakerjs-2026-09-02T10-00-00-2', 'linked'],
                ['dataset-fakerjs-2026-09-03T00-00-00', 'unknown'],
                ['dataset-fakerjs-2026-09-06T00-00-00', 'linked'],
                ['dataset-fakerjs-2026-09-07T00-00-00', 'unknown'],
                ['dataset-fakerjs-2026-09-08T00-00-00', 'unreadable'],
                ['dataset-fakerjs-2026-09-09T00-00-00', 'unknown']
            ]);
            expect(datasetListings.find(datasetListing => datasetListing.datasetFolderName.endsWith('-2'))?.folderNameDetail.collisionSuffix).toBe(2);

        });

        test('given no FakeDataSets folder, lists nothing rather than throwing', () => {

            expect(DatasetSourceService.findDatasets(path.join(mockWorkspacePath, 'missing'), [])).toEqual([]);

        });

    });

});
