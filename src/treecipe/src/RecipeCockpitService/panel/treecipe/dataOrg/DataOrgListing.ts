import { RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT, RECIPE_COCKPIT_ORG_LOADING_PLACEHOLDER } from '../../../RecipeCockpitDataOrgConstants';
import { drawDataOrgViews } from './DataOrgView';
import {
    IDataOrgListMessage,
    IDataOrgListingRefusedMessage,
    IDataOrgPickerBeforeCheck,
    IDataOrgProvisionalMessage,
    IDataOrgReadiness,
    IDataOrgReadinessMessage,
    IDataOrgSelectionMessage,
    IScratchOrgStateMessage
} from './DataOrgTypes';
import { drawTreeInserts } from './TreeInsert';
import { buildTreeObjectKey } from '../navigation/StructureFilter';
import { renderedSequence } from '../../shell/PanelRender';
import { savePanelPlace } from '../../shell/PanelPlace';
import { vscodeApi } from '../../RecipeCockpitPanelConnection';
import { runLocks } from '../../RecipeCockpitRunLocks';
import { dataOrgPicker } from './DataOrgPickerState';

/*
    Target Org Manager's org list and connection check (#255, #305, #537): what the host's listing,
    selection and readiness answers draw, each dropped unless it answers the model drawn and the
    newest request. The picker's state is dataOrgPicker's (DataOrgPickerState.ts), which a new
    model empties; these functions only set it.
*/

export function renderScratchOrgState(hostMessage: IScratchOrgStateMessage): void {

    runLocks.isScratchOrgRunning = !!hostMessage.isRunning;
    runLocks.isOrgAuthorizeRunning = runLocks.isScratchOrgRunning && hostMessage.isAuthorizing === true;

    drawDataOrgViews();
    drawTreeInserts();

}

export function renderDataOrgReadiness(dataOrgReadiness: IDataOrgReadinessMessage): void {

    if (renderedSequence === null || dataOrgReadiness.renderSequence !== renderedSequence || dataOrgReadiness.requestSequence !== dataOrgPicker.dataOrgRequestSequence) { return; }

    dataOrgReadiness.objects.forEach(function (readiness) { dataOrgPicker.dataOrgReadinessByObject[readiness.objectApiName] = readiness; });
    (dataOrgReadiness.createTargets || []).forEach(function (readiness) { dataOrgPicker.dataOrgReadinessByTreeObjectKey[buildTreeObjectKey(readiness.treeKey, readiness.objectApiName)] = readiness; });

    // THE CHECK IS OVER; A FAILURE THE SELECTION REPORTED STAYS ON SCREEN
    if (!dataOrgPicker.isDataOrgStatusFailure) { setDataOrgStatus('', false); }

    drawTreeInserts();

}

function setDataOrgStatus(statusText: string, isFailure: boolean): void {

    dataOrgPicker.dataOrgStatusText = statusText;
    dataOrgPicker.isDataOrgStatusFailure = !!isFailure;
    drawDataOrgViews();

}

// THE FIRST USE OF THE PICKER, OR THE FIRST OPEN OF ANY CARD'S TREECIPE TAB -- NEVER THE PANEL'S OWN OPEN
export function requestDataOrgs(): void {

    // A SCRATCH ORG RUN ENDS BY LISTING THE ORGS ITSELF
    if (renderedSequence === null || dataOrgPicker.dataOrgRequestedSequence === renderedSequence || runLocks.isScratchOrgRunning) { return; }

    // SAVED ONLY WHEN IT CHANGES: A NEW MODEL OF A PICKER ALREADY IN USE ASKS BEFORE ITS PLACE IS RESTORED, AND A SAVE THEN WOULD KEEP A HALF-RESTORED PLACE
    if (!dataOrgPicker.isDataOrgPickerInUse) {
        dataOrgPicker.isDataOrgPickerInUse = true;
        savePanelPlace();
    }
    holdDataOrgPickerBeforeCheck();
    dataOrgPicker.dataOrgRequestedSequence = renderedSequence;
    dataOrgPicker.isDataOrgLoadShown = false;
    dataOrgPicker.isDataOrgSelectShown = false;
    startDataOrgCheck();
    setDataOrgStatus(RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT, false);
    drawTreeInserts();
    dataOrgPicker.dataOrgUnansweredListingCount++;
    vscodeApi.postMessage({ command: 'loadDataOrgs' });

}

export function renderDataOrgList(dataOrgList: IDataOrgListMessage): void {

    if (renderedSequence === null || dataOrgList.renderSequence !== renderedSequence) { return; }

    dataOrgPicker.dataOrgPickerBeforeCheck = null;
    dataOrgPicker.dataOrgUnansweredListingCount = 0;
    dataOrgPicker.isDataOrgLoadShown = false;
    dataOrgPicker.isDataOrgChecking = false;
    // A LIST THE HOST POSTED AFTER ASKING FOR THE ORG (#375) MAKES THE PICKER IN USE, SO A LATER MODEL LISTS AGAIN
    dataOrgPicker.isDataOrgPickerInUse = true;
    clearDataOrgSelection();
    // ⟳ IS HOW A READER WHO JUST RE-AUTHORIZED AN ORG SEES IT LISTED, SO IT STAYS EVEN WITH NOTHING LISTED
    dataOrgPicker.isDataOrgRefreshShown = true;

    // PRODUCTION AND ORGS THE CLI DOES NOT REPORT CONNECTED ARE NEVER LISTED, AND THE READER IS TOLD WHY ONE THEY AUTHORIZED IS MISSING
    dataOrgPicker.dataOrgHiddenNoteText = [dataOrgList.forgottenOrgNotice || '', dataOrgList.hiddenOrgNote || ''].filter(Boolean).join(' ');
    dataOrgPicker.dataOrgLabels = Array.isArray(dataOrgList.orgLabels) ? dataOrgList.orgLabels.slice() : [];

    // THE DROPDOWN STAYS DRAWN WITH NOTHING TO CHOOSE, SO THE PICKER DOES NOT VANISH WHEN THE CHECK FOUND NO ORG (#305)
    dataOrgPicker.isDataOrgSelectShown = true;

    if (dataOrgPicker.dataOrgLabels.length === 0) {
        setDataOrgStatus(dataOrgList.noOrgsMessage, true);
        return;
    }

    dataOrgPicker.dataOrgSelectedIndex = dataOrgList.selectedOrgIndex === null ? null : dataOrgList.selectedOrgIndex;
    dataOrgPicker.isDataOrgSelectShown = true;
    setDataOrgStatus(dataOrgList.selectedOrgIndex === null ? 'Choose an org to insert into.' : '', false);
    drawTreeInserts();

}

// NO ORG IS SELECTED WHILE THE ORGS ARE BEING LISTED AGAIN, SO NOTHING FROM THE LAST ONE STAYS ON SCREEN
function clearDataOrgSelection(): void {

    /*
        With no selection, the insert is disabled: a re-listing that forgot the org posts no
        selection after it. The sequence it cleared is kept, so an answer still on its way for
        that selection is not drawn back in.
    */
    if (dataOrgPicker.dataOrgRequestSequence !== null) {
        dataOrgPicker.dataOrgClearedRequestSequence = Math.max(dataOrgPicker.dataOrgClearedRequestSequence === null ? 0 : dataOrgPicker.dataOrgClearedRequestSequence, dataOrgPicker.dataOrgRequestSequence);
    }
    dataOrgPicker.dataOrgRequestSequence = null;
    dataOrgPicker.dataOrgSelectedIndex = null;
    dataOrgPicker.dataOrgSelectionFailureMessage = '';
    dataOrgPicker.dataOrgReadinessByObject = Object.create(null);
    dataOrgPicker.dataOrgReadinessByTreeObjectKey = Object.create(null);
    dataOrgPicker.dataOrgTypeLabel = null;
    drawDataOrgViews();
    drawTreeInserts();

}

/*
    The dropdown STAYS until the CLI answers (#305), holding only the check's own option, so
    nothing can be selected from a list being replaced. ⟳ stays usable: the host joins a check
    already in flight rather than starting a second.
*/
export function showDataOrgConnectionCheck(): void {

    holdDataOrgPickerBeforeCheck();
    dataOrgPicker.isDataOrgSelectShown = false;
    dataOrgPicker.dataOrgHiddenNoteText = '';
    startDataOrgCheck();
    clearDataOrgSelection();
    setDataOrgStatus(RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT, false);

}

// A CHECK ALREADY SHOWING KEEPS THE PICKER FROM BEFORE IT, NOT ITS OWN SPINNER
function holdDataOrgPickerBeforeCheck(): void {

    if (dataOrgPicker.isDataOrgChecking && dataOrgPicker.dataOrgPickerBeforeCheck) { return; }

    dataOrgPicker.dataOrgPickerBeforeCheck = {
        labels: dataOrgPicker.dataOrgLabels,
        isLoadShown: dataOrgPicker.isDataOrgLoadShown,
        isSelectShown: dataOrgPicker.isDataOrgSelectShown,
        isRefreshShown: dataOrgPicker.isDataOrgRefreshShown,
        hiddenNoteText: dataOrgPicker.dataOrgHiddenNoteText,
        requestedSequence: dataOrgPicker.dataOrgRequestedSequence,
        requestSequence: dataOrgPicker.dataOrgRequestSequence,
        clearedRequestSequence: dataOrgPicker.dataOrgClearedRequestSequence,
        selectedIndex: dataOrgPicker.dataOrgSelectedIndex,
        selectionFailureMessage: dataOrgPicker.dataOrgSelectionFailureMessage,
        readinessByObject: dataOrgPicker.dataOrgReadinessByObject,
        readinessByTreeObjectKey: dataOrgPicker.dataOrgReadinessByTreeObjectKey,
        typeLabel: dataOrgPicker.dataOrgTypeLabel
    };

}

/*
    The host refused the listing because a run holds the selection (#537): nothing was cleared
    there, so the picker goes back to what it was and says which run holds it, rather than
    spinning until VS Code restarts. Only once every listing asked for is answered: an earlier
    ⟳ the host accepted has already dropped its list and selection, and its own answer is on
    its way, so the check stays on screen until it comes.
*/
export function renderDataOrgListingRefused(refusal: IDataOrgListingRefusedMessage): void {

    if (renderedSequence === null || refusal.renderSequence !== renderedSequence) { return; }
    if (typeof refusal.message !== 'string' || !refusal.message) { return; }

    dataOrgPicker.dataOrgUnansweredListingCount = Math.max(0, dataOrgPicker.dataOrgUnansweredListingCount - 1);
    if (dataOrgPicker.dataOrgUnansweredListingCount > 0) { return; }

    const pickerBeforeCheck = dataOrgPicker.dataOrgPickerBeforeCheck;
    dataOrgPicker.dataOrgPickerBeforeCheck = null;

    if (pickerBeforeCheck) {
        dataOrgPicker.isDataOrgChecking = false;
        dataOrgPicker.dataOrgCheckingOptionLabels = [];
        dataOrgPicker.dataOrgLabels = pickerBeforeCheck.labels;
        dataOrgPicker.isDataOrgLoadShown = pickerBeforeCheck.isLoadShown;
        dataOrgPicker.isDataOrgSelectShown = pickerBeforeCheck.isSelectShown;
        dataOrgPicker.isDataOrgRefreshShown = pickerBeforeCheck.isRefreshShown;
        dataOrgPicker.dataOrgHiddenNoteText = pickerBeforeCheck.hiddenNoteText;
        dataOrgPicker.dataOrgRequestedSequence = pickerBeforeCheck.requestedSequence;
        dataOrgPicker.dataOrgRequestSequence = pickerBeforeCheck.requestSequence;
        dataOrgPicker.dataOrgClearedRequestSequence = pickerBeforeCheck.clearedRequestSequence;
        dataOrgPicker.dataOrgSelectedIndex = pickerBeforeCheck.selectedIndex;
        dataOrgPicker.dataOrgSelectionFailureMessage = pickerBeforeCheck.selectionFailureMessage;
        dataOrgPicker.dataOrgReadinessByObject = pickerBeforeCheck.readinessByObject;
        dataOrgPicker.dataOrgReadinessByTreeObjectKey = pickerBeforeCheck.readinessByTreeObjectKey;
        dataOrgPicker.dataOrgTypeLabel = pickerBeforeCheck.typeLabel;
    }

    // A SELECTION THAT FAILED STILL SAYS WHY, BEFORE WHAT HELD THE LISTING
    if (dataOrgPicker.dataOrgSelectionFailureMessage) {
        setDataOrgStatus(dataOrgPicker.dataOrgSelectionFailureMessage + ' ' + refusal.message, true);
    } else {
        setDataOrgStatus(refusal.message, false);
    }
    drawTreeInserts();

}

function startDataOrgCheck(): void {

    dataOrgPicker.isDataOrgChecking = true;
    dataOrgPicker.isDataOrgRefreshShown = true;
    dataOrgPicker.dataOrgCheckingOptionLabels = [RECIPE_COCKPIT_ORG_LOADING_PLACEHOLDER];

}

// THE ORG CHOSEN LAST, ELSE THE CLI'S DEFAULT, SHOWN WHILE THE CHECK RUNS -- A LABEL ONLY, NEVER A SELECTION
export function renderDataOrgProvisional(dataOrgProvisional: IDataOrgProvisionalMessage): void {

    if (renderedSequence === null || dataOrgProvisional.renderSequence !== renderedSequence || !dataOrgPicker.isDataOrgChecking) { return; }
    if (typeof dataOrgProvisional.orgLabel !== 'string' || !dataOrgProvisional.orgLabel) { return; }
    if (dataOrgPicker.dataOrgProvisionalRequestSequence !== null && dataOrgProvisional.requestSequence < dataOrgPicker.dataOrgProvisionalRequestSequence) { return; }

    dataOrgPicker.dataOrgProvisionalRequestSequence = dataOrgProvisional.requestSequence;
    dataOrgPicker.dataOrgCheckingOptionLabels = [dataOrgProvisional.orgLabel];
    drawDataOrgViews();

}

export function renderDataOrgSelection(dataOrgSelection: IDataOrgSelectionMessage): void {

    if (renderedSequence === null || dataOrgSelection.renderSequence !== renderedSequence) { return; }
    if (dataOrgPicker.dataOrgRequestSequence !== null && dataOrgSelection.requestSequence < dataOrgPicker.dataOrgRequestSequence) { return; }
    if (dataOrgPicker.dataOrgClearedRequestSequence !== null && dataOrgSelection.requestSequence <= dataOrgPicker.dataOrgClearedRequestSequence) { return; }

    // A NEW SELECTION, OR A REFRESH OF THIS ONE, STARTS FROM NO READINESS
    if (dataOrgSelection.requestSequence !== dataOrgPicker.dataOrgRequestSequence) {
        dataOrgPicker.dataOrgRequestSequence = dataOrgSelection.requestSequence;
        dataOrgPicker.dataOrgReadinessByObject = Object.create(null);
        dataOrgPicker.dataOrgReadinessByTreeObjectKey = Object.create(null);
        dataOrgPicker.dataOrgSelectionFailureMessage = '';
        setDataOrgStatus('Checking ' + dataOrgSelection.orgLabel + '…', false);
    }

    // A FAILED CONNECTION, OR AN ORG THAT IS NOT A SANDBOX, IS THE WHOLE ANSWER ABOUT THIS SELECTION
    if (dataOrgSelection.failureMessage) {
        dataOrgPicker.dataOrgSelectionFailureMessage = dataOrgSelection.failureMessage;
        setDataOrgStatus(dataOrgSelection.failureMessage, true);
    }

    dataOrgPicker.dataOrgSelectedIndex = dataOrgSelection.orgIndex;
    dataOrgPicker.dataOrgTypeLabel = dataOrgSelection.orgTypeLabel || 'checking…';
    dataOrgPicker.isDataOrgRefreshShown = true;

    drawDataOrgViews();
    drawTreeInserts();

}
