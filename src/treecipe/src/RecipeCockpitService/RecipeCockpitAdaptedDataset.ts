import * as fs from 'fs';
import * as path from 'path';

import {
    DATASET_ADAPTED_NAME_MARKER,
    DATASET_COLLECTIONS_API_FOLDER_NAME,
    DatasetSourceFakerService,
    DatasetSourceService,
    IDatasetSourceAdaptation
} from '../DatasetSourceService/DatasetSourceService';
import { SalesforceApiName } from '../RecipeService/SalesforceApiName';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';
import { IAdaptedRecipeField, RecipeCockpitRecipeWriter } from './RecipeCockpitRecipeWriter';

// "<recipe>-adapted-20261025-143005.yml", WITH THE DATA SET'S "-<n>": A SIDE FILE, NEVER A TREE'S RECIPE (#448)
const ADAPTED_RECIPE_FILE_NAME_PATTERN = /-adapted-\d{8}-\d{6}(?:-(?:[2-9]|[1-9]\d+))?\.ya?ml$/i;

// ConfigurationService.getBaseArtifactsFolderName, REPEATED SO THIS MODULE NEEDS NO vscode
const BASE_ARTIFACT_FILES_FOLDER_NAME = 'BaseArtifactFiles';

const ADAPTED_NAME_ATTEMPTS = 100;

const SALESFORCE_ID_PATTERN = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

/*
    One object's records as they are in the org now: each loaded record, with the values the adapt
    run wrote to it laid over it -- only for a record the org saved, so newValuesByRecordId holds no
    other. The two are merged as each record is written, so no copy of the load is made first.
*/
export interface IAdaptedObjectRecords {
    objectApiName: string;
    records: readonly Record<string, unknown>[];
    newValuesByRecordId?: ReadonlyMap<string, Record<string, unknown>>;
}

export interface IAdaptedRunRequest {
    workspaceRoot: string;
    fakeDataSetsFolderPath: string;
    generatedRecipesFolderPath: string;
    // THE CARD'S RECIPE, WHICH IS READ AND NEVER WRITTEN
    recipeFilePath: string;
    treeFolderName: string;
    fakerService: DatasetSourceFakerService;
    date: Date;
    objects: IAdaptedObjectRecords[];
    adaptedFields: IAdaptedRecipeField[];
    adaptation: Omit<IDatasetSourceAdaptation, 'adaptedRecipeFileName'>;
    orgLabel: string;
}

/*
    The data set folder is written or nothing is. The adapted recipe is written beside the recipe
    when it can be; recipeRefusal says why it was not, and the data set records no recipe then.
*/
export type RecipeCockpitAdaptedRunWrite =
    | { isWritten: true; datasetFolderPath: string; adaptedRecipeFilePath?: string; recipeRefusal?: string }
    | { isWritten: false; refusal: string };

export class RecipeCockpitAdaptedDataset {

    static isAdaptedRecipeFileName(fileName: string): boolean {
        return ADAPTED_RECIPE_FILE_NAME_PATTERN.test(fileName);
    }

    /*
        A Collections API file's records for one object (#448), keyed by Id: each record's referenceId
        carries its Id where a generated one carries a nickname, so an insert of this data set swaps
        a lookup that names a record of the data set for that record's new Id, as it swaps a nickname.
        The Id and the query's attributes are left out of the fields, and a record's new values are
        laid over its loaded ones in the same pass. A record with no Id is left out.
    */
    static buildCollectionsApiRecords(objectApiName: string,
                                      records: readonly Record<string, unknown>[],
                                      newValuesByRecordId: ReadonlyMap<string, Record<string, unknown>> = new Map()): Record<string, unknown>[] {

        const collectionsApiRecords: Record<string, unknown>[] = [];

        records.forEach(record => {

            const recordId = record.Id;
            if ( typeof recordId !== 'string' || !SALESFORCE_ID_PATTERN.test(recordId) ) {
                return;
            }

            const collectionsApiRecord: Record<string, unknown> = {
                attributes: { type: objectApiName, referenceId: `${objectApiName}_Reference_${collectionsApiRecords.length + 1}__${recordId}` }
            };
            // A FIELD NAME IS THE ORG'S, NEVER "__proto__"; ONE THAT WAS WOULD SET A PROTOTYPE, SO IT IS LEFT OUT
            const defineField = (fieldApiName: string, fieldValue: unknown) => {
                if ( fieldApiName !== 'Id' && fieldApiName !== 'attributes' && fieldApiName !== '__proto__' ) {
                    collectionsApiRecord[fieldApiName] = fieldValue;
                }
            };
            Object.keys(record).forEach(fieldApiName => defineField(fieldApiName, record[fieldApiName]));
            const newValues = newValuesByRecordId.get(recordId);
            if ( newValues ) {
                Object.keys(newValues).forEach(fieldApiName => defineField(fieldApiName, newValues[fieldApiName]));
            }

            collectionsApiRecords.push(collectionsApiRecord);

        });

        return collectionsApiRecords;

    }

    /*
        Writes FakeDataSets/<tree folder>-adapted-<ts>[-<n>] -- mkdirSync is the existence check, as
        for every data set -- with the records as Collections API files and BaseArtifactFiles holding
        a copy of the recipe, the adapted recipe and datasetSource.json, which is written LAST so a
        failed write leaves no file claiming a complete data set, and a folder whose files could not
        all be written is removed, since its name alone lists it as a data set. Then
        <recipe>-adapted-<ts>.yml beside the recipe, "wx". Every folder is held to the workspace
        before and after it is made, no folder on the way may be a link, and a file is never written
        over one. The files are compact JSON, as the update's snapshot is, and the host is yielded to
        between objects: at the Adapter's cap of 1,000,000 values one object can take a second.
    */
    static async writeAdaptedRun(request: IAdaptedRunRequest): Promise<RecipeCockpitAdaptedRunWrite> {

        const refuse = (refusal: string): RecipeCockpitAdaptedRunWrite => ({ isWritten: false, refusal: refusal });
        const resolvedWorkspaceRoot = path.resolve(request.workspaceRoot);
        const fakeDataSetsFolderPath = path.resolve(request.fakeDataSetsFolderPath);
        const recipeFilePath = path.resolve(request.recipeFilePath);

        if ( request.objects.some(adaptedObject => !SalesforceApiName.isApiName(adaptedObject.objectApiName)) ) {
            return refuse('an object name is not a Salesforce api name.');
        }

        let recipeSourceNames: ReturnType<typeof DatasetSourceService.resolveRecipeSourceNames>;
        try {
            recipeSourceNames = DatasetSourceService.resolveRecipeSourceNames(request.generatedRecipesFolderPath, recipeFilePath);
        } catch {
            return refuse('the card\'s recipe is not in a GeneratedRecipes run folder.');
        }

        const datasetFolderBaseName = DatasetSourceService.buildAdaptedDatasetFolderName(request.treeFolderName, request.date);
        if ( !datasetFolderBaseName ) {
            return refuse('the tree folder name is not a plain folder name.');
        }

        let recipeText: string;
        try {
            if ( fs.lstatSync(recipeFilePath).isSymbolicLink() || !this.isWritableFolder(path.dirname(recipeFilePath), resolvedWorkspaceRoot, false) ) {
                return refuse('the card\'s recipe is outside the workspace or reached through a link.');
            }
            recipeText = fs.readFileSync(recipeFilePath, 'utf8');
        } catch {
            return refuse('the card\'s recipe could not be read.');
        }

        // NOTHING IS MADE UNTIL THE RECIPE HAS BEEN READ
        if ( !this.isWritableFolder(fakeDataSetsFolderPath, resolvedWorkspaceRoot, true) ) {
            return refuse('the FakeDataSets folder is outside the workspace or reached through a link.');
        }

        const datasetFolderPath = this.makeFreeFolder(fakeDataSetsFolderPath, datasetFolderBaseName);
        if ( !datasetFolderPath || !this.isWritableFolder(datasetFolderPath, resolvedWorkspaceRoot, false) ) {
            return refuse('the data set folder could not be made inside the workspace.');
        }

        const adaptedTimestamp = path.basename(datasetFolderPath).slice(request.treeFolderName.length + DATASET_ADAPTED_NAME_MARKER.length);
        const recordCountsByObject: Record<string, number> = Object.create(null);
        let adaptedRecipeFilePath: string | undefined;
        let adaptedRecipeText: string | undefined;
        let recipeRefusal: string | undefined;

        try {

            const collectionsApiFolderPath = path.join(datasetFolderPath, DATASET_COLLECTIONS_API_FOLDER_NAME);
            const baseArtifactsFolderPath = path.join(datasetFolderPath, BASE_ARTIFACT_FILES_FOLDER_NAME);
            fs.mkdirSync(collectionsApiFolderPath);
            fs.mkdirSync(baseArtifactsFolderPath);

            for ( const adaptedObject of request.objects ) {
                const collectionsApiRecords = this.buildCollectionsApiRecords(adaptedObject.objectApiName, adaptedObject.records, adaptedObject.newValuesByRecordId);
                recordCountsByObject[adaptedObject.objectApiName] = collectionsApiRecords.length;
                this.writeNewFile(path.join(collectionsApiFolderPath, `collectionsApi-${adaptedObject.objectApiName}.json`),
                                  JSON.stringify({ allOrNone: true, records: collectionsApiRecords }));
                await new Promise(resolve => setImmediate(resolve));
            }

            this.writeNewFile(path.join(baseArtifactsFolderPath, `originalRecipe-${path.basename(recipeFilePath)}`), recipeText);

            const adaptedComment = RecipeCockpitRecipeWriter.buildAdaptedComment(request.date.toISOString().slice(0, 10), request.orgLabel);
            const adaptedRecipe = RecipeCockpitRecipeWriter.buildAdaptedRecipe(recipeText, request.adaptedFields, adaptedComment);

            if ( 'refusal' in adaptedRecipe ) {
                recipeRefusal = adaptedRecipe.refusal.message;
            } else {
                const recipeExtension = path.extname(recipeFilePath);
                const adaptedRecipeFileName = `${path.basename(recipeFilePath, recipeExtension)}${DATASET_ADAPTED_NAME_MARKER}${adaptedTimestamp}${recipeExtension}`;
                adaptedRecipeFilePath = this.isAdaptedRecipeFileName(adaptedRecipeFileName) ? path.join(path.dirname(recipeFilePath), adaptedRecipeFileName) : undefined;
                if ( adaptedRecipeFilePath ) {
                    adaptedRecipeText = adaptedRecipe.recipeText;
                    this.writeNewFile(path.join(baseArtifactsFolderPath, adaptedRecipeFileName), adaptedRecipeText);
                } else {
                    recipeRefusal = 'the adapted recipe\'s file name could not be built from the recipe\'s.';
                }
            }

            const datasetSource = DatasetSourceService.buildAdaptDatasetSource(recipeSourceNames, request.fakerService, request.date.toISOString(), recordCountsByObject, {
                ...request.adaptation,
                adaptedRecipeFileName: adaptedRecipeFilePath ? path.basename(adaptedRecipeFilePath) : null
            });
            this.writeNewFile(path.join(baseArtifactsFolderPath, 'datasetSource.json'), `${JSON.stringify(datasetSource, null, 2)}\n`);

        } catch {
            this.removeFolderThisRunMade(datasetFolderPath, resolvedWorkspaceRoot);
            return refuse(`the files of ${path.basename(datasetFolderPath)} could not all be written.`);
        }

        // BESIDE THE RECIPE, WHICH IS NEVER WRITTEN; A FILE ALREADY THERE, OR A LINK, IS NEVER WRITTEN OVER
        if ( adaptedRecipeFilePath && adaptedRecipeText !== undefined ) {
            try {
                this.writeNewFile(adaptedRecipeFilePath, adaptedRecipeText);
            } catch {
                recipeRefusal = `${path.basename(adaptedRecipeFilePath)} could not be written beside the recipe; a copy is in the data set.`;
                adaptedRecipeFilePath = undefined;
            }
        }

        return {
            isWritten: true,
            datasetFolderPath: datasetFolderPath,
            ...( adaptedRecipeFilePath ? { adaptedRecipeFilePath: adaptedRecipeFilePath } : {} ),
            ...( recipeRefusal ? { recipeRefusal: recipeRefusal } : {} )
        };

    }

    // ONLY A FOLDER STILL INSIDE THE WORKSPACE WITH NO LINK ON THE WAY; ONE THAT CANNOT BE REMOVED IS LEFT, AS THE WRITE ALREADY FAILED
    private static removeFolderThisRunMade(datasetFolderPath: string, resolvedWorkspaceRoot: string) {
        if ( this.isWritableFolder(datasetFolderPath, resolvedWorkspaceRoot, false) ) {
            try {
                fs.rmSync(datasetFolderPath, { recursive: true, force: true });
            } catch {
                // NOTHING MORE TO DO
            }
        }
    }

    // "wx": A FILE OR A LINK ALREADY AT THE PATH THROWS RATHER THAN BEING WRITTEN THROUGH
    private static writeNewFile(filePath: string, fileText: string) {
        fs.writeFileSync(filePath, fileText, { encoding: 'utf-8', flag: 'wx' });
    }

    // THE FIRST FREE OF "<name>", "<name>-2", "<name>-3" ... -- THE ONE THIS CALL MADE
    private static makeFreeFolder(parentFolderPath: string, folderBaseName: string): string | undefined {

        for ( let collisionSuffix = 1; collisionSuffix <= ADAPTED_NAME_ATTEMPTS; collisionSuffix++ ) {
            const candidateFolderPath = path.join(parentFolderPath, collisionSuffix === 1 ? folderBaseName : `${folderBaseName}-${collisionSuffix}`);
            try {
                fs.mkdirSync(candidateFolderPath);
                return candidateFolderPath;
            } catch (mkdirError) {
                if ( ( mkdirError as NodeJS.ErrnoException )?.code !== 'EEXIST' ) {
                    return undefined;
                }
            }
        }

        return undefined;

    }

    /*
        Inside the workspace, lexically and by its real path, with no folder from the workspace down
        to it a link. With isMadeWhenMissing the missing folders are made, and checked again after,
        since one of them could have been made a link in between.
    */
    private static isWritableFolder(folderPath: string, resolvedWorkspaceRoot: string, isMadeWhenMissing: boolean): boolean {

        const isContainedWithoutLink = () => SfdxProjectService.isPathContainedInWorkspace(folderPath, resolvedWorkspaceRoot)
                                                && !this.hasLinkBelowWorkspace(folderPath, resolvedWorkspaceRoot);

        if ( !isContainedWithoutLink() ) {
            return false;
        }

        if ( isMadeWhenMissing ) {
            try {
                fs.mkdirSync(folderPath, { recursive: true });
            } catch {
                return false;
            }
        }

        return SfdxProjectService.isExistingDirectory(folderPath) && isContainedWithoutLink();

    }

    private static hasLinkBelowWorkspace(folderPath: string, resolvedWorkspaceRoot: string): boolean {

        const relativeSegments = path.relative(resolvedWorkspaceRoot, folderPath).split(path.sep).filter(segment => segment.length > 0);
        let currentPath = resolvedWorkspaceRoot;

        return relativeSegments.some(segment => {
            currentPath = path.join(currentPath, segment);
            try {
                return fs.lstatSync(currentPath).isSymbolicLink();
            } catch {
                return false;
            }
        });

    }

}
