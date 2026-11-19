import { closeConfirmDialog } from '../../../CockpitKit/panel/CockpitConfirmDialogPanel';
import { createElement } from '../../../CockpitKit/panel/CockpitPanelElements';
import { RECIPE_COCKPIT_GENERATE_TREECIPE_ACTION_LABEL, RECIPE_COCKPIT_GENERATE_TREECIPE_RUNNING_LABEL, RECIPE_COCKPIT_ORG_SECTION_TITLE, RECIPE_COCKPIT_RUN_PICKER_LABEL, RECIPE_COCKPIT_TREECIPES_SECTION_TITLE } from '../../RecipeCockpitShellConstants';
import { requestUpdaterSnapshots } from '../adapter/AdapterLoadAndUpdate';
import { requestDatasetJourney } from '../datasets/DatasetJourney';
import { resetDatasetRecordCounts } from '../datasets/DatasetRow';
import { requestTreeQueries } from '../query/QueryTab';
import { buildActionCard } from '../RecipeCockpitPanelBuilders';
import { cockpitBodyElement, vscodeApi } from '../RecipeCockpitPanelConnection';
import { drawActionCardState } from '../RecipeCockpitPanelShared';
import { requestTroubleshootingSummary } from '../troubleshooting/TroubleshootingTab';
import { renderTrees } from '../treecipe/card/TreeCard';
import { requestDataOrgs } from '../treecipe/dataOrg/DataOrgListing';
import { dataOrgPicker, resetDataOrgPickerState } from '../treecipe/dataOrg/DataOrgPickerState';
import { buildDataOrgView } from '../treecipe/dataOrg/DataOrgView';
import { resetLookupButtons } from '../treecipe/fieldEditor/LookupWiring';
import { resetPicklistValueRequests } from '../treecipe/fieldEditor/PicklistTiles';
import { resetFieldSearchTexts } from '../treecipe/fieldRows/FieldRow';
import { navigationState, resetNavigationState } from '../treecipe/navigation/NavigationState';
import { applyTreeFocus } from '../treecipe/navigation/StructureFilter';
import { closeObjectRefreshDialog } from '../treecipe/objectRefresh/ObjectRefreshDialog';
import { resetRecordTypesState } from '../treecipe/recordTypes/RecordTypesState';
import { renderHelp, resetHelpState } from './Help';
import { applyPlaceBeforeRender, restorePlaceAfterRender, restoreScroll, savePanelPlace, takeRestorablePlace, takeSameRunPlace } from './PanelPlace';
import type { CardTreeState, ICardModel } from '../treecipe/card/CardTypes';
import type { IPanelPlace } from './PanelPlace';
import type { IFocusTree } from '../treecipe/navigation/NavigationTypes';

/*
    The model on screen (#657): what the host posted under a renderSequence, drawn from scratch.
    renderedSequence is set only once the whole draw succeeded, and is what every panel action
    names; a render that threw replaces the body with a failure notice and posts the failure.
*/

// THE renderSequence OF THE MODEL ON SCREEN, OR null WHILE NONE IS DRAWN; EVERY ACTION A READER TAKES NAMES IT
export let renderedSequence: number | null = null;
export let renderedRunFolderName = '';
export let treeStates: CardTreeState[] = [];
export let treesViewElement: HTMLElement | null = null;
let runSelectElement: HTMLSelectElement | null = null;
// NEITHER THE ORG SECTION (#355) NOR THE TREECIPES SECTION (#364) FOLDS
let orgSection: ICockpitSection | null = null;

interface ICockpitSection {
    element: HTMLElement;
    bodyElement: HTMLElement;
}

// THE DATED RUNS, WITH A VISIBLE LABEL THAT NAMES THE DROPDOWN (#533); NOTHING WITHOUT A RUN
function buildRunPicker(recipe: ICardModel): HTMLElement | null {

    if (recipe.runs.length === 0) { return null; }

    const pickerElement = createElement('div', 'runPicker');
    const labelElement = createElement('label', 'runPickerLabel', RECIPE_COCKPIT_RUN_PICKER_LABEL);
    const selectElement = createElement('select', 'runSelect');

    runSelectElement = selectElement;
    selectElement.setAttribute('id', 'runSelect');
    labelElement.setAttribute('for', 'runSelect');

    recipe.runs.forEach(function (run) {
        const runOptionElement = createElement('option', '', run.label);
        runOptionElement.value = run.runFolderName;
        runOptionElement.selected = run.runFolderName === recipe.selectedRunFolderName;
        selectElement.appendChild(runOptionElement);
    });

    selectElement.value = recipe.selectedRunFolderName;
    selectElement.addEventListener('change', function () {
        vscodeApi.postMessage({ command: 'selectRun', runFolderName: selectElement.value });
    });

    pickerElement.appendChild(labelElement);
    pickerElement.appendChild(selectElement);

    return pickerElement;

}

// A RUN SWITCH THE READER CANCELLED, OR A RUN THAT FAILED TO LOAD, LEAVES THE RUN ON SCREEN: THE SELECTOR NAMES IT AGAIN
export function restoreRunSelection(): void {

    if (runSelectElement) {
        runSelectElement.value = renderedRunFolderName;
    }

}

function renderPanel(recipe: ICardModel): void {

    resetPanelState();
    renderedRunFolderName = recipe.selectedRunFolderName;

    const hasObjects = recipe.objects.length > 0;

    treesViewElement = createElement('div', 'treesView');

    // NO TOOLBAR ROW (#548): THE ORG PICKER IS THE TARGET ORG MANAGER'S, THE RUN LIST AND FAVORITES ONLY THE TREECIPES SECTION'S
    renderHelp(recipe, hasObjects);

    const runPickerElement = buildRunPicker(recipe);
    const trees = recipe.trees || [];

    // A RUN THE CARDS CANNOT SHOW KEEPS ITS SELECTOR ABOVE EVERYTHING ELSE, SO ANOTHER RUN CAN BE CHOSEN
    if (runPickerElement && (!hasObjects || trees.length === 0)) {
        cockpitBodyElement.appendChild(runPickerElement);
    }

    recipe.notices.forEach(function (notice) {
        cockpitBodyElement.appendChild(createElement('div', 'notice', notice));
    });

    if (!hasObjects) {
        cockpitBodyElement.appendChild(createElement('div', 'emptyState', recipe.emptyStateMessage));
        // ONLY WHEN THERE IS NO RUN AT ALL: A RUN THAT COULD NOT BE READ KEEPS ITS RUN SELECTOR INSTEAD
        if (recipe.runs.length === 0) {
            cockpitBodyElement.appendChild(buildGenerateTreecipeElement());
        }
        return;
    }

    // A RUN WITH NO TREES SAYS SO, WITH NO SECTION AROUND THE NOTICE AND NO ORG TO PICK FOR NOTHING
    if (trees.length === 0) {
        cockpitBodyElement.appendChild(treesViewElement);
        renderTrees(recipe);
        return;
    }

    // ONLY WHEN SOME CARD CAN GENERATE: WITH NOTHING TO GENERATE THERE IS NOTHING TO PICK AN ORG FOR
    if (trees.some(function (tree) { return !!tree.runFakerRecipeFileName; })) {
        orgSection = buildStaticCockpitSection('cockpitOrgSection', RECIPE_COCKPIT_ORG_SECTION_TITLE);
        orgSection.bodyElement.appendChild(buildDataOrgView().element);
        cockpitBodyElement.appendChild(orgSection.element);
    }

    const treecipesSection = buildStaticCockpitSection('cockpitTreecipesSection', RECIPE_COCKPIT_TREECIPES_SECTION_TITLE);
    const treecipesControlsElement = createElement('div', 'treecipesControls');
    navigationState.treecipesControlsElement = treecipesControlsElement;
    // THE RUN FIRST, THEN THE SEARCH AND THE TREECIPE DROPDOWN renderTrees ADDS UNDER IT (#533)
    if (runPickerElement) { treecipesControlsElement.appendChild(runPickerElement); }
    treecipesSection.bodyElement.appendChild(treecipesControlsElement);
    treecipesSection.bodyElement.appendChild(treesViewElement);
    cockpitBodyElement.appendChild(treecipesSection.element);

    renderTrees(recipe);

}

// THE TARGET ORG MANAGER (#355) AND TREECIPES (#364) SECTIONS: A HEADER AND A BODY, WITH NO TOGGLE AND NO LISTENER
function buildStaticCockpitSection(sectionId: string, title: string): ICockpitSection {

    const sectionElement = createElement('section', 'cockpitSection');
    const headerElement = createElement('div', 'cockpitSectionHeader cockpitSectionStatic');
    const bodyElement = createElement('div', 'cockpitSectionBody');

    sectionElement.setAttribute('id', sectionId);
    sectionElement.setAttribute('aria-label', title);
    bodyElement.setAttribute('id', sectionId + 'Body');
    headerElement.appendChild(createElement('span', 'cockpitSectionTitle', title));
    sectionElement.appendChild(headerElement);
    sectionElement.appendChild(bodyElement);

    return { element: sectionElement, bodyElement: bodyElement };

}

// EVERYTHING ONE MODEL'S DRAW HELD, DROPPED BEFORE THE NEXT DRAW OR A FAILURE NOTICE REPLACES IT
function resetPanelState(): void {

    cockpitBodyElement.textContent = '';
    // THE HOST ANSWERS AN OPEN CONFIRMATION CANCEL WHEN IT POSTS A NEW MODEL, AND A FAILURE TO DRAW ENDS IT TOO
    closeConfirmDialog(false);
    closeObjectRefreshDialog(false);
    resetHelpState();
    treeStates = [];
    treesViewElement = null;
    orgSection = null;
    resetDataOrgPickerState();
    resetPicklistValueRequests();
    resetRecordTypesState();
    resetDatasetRecordCounts();
    resetFieldSearchTexts();
    resetLookupButtons();
    runSelectElement = null;
    resetNavigationState();
    renderedSequence = null;

}

/*
    A partial page is an arbitrary prefix of the model, not a smaller correct answer, so a
    render that threw replaces the body with a failure notice.
*/
function renderPanelFailure(): void {

    resetPanelState();
    cockpitBodyElement.appendChild(createElement('div', 'emptyState', 'The Recipe Cockpit could not draw this recipe. The error has been reported; re-open the cockpit to try again.'));

}

interface IFailureCause {
    message?: unknown;
    type?: unknown;
    stack?: unknown;
}

function describeFailure(failureCause: unknown): string {

    if (!failureCause) { return 'unknown error'; }
    if (typeof failureCause === 'string') { return failureCause; }
    const cause = failureCause as IFailureCause;
    if (cause.message) { return String(cause.message); }
    if (cause.type) { return 'a ' + String(cause.type) + ' event with no message'; }

    return String(failureCause);

}

export function postRenderFailure(failurePhase: 'render' | 'runtime', failureCause: unknown): void {

    const cause = failureCause as IFailureCause | null | undefined;

    vscodeApi.postMessage({
        command: 'renderFailed',
        phase: failurePhase,
        message: describeFailure(failureCause),
        stack: String(cause && cause.stack ? cause.stack : '')
    });

}

export function renderPanelGuarded(recipe: ICardModel, renderSequence: number, focusTree: unknown, hostPlace: unknown): boolean {

    // THE SAVED PLACE IS SPENT ON THIS DOCUMENT'S FIRST MODEL WHETHER OR NOT IT APPLIES; A LATER MODEL OF THE SAME RUN KEEPS THE PLACE ON SCREEN
    const savedPlace: IPanelPlace | null = takeRestorablePlace(recipe, hostPlace) || takeSameRunPlace(recipe);

    try {

        applyPlaceBeforeRender(savedPlace);
        renderPanel(recipe);
        renderedSequence = renderSequence;
        vscodeApi.postMessage({ command: 'rendered', renderSequence: renderSequence });

        // ONCE THE READER HAS USED THE PICKER, A NEW MODEL COUNTS ITS OBJECTS IN THE SAME ORG
        if (dataOrgPicker.isDataOrgPickerInUse) { requestDataOrgs(); }

    } catch (renderError) {

        renderPanelFailure();
        postRenderFailure('render', renderError);

        return false;

    }

    // AFTER "rendered": WHAT A RESTORE OR A FOCUS OPENS MAY ASK THE HOST, WHICH ANSWERS ONLY ONCE THE ACK HAS ACTIVATED ITS ALLOW-LISTS
    try {
        restorePlaceAfterRender(savedPlace);
        // A FOCUS IS WHAT THE READER JUST ASKED FOR, SO IT WINS OVER WHERE THEY LAST WERE
        // AND A FOCUS THAT SCROLLED TO A ROW IS NOT SCROLLED BACK TO THE OFFSET THE PLACE SAVED
        const hasFocusScrolled = applyTreeFocus(focusTree as IFocusTree | null) === true;
        if (!hasFocusScrolled) { restoreScroll(savedPlace); }
        // A TROUBLESHOOTING TAB SELECTED BEFORE THE ACK (#346) ASKS FOR ITS COUNTS NOW
        treeStates.forEach(function (treeState) { if (treeState.isTroubleshootingSummaryWanted) { requestTroubleshootingSummary(treeState); } });
        // AND A QUERY TAB'S QUERIES (#367)
        treeStates.forEach(function (treeState) { if (treeState.isTreeQueriesWanted) { requestTreeQueries(treeState); } });
        // AND AN UPDATER TAB'S SNAPSHOTS (#419)
        treeStates.forEach(function (treeState) { if (treeState.isUpdaterSnapshotsWanted) { requestUpdaterSnapshots(treeState); } });
        // AND A DATA SET ROW'S JOURNEY (#471)
        treeStates.forEach(function (treeState) {
            (treeState.datasetRowStates || []).forEach(function (rowState) { if (rowState.isJourneyWanted) { requestDatasetJourney(rowState); } });
        });
    } catch (focusError) {
        postRenderFailure('runtime', focusError);
    }

    savePanelPlace();

    return true;

}

export function findTreeState(treeKey: unknown): CardTreeState | null {

    return treeStates.find(function (candidateTreeState) { return candidateTreeState.tree.treeKey === treeKey; }) || null;

}

// DISABLED UNTIL THE HOST'S RELOAD REDRAWS THE BODY, WHICH IT DOES HOWEVER GENERATION ENDED
function buildGenerateTreecipeElement(): HTMLElement {

    const generateElement = createElement('div', 'emptyStateActions actionCards');
    const actionCard = buildActionCard('generateTreecipe', 'generateTreecipe', RECIPE_COCKPIT_GENERATE_TREECIPE_ACTION_LABEL);
    const generateButtonElement = actionCard.buttonElement;

    generateButtonElement.addEventListener('click', function () {
        if (generateButtonElement.disabled) { return; }
        actionCard.titleElement.textContent = RECIPE_COCKPIT_GENERATE_TREECIPE_RUNNING_LABEL;
        drawActionCardState(actionCard, 'Generate Treecipe is running.', '');
        vscodeApi.postMessage({ command: 'generateTreecipe' });
    });

    drawActionCardState(actionCard, '', 'Run Generate Treecipe on this project, then open the run it writes here.');
    generateElement.appendChild(generateButtonElement);

    return generateElement;

}
