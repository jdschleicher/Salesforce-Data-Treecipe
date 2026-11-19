import { createButton, createElement, setShownWithMotion } from '../../../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_QUERY_TAB_LABEL, RECIPE_COCKPIT_TREECIPE_FILTER_TILE_LABEL, RECIPE_COCKPIT_UPDATER_TAB_LABEL } from '../../../RecipeCockpitShellConstants';
import { RECIPE_COCKPIT_TROUBLESHOOTING_TAB_LABEL } from '../../../RecipeCockpitTroubleshootingConstants';
import { buildUpdaterTab } from '../../adapter/AdapterTab';
import { requestUpdaterSnapshots } from '../../adapter/AdapterLoadAndUpdate';
import { buildDatasetsTab } from '../../datasets/DatasetsTab';
import { buildQueryTab, requestTreeQueries } from '../../query/QueryTab';
import { buildTabSearch } from '../../RecipeCockpitPanelBuilders';
import { isRestoringPlace, savePanelPlace } from '../../shell/PanelPlace';
import { renderedSequence } from '../../shell/PanelRender';
import { buildTroubleshootingTab, requestTroubleshootingSummary } from '../../troubleshooting/TroubleshootingTab';
import { requestDataOrgs } from '../dataOrg/DataOrgListing';
import { drawFriendChips } from '../navigation/Friends';
import { drawObjectNickname } from '../navigation/Nicknames';
import { applyStructureFilter } from '../navigation/StructureFilter';
import { appendRecordTypeFieldsToggle } from '../recordTypes/RecordTypeFieldsToggle';
import { appendUnavailableRecordTypesButton, buildRecordTypesSection, listRecordTypeObjects } from '../recordTypes/RecordTypesSection';
import { appendTodosToggle } from '../recordTypes/TodosToggles';
import { buildTreecipeHeader } from './TreeCard';
import { asCardTreeState } from './CardTypes';
import type { CardTreeState } from './CardTypes';
import type { ITreeStateView } from '../navigation/NavigationTypes';

/*
    The tab strip and the Treecipe tab -- its header and its objects -- made on the card's first
    expand. Opening the Treecipe tab is when its org picker asks for its orgs. Previously Used
    Data Sets builds its rows on its own first open, and is drawn only for a card whose model
    carries a history.
*/
export function ensureTreeBodyBuilt(treeStateView: ITreeStateView): void {

    const treeState = asCardTreeState(treeStateView);

    if (treeState.isBodyBuilt) { return; }

    const tabsElement = createElement('div', 'treeTabs');
    const structureElement = createElement('div', 'treeStructure');

    tabsElement.setAttribute('role', 'tablist');

    structureElement.appendChild(buildTreecipeHeader(treeState));

    const structureSearch = buildTabSearch(treeState, 'treecipe', 'Search objects, fields and faker expressions', applyStructureFilter);
    treeState.structureSearch = structureSearch;
    structureElement.appendChild(structureSearch.element);

    // THE SEARCH HAS ITS OWN ROW; THE TWO CHECKS AND "Manage record types" SHARE ONE TILE UNDER IT, AND THE SECTION OPENS UNDER THE TILE (#490)
    const filterTileElement = createElement('div', 'treecipeFilterTile');
    filterTileElement.setAttribute('role', 'group');
    filterTileElement.setAttribute('aria-label', RECIPE_COCKPIT_TREECIPE_FILTER_TILE_LABEL);
    appendRecordTypeFieldsToggle(treeState, filterTileElement);
    appendTodosToggle(treeState, filterTileElement);
    structureElement.appendChild(filterTileElement);

    if (listRecordTypeObjects(treeState).length > 0) {
        structureElement.appendChild(buildRecordTypesSection(treeState, filterTileElement));
    } else {
        appendUnavailableRecordTypesButton(treeState, filterTileElement);
    }

    treeState.objectStates.forEach(function (treeObjectState) {
        drawObjectNickname(treeObjectState);
        drawFriendChips(treeObjectState);
        structureElement.appendChild(treeObjectState.element);
    });

    if (treeState.objectStates.length === 0) {
        structureElement.appendChild(createElement('div', 'treeEmpty muted', 'This tree has no objects with a recipe.'));
    }

    treeState.tabStates = [];
    treeState.selectedTab = 'treecipe';
    addTreeTab(treeState, tabsElement, 'treecipe', 'Treecipe', structureElement);

    if (treeState.tree.history) {
        addTreeTab(treeState, tabsElement, 'datasets', 'Previously Used Data Sets', createElement('div', 'treeDatasets hidden'));
    }

    if (treeState.tree.folderName) {
        addTreeTab(treeState, tabsElement, 'troubleshooting', RECIPE_COCKPIT_TROUBLESHOOTING_TAB_LABEL, createElement('div', 'treeTroubleshooting hidden'));
        addTreeTab(treeState, tabsElement, 'query', RECIPE_COCKPIT_QUERY_TAB_LABEL, createElement('div', 'treeQueries hidden'));
        addTreeTab(treeState, tabsElement, 'updater', RECIPE_COCKPIT_UPDATER_TAB_LABEL, createElement('div', 'treeUpdater hidden'));
    }

    treeState.tabsElement = tabsElement;

    treeState.bodyElement.appendChild(tabsElement);
    treeState.tabStates.forEach(function (tabState) { treeState.bodyElement.appendChild(tabState.panelElement); });
    treeState.isBodyBuilt = true;
    applyStructureFilter(treeState);

}

function addTreeTab(treeState: CardTreeState, tabsElement: HTMLElement, tabName: string, tabLabel: string, panelElement: HTMLElement): void {

    const isSelected = tabName === treeState.selectedTab;
    const tabElement = createButton('secondary', isSelected ? 'treeTab selected' : 'treeTab', tabLabel);
    tabElement.setAttribute('data-label', tabLabel);

    tabElement.setAttribute('role', 'tab');
    tabElement.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    panelElement.classList.add('treeTabPanel');
    panelElement.setAttribute('role', 'tabpanel');
    panelElement.setAttribute('aria-label', tabLabel);
    tabElement.addEventListener('click', function () { selectTreeTab(treeState, tabName, true); });

    treeState.tabStates.push({ tabName: tabName, tabElement: tabElement, panelElement: panelElement, isBuilt: tabName === 'treecipe' });
    tabsElement.appendChild(tabElement);

}

export function selectTreeTab(treeStateView: ITreeStateView, tabName: string, isAnimated?: boolean): void {

    const treeState = asCardTreeState(treeStateView);

    ensureTreeBodyBuilt(treeState);

    if (!treeState.tabStates.some(function (tabState) { return tabState.tabName === tabName; })) { return; }

    drawTabMotion(treeState, tabName, !!isAnimated);
    treeState.selectedTab = tabName;

    treeState.tabStates.forEach(function (tabState) {

        const isSelected = tabState.tabName === tabName;

        if (isSelected) {
            tabState.tabElement.classList.add('selected');
        } else {
            tabState.tabElement.classList.remove('selected');
        }
        // ONLY THE INCOMING PANEL FADES; THE OUTGOING ONE IS GONE AT ONCE
        setShownWithMotion(tabState.panelElement, isSelected, isSelected && !!isAnimated);

        tabState.tabElement.setAttribute('aria-selected', isSelected ? 'true' : 'false');

        if (isSelected && !tabState.isBuilt) {
            tabState.isBuilt = true;
            if (tabState.tabName === 'datasets') { buildDatasetsTab(treeState, tabState.panelElement); }
            if (tabState.tabName === 'troubleshooting') { buildTroubleshootingTab(treeState, tabState.panelElement); }
            if (tabState.tabName === 'query') { buildQueryTab(treeState, tabState.panelElement); }
            if (tabState.tabName === 'updater') { buildUpdaterTab(treeState, tabState.panelElement); }
        }

        if (isSelected && tabState.tabName === 'troubleshooting') { requestTroubleshootingSummary(treeState); }
        if (isSelected && tabState.tabName === 'query') { requestTreeQueries(treeState); }
        if (isSelected && tabState.tabName === 'updater') { requestUpdaterSnapshots(treeState); }

    });

    // AFTER THE MODEL'S "rendered" -- A CLICK CAN ONLY COME FROM A DRAWN PANEL -- AND NEVER FOR A RESTORE, WHICH IS THE PANEL'S OWN OPEN
    if (tabName === 'treecipe' && renderedSequence !== null && !isRestoringPlace && treeState.isExpanded) { requestDataOrgs(); }

    savePanelPlace();

}

function drawTabMotion(treeState: CardTreeState, tabName: string, isAnimated: boolean): void {

    const tabNames = treeState.tabStates.map(function (tabState) { return tabState.tabName; });
    const fromIndex = tabNames.indexOf(treeState.selectedTab);
    const toIndex = tabNames.indexOf(tabName);

    ['movingLeft', 'movingRight', 'noMotion'].forEach(function (className) { treeState.tabsElement.classList.remove(className); });
    if (!isAnimated) {
        treeState.tabsElement.classList.add('noMotion');
    } else if (fromIndex !== toIndex) {
        treeState.tabsElement.classList.add(toIndex > fromIndex ? 'movingRight' : 'movingLeft');
    }

}
