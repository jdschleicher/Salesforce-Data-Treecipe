import * as fs from 'fs';
import * as path from 'path';

import { DatasetSourceFakerService, DatasetSourceService, IDatasetListing, IKnownRecipeRun } from '../DatasetSourceService/DatasetSourceService';
import { SfdxProjectService } from '../SfdxProjectService/SfdxProjectService';

const RUN_FOLDER_TIMESTAMP_PATTERN = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/;

// "2026-09-20T10-00-00": EVERY RUN FOLDER findKnownRecipeRuns LISTS ENDS IN ONE
const RUN_FOLDER_TIMESTAMP_LENGTH = 19;

const FAKER_JS_RUN_FOLDER_PREFIX = 'recipe-fakerjs-';

const RECIPE_FILE_EXTENSIONS = ['.yml', '.yaml'];

export const RECIPE_COCKPIT_UNMATCHED_DATASETS_NOTICE_SUFFIX = 'couldn\'t be matched to a recipe tree';

/*
    One Generate Treecipe run that wrote this tree's folder, as a Previous Versions row. What the
    model knows without opening a wrapper -- when, which backend, whether it can be diffed -- is
    here; the field count comes later, read from the run's wrapper when the tab is first opened.
*/
export interface IRecipeCockpitTreeVersionViewModel {
    runFolderName: string;
    generatedAtLabel: string;
    fakerService: DatasetSourceFakerService;
    isCurrent: boolean;
    isBackendDifferent: boolean;
    isDiffable: boolean;
}

export interface IRecipeCockpitDatasetRecordCountViewModel {
    objectApiName: string;
    recordCount: number;
}

/*
    One data set made from this tree. runFolderName is null when only the TREE matched -- its run
    folder is gone, or its legacy copies disagree on which run -- and the panel tags it "version
    unknown". recordCounts is null when the data set predates datasetSource.json: its counts are
    read from its Collections API files when the reader expands it, not with the model.
*/
export interface IRecipeCockpitTreeDatasetViewModel {
    datasetFolderName: string;
    generatedAtLabel: string;
    fakerService: DatasetSourceFakerService;
    runFolderName: string | null;
    recordCounts: IRecipeCockpitDatasetRecordCountViewModel[] | null;
}

export interface IRecipeCockpitTreeHistoryViewModel {
    versions: IRecipeCockpitTreeVersionViewModel[];
    datasets: IRecipeCockpitTreeDatasetViewModel[];
}

export interface IRecipeCockpitTreeHistoryTree {
    treeKey: string;
    folderName: string;
}

// WHAT ONE TREE'S VERSIONS ARE SUMMARIZED FROM: EACH RUN'S WRAPPER, AND THE CURRENT RUN TO COMPARE THEM WITH
export interface IRecipeCockpitTreeSummarySource {
    treeFolderName: string;
    currentRunFolderName: string;
    runs: Array<{ runFolderName: string; objectsWrapperFilePath: string; treeFolderPath: string }>;
}

export interface IRecipeCockpitTreeDiffTarget {
    versionRecipeFilePath: string;
    currentRecipeFilePath: string;
    diffTitle: string;
}

/*
    Host-only: where each name the model posts resolves on disk. The panel is handed names, never
    paths, and every one of these paths passed workspace containment when it was put here -- and
    is checked again when it is used.
*/
/*
    runFakerRecipeFilePathsByTreeKey holds the recipe file Run Faker runs for a tree: the one .yml
    the run on screen wrote to the tree's folder. A .yaml is left out because Run Faker by Recipe
    refuses one handed to it by path.
*/
export interface IRecipeCockpitTreeHistoryTargets {
    summarySourcesByTreeKey: Map<string, IRecipeCockpitTreeSummarySource>;
    diffTargetsByKey: Map<string, IRecipeCockpitTreeDiffTarget>;
    datasetFolderPathsByName: Map<string, string>;
    runFakerRecipeFilePathsByTreeKey: Map<string, string>;
}

export interface IRecipeCockpitTreeHistoryBuild {
    historiesByTreeKey: Map<string, IRecipeCockpitTreeHistoryViewModel>;
    unmatchedDatasetCount: number;
    targets: IRecipeCockpitTreeHistoryTargets;
}

export interface IRecipeCockpitTreeVersionSummary {
    runFolderName: string;
    isSummaryAvailable: boolean;
    fieldCount: number;
    changeText: string;
}

export class RecipeCockpitTreeHistory {

    static buildEmptyTargets(): IRecipeCockpitTreeHistoryTargets {

        return { summarySourcesByTreeKey: new Map(), diffTargetsByKey: new Map(), datasetFolderPathsByName: new Map(), runFakerRecipeFilePathsByTreeKey: new Map() };

    }

    static buildDiffKey(treeKey: string, runFolderName: string): string {

        return `${treeKey}\n${runFolderName}`;

    }

    static readFakerServiceOfRun(runFolderName: string): DatasetSourceFakerService {

        return runFolderName.startsWith(FAKER_JS_RUN_FOLDER_PREFIX) ? 'faker-js' : 'snowfakery';

    }

    // "2026-09-20T10-00-00" AT THE END OF A RUN OR DATA SET FOLDER NAME, AS THE RUN SELECTOR WRITES IT
    static formatTimestampLabel(folderTimestamp: string): string {

        const timestampMatch = RUN_FOLDER_TIMESTAMP_PATTERN.exec(folderTimestamp);

        if ( !timestampMatch ) {
            return folderTimestamp;
        }

        const [, folderDate, folderHours, folderMinutes, folderSeconds] = timestampMatch;
        return `${folderDate} ${folderHours}:${folderMinutes}:${folderSeconds} UTC`;

    }

    /*
        Newest first by the timestamp SUFFIX: a name sort would rank every "recipe-fakerjs-" run
        above every "recipe-" one. Run folder names are unique, so a tie in time is broken by name
        with "<" -- a fixed order, never the machine's locale.
    */
    static compareRunFolderNamesNewestFirst(firstRunFolderName: string, secondRunFolderName: string): number {

        const firstTimestamp = firstRunFolderName.slice(-RUN_FOLDER_TIMESTAMP_LENGTH);
        const secondTimestamp = secondRunFolderName.slice(-RUN_FOLDER_TIMESTAMP_LENGTH);

        if ( firstTimestamp !== secondTimestamp ) {
            return firstTimestamp < secondTimestamp ? 1 : -1;
        }

        return firstRunFolderName < secondRunFolderName ? -1 : 1;

    }

    static compareDatasetsNewestFirst(firstListing: IDatasetListing, secondListing: IDatasetListing): number {

        const firstDetail = firstListing.folderNameDetail;
        const secondDetail = secondListing.folderNameDetail;

        if ( firstDetail.timestamp !== secondDetail.timestamp ) {
            return firstDetail.timestamp < secondDetail.timestamp ? 1 : -1;
        }

        // THE FIRST FOLDER OF A SECOND HAS NO SUFFIX, AND "-2" CAME AFTER IT
        const collisionDifference = Number(secondDetail.collisionSuffix) - Number(firstDetail.collisionSuffix);

        if ( collisionDifference !== 0 ) {
            return collisionDifference;
        }

        return firstListing.datasetFolderName < secondListing.datasetFolderName ? -1 : 1;

    }

    /*
        Which tree each data set belongs to, as a pure function of what is on disk.

        A data set is placed under a tree only by the tree's FOLDER NAME, which is the one identity a
        tree keeps across runs. Linked, it is tagged with its run; "unknown" with a tree folder still
        named, it is placed with its version unknown. Anything else -- no source, an unreadable one,
        a recipe outside any tree, or a tree that is not one of these cards -- is counted once as
        unmatched rather than guessed onto a card.
    */
    static groupTreeHistories(knownRecipeRuns: IKnownRecipeRun[],
                                datasetListings: IDatasetListing[],
                                trees: IRecipeCockpitTreeHistoryTree[],
                                currentRunFolderName: string): { historiesByTreeKey: Map<string, IRecipeCockpitTreeHistoryViewModel>; unmatchedDatasetCount: number } {

        const historiesByTreeKey = new Map<string, IRecipeCockpitTreeHistoryViewModel>();
        const treeKeysByFolderName = new Map<string, string[]>();
        const currentFakerService = this.readFakerServiceOfRun(currentRunFolderName);

        trees.forEach(tree => {

            const isTreeFolderInCurrentRun = knownRecipeRuns.some(knownRun => (
                knownRun.runFolderName === currentRunFolderName && knownRun.treeFolderNames.includes(tree.folderName)
            ));

            // A CARD WITH NO TREE FOLDER IN THE RUN ON SCREEN HAS NO VERSIONS TO LINE UP -- THE UNGROUPED CARD, OR A RECIPE FILE WITH NO FOLDER
            if ( !tree.folderName || !isTreeFolderInCurrentRun ) {
                return;
            }

            const versions = knownRecipeRuns
                .filter(knownRun => knownRun.treeFolderNames.includes(tree.folderName))
                .map(knownRun => knownRun.runFolderName)
                .sort((firstRunFolderName, secondRunFolderName) => this.compareRunFolderNamesNewestFirst(firstRunFolderName, secondRunFolderName))
                .map(runFolderName => {
                    const fakerService = this.readFakerServiceOfRun(runFolderName);
                    return {
                        runFolderName: runFolderName,
                        generatedAtLabel: this.formatTimestampLabel(runFolderName),
                        fakerService: fakerService,
                        isCurrent: runFolderName === currentRunFolderName,
                        isBackendDifferent: fakerService !== currentFakerService,
                        isDiffable: false
                    };
                });

            historiesByTreeKey.set(tree.treeKey, { versions: versions, datasets: [] });

            const treeKeys = treeKeysByFolderName.get(tree.folderName) ?? [];
            treeKeys.push(tree.treeKey);
            treeKeysByFolderName.set(tree.folderName, treeKeys);

        });

        let unmatchedDatasetCount = 0;

        [...datasetListings].sort((firstListing, secondListing) => this.compareDatasetsNewestFirst(firstListing, secondListing)).forEach(datasetListing => {

            const datasetSourceRead = datasetListing.source;
            const isLinkedToTree = datasetSourceRead.status === 'linked' && datasetSourceRead.recipeTreeFolderName !== null;
            const treeFolderName = isLinkedToTree
                ? datasetSourceRead.recipeTreeFolderName
                : datasetSourceRead.status === 'unknown' ? datasetSourceRead.treeFolderNameHint : undefined;
            const treeKeys = treeFolderName ? treeKeysByFolderName.get(treeFolderName) : undefined;

            if ( !treeKeys ) {
                unmatchedDatasetCount++;
                return;
            }

            const recordCountsByObject = datasetSourceRead.datasetSource?.recordCountsByObject;

            const datasetViewModel: IRecipeCockpitTreeDatasetViewModel = {
                datasetFolderName: datasetListing.datasetFolderName,
                generatedAtLabel: this.formatTimestampLabel(datasetListing.folderNameDetail.timestamp),
                fakerService: datasetListing.folderNameDetail.fakerService,
                runFolderName: isLinkedToTree ? datasetSourceRead.recipeRunFolderName : null,
                recordCounts: recordCountsByObject ? this.toRecordCountViewModels(recordCountsByObject) : null
            };

            treeKeys.forEach(treeKey => historiesByTreeKey.get(treeKey).datasets.push(datasetViewModel));

        });

        return { historiesByTreeKey, unmatchedDatasetCount };

    }

    static toRecordCountViewModels(recordCountsByObject: Record<string, number>): IRecipeCockpitDatasetRecordCountViewModel[] {

        return Object.keys(recordCountsByObject)
            .sort()
            .map(objectApiName => ({ objectApiName: objectApiName, recordCount: recordCountsByObject[objectApiName] }));

    }

    static buildUnmatchedDatasetsNotice(unmatchedDatasetCount: number): string {

        return `${unmatchedDatasetCount} ${unmatchedDatasetCount === 1 ? 'data set' : 'data sets'} ${RECIPE_COCKPIT_UNMATCHED_DATASETS_NOTICE_SUFFIX}.`;

    }

    /*
        The recipe file a run wrote for one tree: the single .yml in the tree's folder. A folder with
        none, or with more than one, has no file a diff could honestly call "this tree's recipe".
    */
    static findTreeRecipeFilePath(treeFolderPath: string): string | undefined {

        let treeFolderEntries: fs.Dirent[];

        try {
            treeFolderEntries = fs.readdirSync(treeFolderPath, { withFileTypes: true });
        } catch {
            return undefined;
        }

        const recipeFileNames = treeFolderEntries
            .filter(treeFolderEntry => treeFolderEntry.isFile() && RECIPE_FILE_EXTENSIONS.includes(path.extname(treeFolderEntry.name).toLowerCase()))
            .map(treeFolderEntry => treeFolderEntry.name);

        return recipeFileNames.length === 1 ? path.join(treeFolderPath, recipeFileNames[0]) : undefined;

    }

    /*
        Every tree's versions and data sets, read from disk, with the host-only targets each name in
        them resolves to. Costs directory listings and each data set's small datasetSource.json --
        no wrapper is opened here. A path that resolves outside the workspace is left out of the
        targets, which leaves its version not diffable and its data set out of the history.
    */
    static buildTreeHistories(generatedRecipesFolderPath: string,
                                fakeDataSetsFolderPath: string,
                                workspaceRoot: string,
                                currentRunFolderName: string,
                                trees: IRecipeCockpitTreeHistoryTree[],
                                objectsWrapperFilePathsByRunFolderName: Map<string, string>): IRecipeCockpitTreeHistoryBuild {

        const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
        const isContained = (candidatePath: string) => SfdxProjectService.isPathContainedInWorkspace(path.resolve(candidatePath), resolvedWorkspaceRoot);

        const knownRecipeRuns = DatasetSourceService.findKnownRecipeRuns(generatedRecipesFolderPath);
        const datasetListings = DatasetSourceService.findDatasets(fakeDataSetsFolderPath, knownRecipeRuns)
            .filter(datasetListing => isContained(datasetListing.datasetFolderPath));

        const groupedHistories = this.groupTreeHistories(knownRecipeRuns, datasetListings, trees, currentRunFolderName);
        const targets = this.buildEmptyTargets();

        datasetListings.forEach(datasetListing => targets.datasetFolderPathsByName.set(datasetListing.datasetFolderName, datasetListing.datasetFolderPath));

        trees.forEach(tree => {

            const treeHistory = groupedHistories.historiesByTreeKey.get(tree.treeKey);

            if ( !treeHistory ) {
                return;
            }

            const treeFolderPathOf = (runFolderName: string) => path.join(generatedRecipesFolderPath, runFolderName, tree.folderName);
            const currentRecipeFilePath = this.findTreeRecipeFilePath(treeFolderPathOf(currentRunFolderName));
            const summarySource: IRecipeCockpitTreeSummarySource = { treeFolderName: tree.folderName, currentRunFolderName: currentRunFolderName, runs: [] };

            if ( currentRecipeFilePath && path.extname(currentRecipeFilePath) === '.yml' && isContained(currentRecipeFilePath) ) {
                targets.runFakerRecipeFilePathsByTreeKey.set(tree.treeKey, currentRecipeFilePath);
            }

            treeHistory.versions.forEach(version => {

                summarySource.runs.push({
                    runFolderName: version.runFolderName,
                    objectsWrapperFilePath: objectsWrapperFilePathsByRunFolderName.get(version.runFolderName) ?? '',
                    treeFolderPath: treeFolderPathOf(version.runFolderName)
                });

                if ( version.isCurrent || !currentRecipeFilePath || !isContained(currentRecipeFilePath) ) {
                    return;
                }

                const versionRecipeFilePath = this.findTreeRecipeFilePath(treeFolderPathOf(version.runFolderName));

                if ( !versionRecipeFilePath || !isContained(versionRecipeFilePath) ) {
                    return;
                }

                version.isDiffable = true;
                targets.diffTargetsByKey.set(this.buildDiffKey(tree.treeKey, version.runFolderName), {
                    versionRecipeFilePath: versionRecipeFilePath,
                    currentRecipeFilePath: currentRecipeFilePath,
                    diffTitle: `${tree.folderName}: ${version.generatedAtLabel} ↔ current (${this.formatTimestampLabel(currentRunFolderName)})`
                });

            });

            targets.summarySourcesByTreeKey.set(tree.treeKey, summarySource);

        });

        return {
            historiesByTreeKey: groupedHistories.historiesByTreeKey,
            unmatchedDatasetCount: groupedHistories.unmatchedDatasetCount,
            targets: targets
        };

    }

    // A VERSION AGAINST THE CURRENT ONE: "+2 fields" MEANS THAT VERSION HAD TWO MORE
    static formatFieldCountChange(versionFieldCount: number, currentFieldCount: number): string {

        const fieldCountChange = versionFieldCount - currentFieldCount;

        if ( fieldCountChange === 0 ) {
            return 'same field count';
        }

        const fieldWord = Math.abs(fieldCountChange) === 1 ? 'field' : 'fields';
        return fieldCountChange > 0 ? `+${fieldCountChange} ${fieldWord}` : `−${Math.abs(fieldCountChange)} ${fieldWord}`;

    }

    /*
        Each version's summary, given each run's field count for this tree (undefined: the run's
        wrapper could not be read, or does not list the tree). Pure, so the change against the
        current version is asserted without a wrapper on disk. With no current count there is
        nothing to compare against, and no change is claimed.
    */
    static buildVersionSummaries(summarySource: IRecipeCockpitTreeSummarySource,
                                    fieldCountsByRunFolderName: Map<string, number | undefined>): IRecipeCockpitTreeVersionSummary[] {

        const currentFieldCount = fieldCountsByRunFolderName.get(summarySource.currentRunFolderName);

        return summarySource.runs.map(summaryRun => {

            const fieldCount = fieldCountsByRunFolderName.get(summaryRun.runFolderName);
            const isSummaryAvailable = typeof fieldCount === 'number';
            const isComparable = isSummaryAvailable && typeof currentFieldCount === 'number' && summaryRun.runFolderName !== summarySource.currentRunFolderName;

            return {
                runFolderName: summaryRun.runFolderName,
                isSummaryAvailable: isSummaryAvailable,
                fieldCount: isSummaryAvailable ? fieldCount : 0,
                changeText: isComparable ? this.formatFieldCountChange(fieldCount, currentFieldCount) : ''
            };

        });

    }

}
