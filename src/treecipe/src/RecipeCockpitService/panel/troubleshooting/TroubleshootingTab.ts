import { createButton, createElement, setShownWithMotion } from '../../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_TROUBLESHOOTING_GROUP_EMOJI, RecipeCockpitTroubleshootingGroupKind } from '../../RecipeCockpitPanelConstants';
import {
    MetadataDeployKind,
    RECIPE_COCKPIT_DATASET_INSERT_RUNNING_REASON,
    RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS,
    RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_LABELS,
    RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_PLACEHOLDERS,
    RECIPE_COCKPIT_TROUBLESHOOTING_TAB_LABEL,
    RecipeCockpitTroubleshootingSubTab
} from '../../RecipeCockpitTroubleshootingConstants';
import { IActionCardView, buildTabSearch } from '../RecipeCockpitPanelBuilders';
import { buildAssignPermissionSetCard, buildDeployAction, buildGeneratePermissionSetCard, buildRetrieveAction, drawTreePermissionSet } from './TroubleshootingActions';
import { buildTroubleshootingHistory, requestTroubleshootingHistory } from './TroubleshootingHistory';
import { applyRemovedTodosFilter, buildTodosViewFrame, buildTroubleshootingTodos, setTodoGroupExpanded } from './TroubleshootingTodos';
import { IShownState, ITroubleshootingSubTabState, ITroubleshootingSummaryMessage, ITroubleshootingTreeState } from './TroubleshootingTypes';
import { buildTroubleshootingValidationRules, requestTreeValidationRules, setValidationRuleGroupExpanded } from './TroubleshootingValidationRules';

/*
    The Troubleshooting tab's frame (#346, #365, #639): its sub-tabs, their searches and the summary of
    what each deploy and retrieve would do. These names are the panel script's own, read when a
    function runs.
*/
declare const vscodeApi: { postMessage(message: unknown): void };
declare const renderedSequence: number | null;
declare const treeStates: ITroubleshootingTreeState[];
declare const insertRunningDatasetFolderName: string | null;
declare function pluralize(count: number, singular: string, plural: string): string;
declare function savePanelPlace(): void;
declare function expandMatchesWithinBudget<GroupState>(groupStates: GroupState[], matchCountOf: (groupState: GroupState) => number, rowCountOf: (groupState: GroupState) => number, setExpanded: (groupState: GroupState, isExpanded: boolean) => void): void;

// WHICH SUB-TABS A FILTER REDRAWS: ONE BY NAME, EVERY ACTION SUB-TAB AFTER A SUMMARY, OR ALL OF THEM
export type TroubleshootingFilterScope = RecipeCockpitTroubleshootingSubTab | 'actions' | undefined;

/*
    The Troubleshooting tab (#346), on every card with a folder: what to do when an insert
    failed. Since #365 it is a row of sub-tabs, one area at a time: TODO's, Fields,
    Permissions, Validation Rules, Record Types, Global Value Sets. Every sub-tab is built with
    the tab, so every button and its run lock is where it always was, and only the selected one
    is shown. Each has its own search box, which hides the entries that do not match. What each
    deploy would deploy is read by the host from the project each time the tab is selected;
    only COUNTS come back, and a deploy with nothing to deploy draws its button disabled with the
    reason.
*/
export function buildTroubleshootingTab(treeState: ITroubleshootingTreeState, panelElement: HTMLElement): void {

    const tree = treeState.tree;
    const stripElement = createElement('div', 'troubleshootingSubTabs');
    stripElement.setAttribute('role', 'tablist');
    stripElement.setAttribute('aria-label', RECIPE_COCKPIT_TROUBLESHOOTING_TAB_LABEL);
    panelElement.appendChild(stripElement);

    treeState.troubleshootingStripElement = stripElement;
    treeState.troubleshootingSubTabStates = [];
    treeState.deployCards = Object.create(null);
    treeState.retrieveCards = Object.create(null);

    if (treeState.troubleshootingSubTab === undefined || RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS.indexOf(treeState.troubleshootingSubTab) === -1) {
        treeState.troubleshootingSubTab = RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS[0];
    }

    // A SUB-TAB'S CARDS SIT IN ONE GRID, ABOVE ANY LIST THE SUB-TAB ALSO DRAWS
    const addActionItem = function (subTabState: ITroubleshootingSubTabState, actionCard: IActionCardView) {
        if (!subTabState.cardGridElement) {
            subTabState.cardGridElement = createElement('div', 'troubleshootingCards');
            subTabState.listElement.appendChild(subTabState.cardGridElement);
        }
        const actionElement = createElement('div', 'troubleshootingAction');
        actionElement.appendChild(actionCard.buttonElement);
        subTabState.cardGridElement.appendChild(actionElement);
        subTabState.items.push({ element: actionElement });
    };

    const addDeployItem = function (subTabState: ITroubleshootingSubTabState, deployKind: MetadataDeployKind) {
        addActionItem(subTabState, buildDeployAction(treeState, deployKind));
    };

    RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS.forEach(function (subTab) {

        const subTabState = addTroubleshootingSubTab(treeState, subTab, panelElement);

        if (subTab === 'todos') {
            buildTroubleshootingTodos(treeState, subTabState);
        } else if (subTab === 'fields') {
            addDeployItem(subTabState, 'fields');
            addActionItem(subTabState, buildRetrieveAction(treeState, 'fields'));
        } else if (subTab === 'permissions') {
            if (tree.objects.length > 0) { addActionItem(subTabState, buildAssignPermissionSetCard(treeState)); }
            addActionItem(subTabState, buildGeneratePermissionSetCard(treeState));
            addDeployItem(subTabState, 'permissionSet');
        } else if (subTab === 'validationRules') {
            addActionItem(subTabState, buildRetrieveAction(treeState, 'validationRules'));
            buildTroubleshootingValidationRules(treeState, subTabState);
        } else if (subTab === 'recordTypes') {
            addDeployItem(subTabState, 'recordTypes');
            addActionItem(subTabState, buildRetrieveAction(treeState, 'recordTypes'));
        } else if (subTab === 'globalValueSets') {
            addDeployItem(subTabState, 'globalValueSets');
            addActionItem(subTabState, buildRetrieveAction(treeState, 'globalValueSets'));
        } else if (subTab === 'history') {
            buildTroubleshootingHistory(treeState, subTabState);
        }

    });

    selectTroubleshootingSubTab(treeState, treeState.troubleshootingSubTab, false);
    drawTreePermissionSet(treeState);
    applyTroubleshootingFilter(treeState);

}


export function troubleshootingSearchKey(subTab: string): string {
    return 'troubleshooting.' + subTab;
}


function addTroubleshootingSubTab(treeState: ITroubleshootingTreeState, subTab: RecipeCockpitTroubleshootingSubTab, panelElement: HTMLElement): ITroubleshootingSubTabState {

    const label = RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_LABELS[subTab];
    const tabElement = createButton('secondary', 'troubleshootingSubTab troubleshootingSubTab-' + subTab, label);
    tabElement.setAttribute('data-label', label);
    const subPanelElement = createElement('div', 'troubleshootingSubPanel troubleshootingSubPanel-' + subTab + ' hidden');
    const searchKey = troubleshootingSearchKey(subTab);

    tabElement.setAttribute('role', 'tab');
    tabElement.setAttribute('aria-selected', 'false');
    subPanelElement.setAttribute('role', 'tabpanel');
    subPanelElement.setAttribute('aria-label', label);
    tabElement.addEventListener('click', function () { selectTroubleshootingSubTab(treeState, subTab, true); });

    if (typeof treeState.searchTexts[searchKey] !== 'string') {
        treeState.searchTexts[searchKey] = '';
        treeState.searchQueries[searchKey] = '';
    }

    const search = buildTabSearch(treeState, searchKey, RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TAB_PLACEHOLDERS[subTab], function () { applyTroubleshootingFilter(treeState, subTab); });
    const listElement = createElement('div', 'troubleshootingList');
    // THE TODO'S SUB-TAB HOLDS TWO LISTS (#391): ITS SEARCH AND ITS LIST ARE THE OPEN ONE'S
    const todosFrame = subTab === 'todos' ? buildTodosViewFrame(treeState, subPanelElement) : null;
    const contentElement = todosFrame ? todosFrame.viewStates.open.panelElement : subPanelElement;
    contentElement.appendChild(search.element);
    contentElement.appendChild(listElement);

    (treeState.troubleshootingStripElement as HTMLElement).appendChild(tabElement);
    panelElement.appendChild(subPanelElement);

    const subTabState: ITroubleshootingSubTabState = { subTab: subTab, tabElement: tabElement, panelElement: subPanelElement, search: search, listElement: listElement, items: [], noun: ['action', 'actions'], todosFrame: todosFrame };
    (treeState.troubleshootingSubTabStates as ITroubleshootingSubTabState[]).push(subTabState);

    return subTabState;

}


export function selectTroubleshootingSubTab(treeState: ITroubleshootingTreeState, subTab: RecipeCockpitTroubleshootingSubTab, isAnimated: boolean): void {

    const subTabStates = treeState.troubleshootingSubTabStates || [];
    if (!subTabStates.some(function (subTabState) { return subTabState.subTab === subTab; })) { return; }

    const subTabNames = subTabStates.map(function (subTabState) { return subTabState.subTab; });
    const fromIndex = treeState.troubleshootingSubTab === undefined ? -1 : subTabNames.indexOf(treeState.troubleshootingSubTab);
    const toIndex = subTabNames.indexOf(subTab);
    const stripElement = treeState.troubleshootingStripElement as HTMLElement;

    ['movingLeft', 'movingRight', 'noMotion'].forEach(function (className) { stripElement.classList.remove(className); });
    if (!isAnimated) {
        stripElement.classList.add('noMotion');
    } else if (fromIndex !== toIndex) {
        stripElement.classList.add(toIndex > fromIndex ? 'movingRight' : 'movingLeft');
    }

    treeState.troubleshootingSubTab = subTab;
    if (isAnimated && subTab === 'validationRules') { requestTreeValidationRules(treeState); }
    if (isAnimated && subTab === 'history') { requestTroubleshootingHistory(treeState); }

    subTabStates.forEach(function (subTabState) {
        const isSelected = subTabState.subTab === subTab;
        if (isSelected) { subTabState.tabElement.classList.add('selected'); } else { subTabState.tabElement.classList.remove('selected'); }
        subTabState.tabElement.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        setShownWithMotion(subTabState.panelElement, isSelected, isSelected && isAnimated);
    });

    savePanelPlace();

}


/*
    Each sub-tab's own search (#365): it hides the entries that do not match and counts what is
    left. A keystroke filters only its own sub-tab (onlySubTab); a deploy summary refreshes only
    the action sub-tabs ('actions'); a build or restore filters them all.
*/
export function applyTroubleshootingFilter(treeState: ITroubleshootingTreeState, onlySubTab?: TroubleshootingFilterScope): void {

    (treeState.troubleshootingSubTabStates || []).forEach(function (subTabState) {

        if (onlySubTab === 'actions' ? subTabState.subTab === 'todos' : (onlySubTab && onlySubTab !== subTabState.subTab)) { return; }

        const searchQuery = treeState.searchQueries[troubleshootingSearchKey(subTabState.subTab)] || '';
        let matchingCount = 0;
        let total = 0;

        if (subTabState.todoGroups) {

            subTabState.todoGroups.forEach(function (groupState) {
                groupState.matchingCount = 0;
                groupState.entries.forEach(function (entry) {
                    entry.isMatch = !searchQuery || entry.searchText.indexOf(searchQuery) !== -1;
                    if (entry.isMatch) { groupState.matchingCount++; }
                    if (entry.element) { setShownIfChanged(entry, entry.element, entry.isMatch); }
                });
                total += groupState.entries.length;
                matchingCount += groupState.matchingCount;
                setShownIfChanged(groupState, groupState.element as HTMLElement, !searchQuery || groupState.matchingCount > 0);
                groupState.countElement.textContent = searchQuery
                    ? groupState.matchingCount + ' of ' + pluralize(groupState.entries.length, 'TODO', 'TODOs')
                    : pluralize(groupState.entries.length, 'TODO', 'TODOs');
            });

            expandMatchesWithinBudget(subTabState.todoGroups,
                function (groupState) { return groupState.matchingCount; },
                function (groupState) { return groupState.entries.length; },
                function (groupState, isExpanded) { setTodoGroupExpanded(groupState, isExpanded, false); });

            applyRemovedTodosFilter(treeState, subTabState);

        } else {

            subTabState.items.forEach(function (item) {
                // AN ACTION IS MATCHED BY WHAT IT DRAWS NOW: ITS BUTTON, ITS REASON AND WHAT IT WOULD DEPLOY
                const isMatch = !searchQuery || collectElementText(item.element).join('\n').toLowerCase().indexOf(searchQuery) !== -1;
                if (isMatch) { matchingCount++; }
                if (item.isShown === undefined) { item.isShown = true; }
                setShownIfChanged(item, item.element, isMatch);
            });
            total = subTabState.items.length;

            // THE VALIDATION RULES SUB-TAB COUNTS ITS RULES, NOT ITS ONE ACTION (#327); A ROW IS MATCHED BY ITS SAVED TEXT, BUILT OR NOT
            if (subTabState.ruleGroups) {
                matchingCount = 0;
                total = 0;
                subTabState.ruleGroups.forEach(function (groupState) {
                    groupState.matchingCount = 0;
                    groupState.entries.forEach(function (entry) {
                        entry.isMatch = !searchQuery || entry.searchText.indexOf(searchQuery) !== -1;
                        if (entry.isMatch) { groupState.matchingCount++; }
                        if (entry.element) { setShownIfChanged(entry, entry.element, entry.isMatch); }
                    });
                    total += groupState.entries.length;
                    matchingCount += groupState.matchingCount;
                    const isObjectNamed = groupState.objectApiName.toLowerCase().indexOf(searchQuery) !== -1;
                    setShownIfChanged(groupState, groupState.element as HTMLElement, !searchQuery || groupState.matchingCount > 0 || isObjectNamed);
                    groupState.countElement.textContent = groupState.entries.length === 0 ? ''
                        : searchQuery ? groupState.matchingCount + ' of ' + pluralize(groupState.entries.length, 'rule', 'rules')
                        : pluralize(groupState.entries.length, 'rule', 'rules');
                });
                expandMatchesWithinBudget(subTabState.ruleGroups.filter(function (groupState) { return groupState.entries.length > 0; }),
                    function (groupState) { return groupState.matchingCount; },
                    function (groupState) { return groupState.entries.length; },
                    function (groupState, isExpanded) { setValidationRuleGroupExpanded(treeState, groupState, isExpanded, false); });
            }

            // THE HISTORY COUNTS ITS STEPS (#485); A ROW IS MATCHED BY WHAT IT DRAWS, SAVED WHEN IT WAS BUILT
            if (subTabState.historyRows) {
                matchingCount = 0;
                total = subTabState.historyRows.length;
                subTabState.historyRows.forEach(function (rowState) {
                    const isMatch = !searchQuery || rowState.searchText.indexOf(searchQuery) !== -1;
                    if (isMatch) { matchingCount++; }
                    setShownIfChanged(rowState, rowState.element, isMatch);
                });
            }

        }

        subTabState.search.matchCountElement.textContent = !searchQuery
            ? pluralize(total, subTabState.noun[0], subTabState.noun[1])
            : matchingCount > 0 ? matchingCount + ' of ' + pluralize(total, subTabState.noun[0], subTabState.noun[1]) : 'no matches';

    });

}


// ASKED EACH TIME THE TAB IS SELECTED; ONE SELECTED BEFORE THE MODEL WAS ACKNOWLEDGED (A RESTORE) ASKS ONCE IT IS
export function requestTroubleshootingSummary(treeState: ITroubleshootingTreeState): void {

    if (renderedSequence === null) {
        treeState.isTroubleshootingSummaryWanted = true;
        return;
    }

    treeState.isTroubleshootingSummaryWanted = false;
    vscodeApi.postMessage({ command: 'loadTroubleshootingSummary', treeKey: treeState.tree.treeKey, renderSequence: renderedSequence });
    if (treeState.troubleshootingSubTab === 'validationRules') { requestTreeValidationRules(treeState); }
    if (treeState.troubleshootingSubTab === 'history') { requestTroubleshootingHistory(treeState); }

}


export function renderTroubleshootingSummary(summaryMessage: ITroubleshootingSummaryMessage): void {

    if (renderedSequence === null || summaryMessage.renderSequence !== renderedSequence) { return; }

    const treeState = treeStates.find(function (candidateTreeState) { return candidateTreeState.tree.treeKey === summaryMessage.treeKey; });
    if (!treeState) { return; }

    treeState.troubleshootingSummary = summaryMessage;
    drawTreePermissionSet(treeState);
    applyTroubleshootingFilter(treeState, 'actions');

}


/*
    A TODO or validation rule group as a card (#383). Its header is ONE card button that opens
    and closes the group -- the kind's emoji, the object and the count on one line -- and its
    rows go in the body under it, built by the caller on first open. A group with nothing to
    open draws the same header as text. Constant per group: no element is added per row.
*/
export function buildTroubleshootingGroupCard(groupKind: RecipeCockpitTroubleshootingGroupKind, groupClassName: string, headerClassName: string, label: string, labelClassName: string, countElement: HTMLElement, bodyElement: HTMLElement | null, isToggle: boolean): { element: HTMLElement; headerElement: HTMLElement } {

    const element = createElement('div', 'troubleshootingGroupCard ' + groupClassName);
    const headerElement = isToggle ? createButton('card', 'troubleshootingGroupCardHeader ' + headerClassName) : createElement('div', 'troubleshootingGroupCardHeader');
    const headingElement = createElement('span', 'actionCardHeading troubleshootingGroupCardHeading');
    const emojiElement = createElement('span', 'actionCardEmoji', RECIPE_COCKPIT_TROUBLESHOOTING_GROUP_EMOJI[groupKind]);

    emojiElement.setAttribute('aria-hidden', 'true');
    if (isToggle) { headerElement.setAttribute('aria-expanded', 'false'); }

    headingElement.appendChild(emojiElement);
    headingElement.appendChild(createElement('span', labelClassName + ' troubleshootingGroupCardLabel', label));
    headingElement.appendChild(countElement);
    headerElement.appendChild(headingElement);
    element.appendChild(headerElement);
    if (bodyElement) { element.appendChild(bodyElement); }

    return { element: element, headerElement: headerElement };

}


export function drawTroubleshootingGroupExpanded(groupState: { toggleElement: HTMLElement | null; element: HTMLElement | null }, isExpanded: boolean): void {
    (groupState.toggleElement as HTMLElement).setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    if (isExpanded) { (groupState.element as HTMLElement).classList.add('expanded'); } else { (groupState.element as HTMLElement).classList.remove('expanded'); }
}


// A ROW OR GROUP IS WRITTEN ONLY WHEN ITS VISIBILITY CHANGES, SO A KEYSTROKE OVER THOUSANDS OF TODOS TOUCHES ONLY WHAT IT CHANGED
export function setShownIfChanged(state: IShownState, element: Element, isShown: boolean): void {
    if (state.isShown === isShown) { return; }
    state.isShown = isShown;
    if (isShown) { element.classList.remove('hidden'); } else { element.classList.add('hidden'); }
}


// EVERY TEXT AN ELEMENT DRAWS, ITS DESCENDANTS' INCLUDED -- WHAT IS SEARCHABLE IS WHAT IS ON SCREEN, SO NOT A TOOLTIP
function collectElementText(element: Element): string[] {

    const texts = [String(element.textContent || '')];
    Array.prototype.forEach.call(element.children || [], function (childElement: Element) { texts.push.apply(texts, collectElementText(childElement)); });
    return texts;

}


export function describeRunningInsert(): string {
    return insertRunningDatasetFolderName !== null ? RECIPE_COCKPIT_DATASET_INSERT_RUNNING_REASON : 'A tree is being inserted.';
}
