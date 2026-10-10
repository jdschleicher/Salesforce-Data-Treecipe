import * as fs from 'fs';
import * as path from 'path';

export const DATASET_SOURCE_FILE_NAME = 'datasetSource.json';

export const DATASET_SOURCE_SCHEMA_VERSION = 1;

const BASE_ARTIFACT_FILES_FOLDER_NAME = 'BaseArtifactFiles';

// ConfigurationService.getDatasetFilesForCollectionsApiFolderName, repeated so this service keeps importing only fs and path
export const DATASET_COLLECTIONS_API_FOLDER_NAME = 'DatasetFilesForCollectionsApi';

const COLLECTIONS_API_FILE_NAME_PATTERN = /^collectionsApi-(.+)\.json$/;

const ORIGINAL_RECIPE_FILE_PREFIX = 'originalRecipe-';

const ORIGINAL_WRAPPER_FILE_PREFIX = 'originalTreecipeWrapper-treecipeObjectsWrapper-';

const TIMESTAMP_PATTERN_SOURCE = '\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}';

/*
    A data set folder is "dataset-<ts>" or "dataset-fakerjs-<ts>", and since two runs in the same
    second no longer collide, optionally "-<n>" after it. The suffix starts at 2: the first folder
    for a second keeps the plain name every existing data set already has.
*/
const DATASET_FOLDER_NAME_PATTERN = new RegExp(`^dataset-(?:(fakerjs)-)?(${TIMESTAMP_PATTERN_SOURCE})(?:-([2-9]|[1-9]\\d+))?$`);

const RECIPE_RUN_FOLDER_NAME_PATTERN = new RegExp(`^recipe(?:-fakerjs)?-${TIMESTAMP_PATTERN_SOURCE}$`);

const LEGACY_WRAPPER_FILE_NAME_PATTERN = new RegExp(`^${ORIGINAL_WRAPPER_FILE_PREFIX}(${TIMESTAMP_PATTERN_SOURCE})\\.json$`);

const LEGACY_RECIPE_FILE_NAME_PATTERN = new RegExp(`^${ORIGINAL_RECIPE_FILE_PREFIX}(recipe(?:-fakerjs)?)--(.+)-(${TIMESTAMP_PATTERN_SOURCE})\\.ya?ml$`);

export type DatasetSourceFakerService = 'faker-js' | 'snowfakery';

export type DatasetSourceStatus = 'linked' | 'unreadable' | 'absent' | 'unknown';

export type DatasetSourceOrigin = 'runFaker' | 'createInOrg';

/*
    origin "createInOrg" is a data set the Recipe Cockpit's Create made and INSERTED (#180): it also
    names the org (by username), the one object created, and the Ids the insert returned. Those three
    are present exactly when the origin is createInOrg.
*/
export interface IDatasetSource {
    schemaVersion: 1;
    origin: DatasetSourceOrigin;
    recipeRunFolderName: string | null;
    recipeTreeFolderName: string | null;
    recipeFileName: string;
    fakerService: DatasetSourceFakerService;
    generatedAt: string;
    recordCountsByObject: Record<string, number>;
    orgUsername?: string;
    createdObjectApiName?: string;
    createdRecordIds?: string[];
}

export interface IRecipeSourceNames {
    recipeRunFolderName: string | null;
    recipeTreeFolderName: string | null;
    recipeFileName: string;
}

export interface IKnownRecipeRun {
    runFolderName: string;
    treeFolderNames: string[];
}

/*
    "recorded" is a datasetSource.json the reader type-checked; "inferred" is a data set written
    before that file existed, linked from the names of the copies in its BaseArtifactFiles.
*/
export interface IDatasetSourceReadResult {
    status: DatasetSourceStatus;
    basis: 'recorded' | 'inferred' | 'none';
    recipeRunFolderName: string | null;
    recipeTreeFolderName: string | null;
    datasetSource?: IDatasetSource;
    reason: string;
    /*
        Set only on an "unknown" result whose source still names a tree folder -- a run folder that
        is gone, or legacy copies that disagree on the run. The tree is a plain name either way, so
        a reader can still place the data set under that tree with its version unknown.
    */
    treeFolderNameHint?: string;
}

export interface ILegacyRecordCountResult {
    recordCountsByObject: Record<string, number>;
    unreadableFileNames: string[];
}

export interface IDatasetFolderNameDetail {
    fakerService: DatasetSourceFakerService;
    timestamp: string;
    collisionSuffix: number | null;
}

export interface IDatasetListing {
    datasetFolderName: string;
    datasetFolderPath: string;
    folderNameDetail: IDatasetFolderNameDetail;
    source: IDatasetSourceReadResult;
}

export class DatasetSourceService {

    /*
        A name with no separator can only act as a path when it IS "." or "..", so only those
        segments are refused: "my..recipe.yml" or "team..v2" is a name a hand-placed recipe can have.
    */
    static isSafeFolderOrFileName(candidateName: string): boolean {

        return candidateName.length > 0
                && candidateName !== '.'
                && candidateName !== '..'
                && !candidateName.includes('/')
                && !candidateName.includes('\\');

    }

    /*
        Where a recipe sits under GeneratedRecipes, as names. Generate Treecipe writes
        <run>/<tree>/<file>; a recipe placed directly under GeneratedRecipes belongs to no run.
        Throws rather than recording a name that is not one, because the file is read back as names
        and a separator in one, or a name that is "." or "..", would make it a path. The message
        names NO part of the path: it reaches a VS Code notification, which renders
        "[label](command:...)" in a file name as a link that runs the command.
    */
    static resolveRecipeSourceNames(generatedRecipesFolderPath: string, recipeFilePath: string): IRecipeSourceNames {

        const relativeRecipePath = path.relative(path.resolve(generatedRecipesFolderPath), path.resolve(recipeFilePath));
        const pathSegments = relativeRecipePath.split(/[\\/]/).filter(pathSegment => pathSegment.length > 0);

        const recipeFileName = pathSegments.at(-1) ?? '';
        const recipeRunFolderName = pathSegments.length >= 2 ? pathSegments[0] : null;
        const recipeTreeFolderName = pathSegments.length >= 3 ? pathSegments.at(-2) : null;

        const recordedNames = [recipeFileName, recipeRunFolderName, recipeTreeFolderName].filter(recordedName => recordedName !== null);
        if ( path.isAbsolute(relativeRecipePath) || !recordedNames.every(recordedName => this.isSafeFolderOrFileName(recordedName)) ) {
            throw new Error('The selected recipe is not inside the GeneratedRecipes folder, or a folder or file name on its path is not a plain name, so its data set source cannot be recorded.');
        }

        return { recipeRunFolderName, recipeTreeFolderName, recipeFileName };

    }

    static countRecordsByObject(collectionsApiContentBySObject: Map<string, { records?: unknown }>): Record<string, number> {

        const recordCountsByObject: Record<string, number> = Object.create(null);

        collectionsApiContentBySObject.forEach((collectionsApiContent, sobjectApiName) => {
            const records = collectionsApiContent?.records;
            recordCountsByObject[sobjectApiName] = Array.isArray(records) ? records.length : 0;
        });

        return recordCountsByObject;

    }

    static buildDatasetSource(recipeSourceNames: IRecipeSourceNames,
                                fakerService: DatasetSourceFakerService,
                                generatedAt: string,
                                recordCountsByObject: Record<string, number>): IDatasetSource {

        return {
            schemaVersion: DATASET_SOURCE_SCHEMA_VERSION,
            origin: 'runFaker',
            recipeRunFolderName: recipeSourceNames.recipeRunFolderName,
            recipeTreeFolderName: recipeSourceNames.recipeTreeFolderName,
            recipeFileName: recipeSourceNames.recipeFileName,
            fakerService: fakerService,
            generatedAt: generatedAt,
            recordCountsByObject: recordCountsByObject
        };

    }

    static buildCreateInOrgDatasetSource(recipeSourceNames: IRecipeSourceNames,
                                            fakerService: DatasetSourceFakerService,
                                            generatedAt: string,
                                            recordCountsByObject: Record<string, number>,
                                            orgUsername: string,
                                            createdObjectApiName: string,
                                            createdRecordIds: string[]): IDatasetSource {

        return {
            ...this.buildDatasetSource(recipeSourceNames, fakerService, generatedAt, recordCountsByObject),
            origin: 'createInOrg',
            orgUsername: orgUsername,
            createdObjectApiName: createdObjectApiName,
            createdRecordIds: [...createdRecordIds]
        };

    }

    static writeDatasetSourceFile(baseArtifactsFolderPath: string, datasetSource: IDatasetSource): string {

        const datasetSourceFilePath = path.join(baseArtifactsFolderPath, DATASET_SOURCE_FILE_NAME);
        fs.writeFileSync(datasetSourceFilePath, `${JSON.stringify(datasetSource, null, 2)}\n`);
        return datasetSourceFilePath;

    }

    static parseDatasetFolderName(datasetFolderName: string): IDatasetFolderNameDetail | undefined {

        const folderNameMatch = DATASET_FOLDER_NAME_PATTERN.exec(datasetFolderName);
        if ( !folderNameMatch ) {
            return undefined;
        }

        const [, fakerJsIndicator, timestamp, collisionSuffix] = folderNameMatch;

        return {
            fakerService: fakerJsIndicator ? 'faker-js' : 'snowfakery',
            timestamp: timestamp,
            collisionSuffix: collisionSuffix ? Number(collisionSuffix) : null
        };

    }

    // EVERY RUN FOLDER UNDER GeneratedRecipes WITH THE TREE FOLDERS DIRECTLY INSIDE IT -- WHAT A RECORDED NAME IS MATCHED AGAINST
    static findKnownRecipeRuns(generatedRecipesFolderPath: string): IKnownRecipeRun[] {

        const runFolderEntries = this.readDirectoryEntries(generatedRecipesFolderPath);

        return runFolderEntries
            .filter(runFolderEntry => runFolderEntry.isDirectory() && RECIPE_RUN_FOLDER_NAME_PATTERN.test(runFolderEntry.name))
            .map(runFolderEntry => ({
                runFolderName: runFolderEntry.name,
                treeFolderNames: this.readDirectoryEntries(path.join(generatedRecipesFolderPath, runFolderEntry.name))
                    .filter(treeFolderEntry => treeFolderEntry.isDirectory())
                    .map(treeFolderEntry => treeFolderEntry.name)
                    .sort()
            }))
            .sort((firstRun, secondRun) => (firstRun.runFolderName < secondRun.runFolderName ? -1 : firstRun.runFolderName > secondRun.runFolderName ? 1 : 0));

    }

    static findDatasets(fakeDataSetsFolderPath: string, knownRecipeRuns: IKnownRecipeRun[]): IDatasetListing[] {

        const datasetListings: IDatasetListing[] = [];

        this.readDirectoryEntries(fakeDataSetsFolderPath).forEach(datasetFolderEntry => {

            const folderNameDetail = datasetFolderEntry.isDirectory() ? this.parseDatasetFolderName(datasetFolderEntry.name) : undefined;
            if ( !folderNameDetail ) {
                return;
            }

            const datasetFolderPath = path.join(fakeDataSetsFolderPath, datasetFolderEntry.name);

            datasetListings.push({
                datasetFolderName: datasetFolderEntry.name,
                datasetFolderPath: datasetFolderPath,
                folderNameDetail: folderNameDetail,
                source: this.readDatasetSource(datasetFolderPath, knownRecipeRuns)
            });

        });

        return datasetListings.sort((firstListing, secondListing) => (
            (firstListing.datasetFolderName < secondListing.datasetFolderName ? -1 : firstListing.datasetFolderName > secondListing.datasetFolderName ? 1 : 0)
        ));

    }

    // NEVER THROWS: A DATA SET THE READER CANNOT PLACE IS A STATUS, NOT A FAILURE OF WHATEVER IS LISTING IT
    static readDatasetSource(datasetFolderPath: string, knownRecipeRuns: IKnownRecipeRun[]): IDatasetSourceReadResult {

        const baseArtifactsFolderPath = path.join(datasetFolderPath, BASE_ARTIFACT_FILES_FOLDER_NAME);
        const datasetSourceFilePath = path.join(baseArtifactsFolderPath, DATASET_SOURCE_FILE_NAME);

        let datasetSourceContent: string;
        try {
            datasetSourceContent = fs.readFileSync(datasetSourceFilePath, 'utf8');
        } catch (readError) {
            if ( (readError as NodeJS.ErrnoException)?.code === 'ENOENT' ) {
                return this.inferLegacyDatasetSource(datasetFolderPath, baseArtifactsFolderPath, knownRecipeRuns);
            }
            return this.buildReadResult('unreadable', 'recorded', `${DATASET_SOURCE_FILE_NAME} could not be read.`);
        }

        let parsedDatasetSource: unknown;
        try {
            parsedDatasetSource = JSON.parse(datasetSourceContent);
        } catch {
            return this.buildReadResult('unreadable', 'recorded', `${DATASET_SOURCE_FILE_NAME} is not valid JSON.`);
        }

        const datasetSource = this.typeCheckDatasetSource(parsedDatasetSource);
        if ( !datasetSource ) {
            return this.buildReadResult('unreadable', 'recorded', `${DATASET_SOURCE_FILE_NAME} does not have the expected fields.`);
        }

        return this.matchRecordedNames(datasetSource, knownRecipeRuns);

    }

    static typeCheckDatasetSource(parsedDatasetSource: unknown): IDatasetSource | undefined {

        if ( typeof parsedDatasetSource !== 'object' || parsedDatasetSource === null || Array.isArray(parsedDatasetSource) ) {
            return undefined;
        }

        const candidate = parsedDatasetSource as Record<string, unknown>;
        const isStringOrNull = (candidateValue: unknown) => candidateValue === null || typeof candidateValue === 'string';

        const recordCounts = candidate.recordCountsByObject;
        const isRecordCountMap = typeof recordCounts === 'object'
                                    && recordCounts !== null
                                    && !Array.isArray(recordCounts)
                                    && Object.values(recordCounts).every(recordCount => (
                                        typeof recordCount === 'number' && Number.isInteger(recordCount) && recordCount >= 0
                                    ));

        const isCreateInOrg = candidate.origin === 'createInOrg';
        const isCreateInOrgDetailValid = !isCreateInOrg || (
            typeof candidate.orgUsername === 'string'
            && typeof candidate.createdObjectApiName === 'string'
            && Array.isArray(candidate.createdRecordIds)
            && candidate.createdRecordIds.every(createdRecordId => typeof createdRecordId === 'string')
        );

        const isValid = candidate.schemaVersion === DATASET_SOURCE_SCHEMA_VERSION
                        && (candidate.origin === 'runFaker' || isCreateInOrg)
                        && isCreateInOrgDetailValid
                        && isStringOrNull(candidate.recipeRunFolderName)
                        && isStringOrNull(candidate.recipeTreeFolderName)
                        && typeof candidate.recipeFileName === 'string'
                        && (candidate.fakerService === 'faker-js' || candidate.fakerService === 'snowfakery')
                        && typeof candidate.generatedAt === 'string'
                        && isRecordCountMap;

        if ( !isValid ) {
            return undefined;
        }

        const recordCountsByObject: Record<string, number> = Object.create(null);
        Object.entries(recordCounts as Record<string, number>).forEach(([sobjectApiName, recordCount]) => {
            recordCountsByObject[sobjectApiName] = recordCount;
        });

        return {
            schemaVersion: DATASET_SOURCE_SCHEMA_VERSION,
            origin: isCreateInOrg ? 'createInOrg' : 'runFaker',
            recipeRunFolderName: candidate.recipeRunFolderName as string | null,
            recipeTreeFolderName: candidate.recipeTreeFolderName as string | null,
            recipeFileName: candidate.recipeFileName as string,
            fakerService: candidate.fakerService as DatasetSourceFakerService,
            generatedAt: candidate.generatedAt as string,
            recordCountsByObject: recordCountsByObject,
            ...( isCreateInOrg ? {
                orgUsername: candidate.orgUsername as string,
                createdObjectApiName: candidate.createdObjectApiName as string,
                createdRecordIds: [...(candidate.createdRecordIds as string[])]
            } : {} )
        };

    }

    private static matchRecordedNames(datasetSource: IDatasetSource, knownRecipeRuns: IKnownRecipeRun[]): IDatasetSourceReadResult {

        const { recipeRunFolderName, recipeTreeFolderName, recipeFileName } = datasetSource;

        const recordedNames = [recipeFileName, recipeRunFolderName, recipeTreeFolderName].filter(recordedName => recordedName !== null);
        if ( !recordedNames.every(recordedName => this.isSafeFolderOrFileName(recordedName)) ) {
            return { ...this.buildReadResult('unknown', 'recorded', 'A recorded name is not a plain folder or file name.'), datasetSource };
        }

        const unknownResult = (reason: string) => ({
            ...this.buildReadResult('unknown', 'recorded', reason),
            datasetSource,
            ...( recipeTreeFolderName !== null ? { treeFolderNameHint: recipeTreeFolderName } : {} )
        });

        if ( recipeRunFolderName === null ) {
            return recipeTreeFolderName === null
                ? { ...this.buildReadResult('linked', 'recorded', 'The recipe was not in a Generate Treecipe run folder.'), datasetSource }
                : unknownResult('A tree folder is recorded without a run folder.');
        }

        const matchingRun = knownRecipeRuns.find(knownRun => knownRun.runFolderName === recipeRunFolderName);
        if ( !matchingRun ) {
            return unknownResult(`No recipe run folder named "${recipeRunFolderName}" was found.`);
        }

        if ( recipeTreeFolderName !== null && !matchingRun.treeFolderNames.includes(recipeTreeFolderName) ) {
            return unknownResult(`The recipe run "${recipeRunFolderName}" has no tree folder named "${recipeTreeFolderName}".`);
        }

        return {
            status: 'linked',
            basis: 'recorded',
            recipeRunFolderName: recipeRunFolderName,
            recipeTreeFolderName: recipeTreeFolderName,
            datasetSource: datasetSource,
            reason: 'Linked from datasetSource.json.'
        };

    }

    /*
        A data set from before datasetSource.json. Its BaseArtifactFiles holds a copy of the recipe
        and of the run's wrapper, each prefixed and otherwise keeping the name Generate Treecipe gave
        it: the wrapper's name carries the run timestamp and the recipe's carries the tree folder.
        Exactly one of each, agreeing on the timestamp and naming a run and tree that are still on
        disk, links it; anything less is "unknown" rather than a guess.
    */
    private static inferLegacyDatasetSource(datasetFolderPath: string,
                                            baseArtifactsFolderPath: string,
                                            knownRecipeRuns: IKnownRecipeRun[]): IDatasetSourceReadResult {

        const baseArtifactFileNames = this.readDirectoryEntries(baseArtifactsFolderPath)
            .filter(baseArtifactEntry => baseArtifactEntry.isFile())
            .map(baseArtifactEntry => baseArtifactEntry.name);

        const recipeCopyFileNames = baseArtifactFileNames.filter(fileName => fileName.startsWith(ORIGINAL_RECIPE_FILE_PREFIX));
        const wrapperCopyFileNames = baseArtifactFileNames.filter(fileName => fileName.startsWith(ORIGINAL_WRAPPER_FILE_PREFIX));

        if ( recipeCopyFileNames.length === 0 && wrapperCopyFileNames.length === 0 ) {
            return this.buildReadResult('absent', 'none', `The data set at "${path.basename(datasetFolderPath)}" records no source.`);
        }

        const unknownResult = (reason: string) => this.buildReadResult('unknown', 'inferred', reason);

        if ( wrapperCopyFileNames.length !== 1 ) {
            return unknownResult(`Expected one treecipe wrapper copy, found ${wrapperCopyFileNames.length}.`);
        }

        if ( recipeCopyFileNames.length !== 1 ) {
            return unknownResult(`Expected one recipe copy, found ${recipeCopyFileNames.length}.`);
        }

        const wrapperMatch = LEGACY_WRAPPER_FILE_NAME_PATTERN.exec(wrapperCopyFileNames[0]);
        const recipeMatch = LEGACY_RECIPE_FILE_NAME_PATTERN.exec(recipeCopyFileNames[0]);

        if ( !wrapperMatch || !recipeMatch ) {
            return unknownResult('The copied file names do not carry a run timestamp and tree folder.');
        }

        const [, wrapperTimestamp] = wrapperMatch;
        const [, recipePrefix, recipeTreeFolderName, recipeTimestamp] = recipeMatch;

        const unknownTreeResult = (reason: string) => ({
            ...unknownResult(reason),
            ...( this.isSafeFolderOrFileName(recipeTreeFolderName) ? { treeFolderNameHint: recipeTreeFolderName } : {} )
        });

        if ( wrapperTimestamp !== recipeTimestamp ) {
            return unknownTreeResult('The recipe copy and the wrapper copy name different runs.');
        }

        const recipeRunFolderName = `${recipePrefix}-${wrapperTimestamp}`;
        const matchingRun = knownRecipeRuns.find(knownRun => knownRun.runFolderName === recipeRunFolderName);

        if ( !matchingRun ) {
            return unknownTreeResult(`No recipe run folder named "${recipeRunFolderName}" was found.`);
        }

        if ( !this.isSafeFolderOrFileName(recipeTreeFolderName) || !matchingRun.treeFolderNames.includes(recipeTreeFolderName) ) {
            return unknownTreeResult(`The recipe run "${recipeRunFolderName}" has no tree folder named "${recipeTreeFolderName}".`);
        }

        return {
            status: 'linked',
            basis: 'inferred',
            recipeRunFolderName: recipeRunFolderName,
            recipeTreeFolderName: recipeTreeFolderName,
            reason: 'Inferred from the recipe and wrapper copies.'
        };

    }

    /*
        A data set's record counts read from the Collections API files it holds, for one written
        before datasetSource.json recorded them. One file per object, named for it; a file that is
        not JSON with a records array is listed rather than counted as zero, because zero is a
        count. Never throws, like readDatasetSource.
    */
    static countLegacyRecordsByObject(datasetFolderPath: string): ILegacyRecordCountResult {

        const collectionsApiFolderPath = path.join(datasetFolderPath, DATASET_COLLECTIONS_API_FOLDER_NAME);
        const recordCountsByObject: Record<string, number> = Object.create(null);
        const unreadableFileNames: string[] = [];

        this.readDirectoryEntries(collectionsApiFolderPath)
            .filter(collectionsApiEntry => collectionsApiEntry.isFile())
            .map(collectionsApiEntry => collectionsApiEntry.name)
            .sort()
            .forEach(collectionsApiFileName => {

                const fileNameMatch = COLLECTIONS_API_FILE_NAME_PATTERN.exec(collectionsApiFileName);
                if ( !fileNameMatch ) {
                    return;
                }

                try {
                    const parsedContent = JSON.parse(fs.readFileSync(path.join(collectionsApiFolderPath, collectionsApiFileName), 'utf8'));
                    if ( !Array.isArray(parsedContent?.records) ) {
                        unreadableFileNames.push(collectionsApiFileName);
                        return;
                    }
                    recordCountsByObject[fileNameMatch[1]] = parsedContent.records.length;
                } catch {
                    unreadableFileNames.push(collectionsApiFileName);
                }

            });

        return { recordCountsByObject, unreadableFileNames };

    }

    private static buildReadResult(status: DatasetSourceStatus, basis: IDatasetSourceReadResult['basis'], reason: string): IDatasetSourceReadResult {

        return {
            status: status,
            basis: basis,
            recipeRunFolderName: null,
            recipeTreeFolderName: null,
            reason: reason
        };

    }

    private static readDirectoryEntries(directoryPath: string): fs.Dirent[] {

        try {
            return fs.readdirSync(directoryPath, { withFileTypes: true });
        } catch {
            return [];
        }

    }

}
