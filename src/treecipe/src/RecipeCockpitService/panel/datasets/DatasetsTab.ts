import { createButton, createElement } from '../../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_FAVORITES_ONLY_LABEL, RECIPE_COCKPIT_FAVORITE_TREE_LABEL, RECIPE_COCKPIT_NOT_FAVORITE_TREE_LABEL } from '../../RecipeCockpitDatasetsTabConstants';
import { ITabSearchView, buildTabSearch } from '../RecipeCockpitPanelBuilders';
import { setDatasetJourneyExpanded } from './DatasetJourney';
import { buildDatasetRowState, drawDatasetLastInsert, drawDatasetName } from './DatasetRow';
import { IDataset, IDatasetLastInsert, IDatasetRowState, IDatasetsTreeState } from './DatasetTypes';

/*
    The Previously Used Data Sets tab (#226, #312, #642): a card's data sets, its search and
    Favorites only, and the host's updates to a row drawn in place. These names are the panel
    script's own, read when a function runs.
*/
declare const vscodeApi: { postMessage(message: unknown): void };
declare const renderedSequence: number | null;
declare const treeStates: IDatasetsTreeState[];
declare function pluralize(count: number, singular: string, plural: string): string;
declare function savePanelPlace(): void;

// WHAT THE HOST POSTS (datasetAdded, datasetPreferences, datasetLastInsert), READ AS UNTRUSTED
interface IDatasetAddedMessage {
    renderSequence: unknown;
    updateSequence?: unknown;
    treeKeys?: unknown;
    dataset: IDataset;
}

interface IDatasetPreferencesMessage {
    renderSequence: unknown;
    datasetFolderName: unknown;
    customName?: unknown;
    isFavorite?: unknown;
}

interface IDatasetLastInsertMessage {
    renderSequence: unknown;
    updateSequence?: unknown;
    datasetFolderName: unknown;
    lastInsert?: IDatasetLastInsert;
}

// THE DATA SETS TAB'S OWN FAVORITES ONLY: PANEL-ONLY, KEPT IN THE READER'S PLACE PER CARD
function buildDatasetFavoritesToggle(treeState: IDatasetsTreeState): HTMLButtonElement {

    const toggleElement = createButton('secondary', 'historyAction treeDatasetFavoritesToggle');
    toggleElement.setAttribute('title', 'Show only the data sets marked as favorites');
    toggleElement.addEventListener('click', function () {
        treeState.isDatasetFavoritesOnly = !treeState.isDatasetFavoritesOnly;
        applyDatasetsFilter(treeState);
        savePanelPlace();
    });

    return toggleElement;

}

export function buildDatasetsTab(treeState: IDatasetsTreeState, panelElement: HTMLElement): void {

    const datasets = (treeState.tree.history as { datasets: IDataset[] }).datasets;

    if (datasets.length === 0) {
        panelElement.appendChild(createElement('div', 'treeEmpty muted', 'No data sets were made from this tree.'));
        return;
    }

    const datasetsSearch = buildTabSearch(treeState, 'datasets', 'Search data sets', applyDatasetsFilter);
    treeState.datasetsSearch = datasetsSearch;
    const datasetFavoritesToggleElement = buildDatasetFavoritesToggle(treeState);
    treeState.datasetFavoritesToggleElement = datasetFavoritesToggleElement;
    datasetsSearch.element.appendChild(datasetFavoritesToggleElement);
    panelElement.appendChild(datasetsSearch.element);

    treeState.datasetRowStates = datasets.map(function (dataset) {
        const rowState = buildDatasetRowState(treeState, dataset);
        panelElement.appendChild(rowState.element);
        return rowState;
    });

    applyDatasetsFilter(treeState);

}

/*
    The data sets tab lists rows, not objects, so a search hides the rows it does not match --
    and says how many it left, so an empty tab never reads as a tree with no history.
*/
function applyRowSearch(rowStates: IDatasetRowState[], searchQuery: string, search: ITabSearchView, singular: string, plural: string, isFavoritesOnly: boolean | undefined): void {

    let matchingRowCount = 0;
    const isFiltered = !!searchQuery || !!isFavoritesOnly;

    rowStates.forEach(function (rowState) {
        const isMatch = (!searchQuery || rowState.searchText.indexOf(searchQuery) !== -1)
            && (!isFavoritesOnly || rowState.dataset.isFavorite === true);
        if (isMatch) { matchingRowCount++; rowState.element.classList.remove('hidden'); } else { rowState.element.classList.add('hidden'); }
    });

    search.matchCountElement.textContent = !isFiltered
        ? pluralize(rowStates.length, singular, plural)
        : matchingRowCount > 0 ? matchingRowCount + ' of ' + pluralize(rowStates.length, singular, plural) : 'no matches';

}

/*
    One data set an action just wrote (#226), added to the card IN PLACE rather than by redrawing
    the panel: to the model the card draws from, so a tab built later lists it, and to its data
    sets tab when that is already built, at the top, as a reload orders it. Only this card's
    data set rows are touched; every other node on the page is the one that was there before.
*/
function addDatasetToTree(treeState: IDatasetsTreeState, dataset: IDataset): void {

    const treeHistory = treeState.tree.history;

    if (!treeHistory || treeHistory.datasets.some(function (listedDataset) { return listedDataset.datasetFolderName === dataset.datasetFolderName; })) { return; }

    treeHistory.datasets.unshift(dataset);

    const datasetsTabState = (treeState.tabStates || []).find(function (tabState) { return tabState.tabName === 'datasets'; });

    if (datasetsTabState && datasetsTabState.isBuilt) {
        if (treeState.datasetRowStates && treeState.datasetRowStates.length > 0) {
            const datasetRowState = buildDatasetRowState(treeState, dataset);
            datasetsTabState.panelElement.insertBefore(datasetRowState.element, treeState.datasetRowStates[0].element);
            treeState.datasetRowStates.unshift(datasetRowState);
            applyDatasetsFilter(treeState);
        } else {
            // A TAB BUILT EMPTY HAS NO SEARCH BOX YET: BUILT AGAIN, IT GETS ONE
            datasetsTabState.panelElement.textContent = '';
            buildDatasetsTab(treeState, datasetsTabState.panelElement);
        }
    }

}

/*
    datasetAdded (#226): drawn only over the model it was added to, then acknowledged with its
    own updateSequence -- the host offers the new row's Open and Insert… only after that.
*/
export function renderDatasetAdded(datasetAddedMessage: IDatasetAddedMessage): void {

    if (renderedSequence === null || datasetAddedMessage.renderSequence !== renderedSequence || !Array.isArray(datasetAddedMessage.treeKeys)) { return; }

    datasetAddedMessage.treeKeys.forEach(function (treeKey: unknown) {
        treeStates
            .filter(function (treeState) { return treeState.tree.treeKey === treeKey; })
            .forEach(function (treeState) { addDatasetToTree(treeState, datasetAddedMessage.dataset); });
    });

    vscodeApi.postMessage({ command: 'partialRendered', renderSequence: renderedSequence, updateSequence: datasetAddedMessage.updateSequence });

}

export function applyDatasetsFilter(treeState: IDatasetsTreeState): void {

    applyRowSearch(treeState.datasetRowStates as IDatasetRowState[], treeState.searchQueries.datasets, treeState.datasetsSearch as ITabSearchView, 'data set', 'data sets', treeState.isDatasetFavoritesOnly);

    if (treeState.datasetFavoritesToggleElement) {
        treeState.datasetFavoritesToggleElement.textContent = (treeState.isDatasetFavoritesOnly ? RECIPE_COCKPIT_FAVORITE_TREE_LABEL : RECIPE_COCKPIT_NOT_FAVORITE_TREE_LABEL) + ' ' + RECIPE_COCKPIT_FAVORITES_ONLY_LABEL;
        treeState.datasetFavoritesToggleElement.setAttribute('aria-pressed', treeState.isDatasetFavoritesOnly ? 'true' : 'false');
    }

}

/*
    A data set's name or star changed: every card that lists it -- the model each draws
    from, so a tab built later draws it too, and the row itself where that tab is built. Only
    for the model on screen: a newer one was built from the preferences this update reports.
*/
export function renderDatasetPreferences(datasetPreferencesMessage: IDatasetPreferencesMessage): void {

    if (renderedSequence === null || datasetPreferencesMessage.renderSequence !== renderedSequence
            || typeof datasetPreferencesMessage.datasetFolderName !== 'string') { return; }

    const datasetFolderName = datasetPreferencesMessage.datasetFolderName;
    const customName = typeof datasetPreferencesMessage.customName === 'string' ? datasetPreferencesMessage.customName : undefined;
    const isFavorite = datasetPreferencesMessage.isFavorite === true;

    treeStates.forEach(function (treeState) {

        const treeHistory = treeState.tree.history;
        if (!treeHistory) { return; }

        treeHistory.datasets
            .filter(function (dataset) { return dataset.datasetFolderName === datasetFolderName; })
            .forEach(function (dataset) { dataset.customName = customName; dataset.isFavorite = isFavorite; });

        const changedRowStates = (treeState.datasetRowStates || []).filter(function (rowState) { return rowState.dataset.datasetFolderName === datasetFolderName; });

        if (changedRowStates.length === 0) { return; }

        changedRowStates.forEach(function (rowState) {
            rowState.dataset.customName = customName;
            rowState.dataset.isFavorite = isFavorite;
            drawDatasetName(rowState);
        });
        applyDatasetsFilter(treeState);

    });

}

/*
    A data set's newest insert after its row's Insert… ran (#469): every card's copy of the data set,
    and every drawn row of it, redrawn in place, then acknowledged with its updateSequence -- the
    host offers the new View results only after that.
*/
export function renderDatasetLastInsert(lastInsertMessage: IDatasetLastInsertMessage): void {

    if (renderedSequence === null || lastInsertMessage.renderSequence !== renderedSequence
            || typeof lastInsertMessage.datasetFolderName !== 'string') { return; }

    const datasetFolderName = lastInsertMessage.datasetFolderName;
    const lastInsert = lastInsertMessage.lastInsert;
    const applyLastInsert = function (dataset: IDataset) {
        if (lastInsert) { dataset.lastInsert = lastInsert; } else { delete dataset.lastInsert; }
    };

    treeStates.forEach(function (treeState) {

        const treeHistory = treeState.tree.history;
        if (!treeHistory) { return; }

        treeHistory.datasets
            .filter(function (dataset) { return dataset.datasetFolderName === datasetFolderName; })
            .forEach(applyLastInsert);

        const changedRowStates = (treeState.datasetRowStates || []).filter(function (rowState) { return rowState.dataset.datasetFolderName === datasetFolderName; });

        if (changedRowStates.length === 0) { return; }

        changedRowStates.forEach(function (rowState) {
            applyLastInsert(rowState.dataset);
            drawDatasetLastInsert(rowState);
            drawDatasetName(rowState);
            // A NEW INSERT ADDS TO THE JOURNEY (#471): AN OPEN ONE IS READ AGAIN, A CLOSED ONE WHEN IT NEXT OPENS
            rowState.isJourneyRequested = false;
            rowState.journeyMessage = null;
            if (rowState.isJourneyExpanded) { setDatasetJourneyExpanded(treeState, rowState, true, false); }
        });
        applyDatasetsFilter(treeState);

    });

    vscodeApi.postMessage({ command: 'partialRendered', renderSequence: renderedSequence, updateSequence: lastInsertMessage.updateSequence });

}
