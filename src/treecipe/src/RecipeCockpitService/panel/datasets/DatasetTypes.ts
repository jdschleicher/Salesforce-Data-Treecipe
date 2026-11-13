import type { ITabSearchView } from '../RecipeCockpitPanelBuilders';

/*
    The shapes the Previously Used Data Sets modules work on (#642). A tree card's state is built by
    the panel script, which is not type checked yet, so IDatasetsTreeState names only what these
    modules read and write on it. A data set comes from the posted model (IRecipeCockpitDatasetViewModel).
*/

export interface IDatasetRecordCount {
    objectApiName: string;
    recordCount: number;
}

export interface IDatasetRecordTypes {
    objectApiName: string;
    developerNames: string[];
}

export interface IDatasetLastInsert {
    status: string;
    attemptedAtLabel: string;
    orgLabel?: string;
    isInterrupted?: boolean;
    isOutcomeUnrecorded?: boolean;
    savedRecordCount?: number;
    failedRecordCount?: number;
    hasResultsFile?: boolean;
}

export interface IDataset {
    datasetFolderName: string;
    customName?: string;
    isFavorite?: boolean;
    generatedAtLabel: string;
    fakerService: string;
    runFolderName: string | null;
    isAdapted?: boolean;
    recordCounts?: IDatasetRecordCount[] | null;
    recordTypes?: IDatasetRecordTypes[];
    lastInsert?: IDatasetLastInsert;
}

// WHAT THE HOST POSTS (loadDatasetRecordCounts, loadDatasetJourney), READ AS IT IS SENT
export interface IDatasetRecordCountsMessage {
    renderSequence: unknown;
    datasetFolderName: string;
    recordCounts: IDatasetRecordCount[];
    failureMessage?: string;
}

export interface IDatasetJourneyFile {
    relativePath: unknown;
    fileIndex: unknown;
}

export interface IDatasetJourneyEntry {
    kind?: unknown;
    kindLabel: unknown;
    status: unknown;
    timeLabel: unknown;
    orgLabel?: unknown;
    summaryText?: unknown;
    errorExcerpt?: unknown;
    files?: unknown;
}

export interface IDatasetJourneyMessage {
    renderSequence: unknown;
    datasetFolderName: unknown;
    journeySequence?: unknown;
    entries?: unknown;
    hiddenEntryCount?: unknown;
    otherOrgStepCount?: unknown;
    untrackedStepCount?: unknown;
}

export type DatasetJourneySortColumn = 'time' | 'step' | 'org' | 'status';

export interface IDatasetJourneySort {
    column: DatasetJourneySortColumn;
    isDescending: boolean;
}

export interface INameEditor {
    isOpen?: boolean;
}

export interface IDatasetRowState {
    element: HTMLElement;
    dataset: IDataset;
    searchText: string;
    nameElement: HTMLElement;
    favoriteElement: HTMLButtonElement;
    renameElement: HTMLButtonElement;
    nameEditor?: INameEditor;
    lastInsertSlotElement: HTMLElement;
    lastInsertResultsSlotElement: HTMLElement;
    lastInsertSearchText?: string;
    insertElement: HTMLButtonElement;
    journeyToggleElement: HTMLElement;
    journeyElement: HTMLElement;
    isJourneyExpanded?: boolean;
    isJourneyRequested?: boolean;
    isJourneyWanted?: boolean;
    journeyMessage?: IDatasetJourneyMessage | null;
    journeySort?: IDatasetJourneySort;
    journeySortButtons?: Record<string, HTMLButtonElement>;
}

// THE PARTS OF A TREE CARD'S STATE THESE MODULES READ AND WRITE; THE SCRIPT BUILDS THE REST
export interface IDatasetsTreeState {
    tree: { treeKey: string; history?: { datasets: IDataset[] } };
    searchTexts: Record<string, string>;
    searchQueries: Record<string, string>;
    expandedJourneyDatasetFolderNames: Record<string, boolean>;
    tabStates?: Array<{ tabName: string; isBuilt?: boolean; panelElement: HTMLElement }>;
    datasetsSearch?: ITabSearchView;
    datasetFavoritesToggleElement?: HTMLElement;
    datasetRowStates?: IDatasetRowState[];
    isDatasetFavoritesOnly?: boolean;
}
