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

/*
    Target Org Manager's org list and connection check (#255, #305, #537): what the host's listing,
    selection and readiness answers draw, each dropped unless it answers the model drawn and the
    newest request. The picker's state is the panel script's variables, since a new model empties
    them; these functions only set them.
*/
declare const vscodeApi: { postMessage(message: unknown): void };
declare const renderedSequence: number | null;
declare let dataOrgLabels: string[] | null;
declare let dataOrgCheckingOptionLabels: string[];
declare let dataOrgSelectedIndex: number | null;
declare let dataOrgTypeLabel: string | null;
declare let dataOrgStatusText: string;
declare let dataOrgHiddenNoteText: string;
declare let isDataOrgStatusFailure: boolean;
declare let isDataOrgLoadShown: boolean;
declare let isDataOrgSelectShown: boolean;
declare let isDataOrgRefreshShown: boolean;
declare let isDataOrgChecking: boolean;
declare let isDataOrgPickerInUse: boolean;
declare let dataOrgRequestedSequence: number | null;
declare let dataOrgRequestSequence: number | null;
declare let dataOrgClearedRequestSequence: number | null;
declare let dataOrgProvisionalRequestSequence: number | null;
declare let dataOrgSelectionFailureMessage: string;
declare let dataOrgReadinessByObject: Record<string, IDataOrgReadiness>;
declare let dataOrgReadinessByTreeObjectKey: Record<string, IDataOrgReadiness>;
declare let dataOrgPickerBeforeCheck: IDataOrgPickerBeforeCheck | null;
declare let dataOrgUnansweredListingCount: number;
declare let isScratchOrgRunning: boolean;
declare let isOrgAuthorizeRunning: boolean;
declare function buildTreeObjectKey(treeKey: string, objectApiName: string): string;
declare function savePanelPlace(): void;

export function renderScratchOrgState(hostMessage: IScratchOrgStateMessage): void {

    isScratchOrgRunning = !!hostMessage.isRunning;
    isOrgAuthorizeRunning = isScratchOrgRunning && hostMessage.isAuthorizing === true;

    drawDataOrgViews();
    drawTreeInserts();

}

export function renderDataOrgReadiness(dataOrgReadiness: IDataOrgReadinessMessage): void {

    if (renderedSequence === null || dataOrgReadiness.renderSequence !== renderedSequence || dataOrgReadiness.requestSequence !== dataOrgRequestSequence) { return; }

    dataOrgReadiness.objects.forEach(function (readiness) { dataOrgReadinessByObject[readiness.objectApiName] = readiness; });
    (dataOrgReadiness.createTargets || []).forEach(function (readiness) { dataOrgReadinessByTreeObjectKey[buildTreeObjectKey(readiness.treeKey, readiness.objectApiName)] = readiness; });

    // THE CHECK IS OVER; A FAILURE THE SELECTION REPORTED STAYS ON SCREEN
    if (!isDataOrgStatusFailure) { setDataOrgStatus('', false); }

    drawTreeInserts();

}

function setDataOrgStatus(statusText: string, isFailure: boolean): void {

    dataOrgStatusText = statusText;
    isDataOrgStatusFailure = !!isFailure;
    drawDataOrgViews();

}

// THE FIRST USE OF THE PICKER, OR THE FIRST OPEN OF ANY CARD'S TREECIPE TAB -- NEVER THE PANEL'S OWN OPEN
export function requestDataOrgs(): void {

    // A SCRATCH ORG RUN ENDS BY LISTING THE ORGS ITSELF
    if (renderedSequence === null || dataOrgRequestedSequence === renderedSequence || isScratchOrgRunning) { return; }

    // SAVED ONLY WHEN IT CHANGES: A NEW MODEL OF A PICKER ALREADY IN USE ASKS BEFORE ITS PLACE IS RESTORED, AND A SAVE THEN WOULD KEEP A HALF-RESTORED PLACE
    if (!isDataOrgPickerInUse) {
        isDataOrgPickerInUse = true;
        savePanelPlace();
    }
    holdDataOrgPickerBeforeCheck();
    dataOrgRequestedSequence = renderedSequence;
    isDataOrgLoadShown = false;
    isDataOrgSelectShown = false;
    startDataOrgCheck();
    setDataOrgStatus(RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT, false);
    drawTreeInserts();
    dataOrgUnansweredListingCount++;
    vscodeApi.postMessage({ command: 'loadDataOrgs' });

}

export function renderDataOrgList(dataOrgList: IDataOrgListMessage): void {

    if (renderedSequence === null || dataOrgList.renderSequence !== renderedSequence) { return; }

    dataOrgPickerBeforeCheck = null;
    dataOrgUnansweredListingCount = 0;
    isDataOrgLoadShown = false;
    isDataOrgChecking = false;
    // A LIST THE HOST POSTED AFTER ASKING FOR THE ORG (#375) MAKES THE PICKER IN USE, SO A LATER MODEL LISTS AGAIN
    isDataOrgPickerInUse = true;
    clearDataOrgSelection();
    // ⟳ IS HOW A READER WHO JUST RE-AUTHORIZED AN ORG SEES IT LISTED, SO IT STAYS EVEN WITH NOTHING LISTED
    isDataOrgRefreshShown = true;

    // PRODUCTION AND ORGS THE CLI DOES NOT REPORT CONNECTED ARE NEVER LISTED, AND THE READER IS TOLD WHY ONE THEY AUTHORIZED IS MISSING
    dataOrgHiddenNoteText = [dataOrgList.forgottenOrgNotice || '', dataOrgList.hiddenOrgNote || ''].filter(Boolean).join(' ');
    dataOrgLabels = Array.isArray(dataOrgList.orgLabels) ? dataOrgList.orgLabels.slice() : [];

    // THE DROPDOWN STAYS DRAWN WITH NOTHING TO CHOOSE, SO THE PICKER DOES NOT VANISH WHEN THE CHECK FOUND NO ORG (#305)
    isDataOrgSelectShown = true;

    if (dataOrgLabels.length === 0) {
        setDataOrgStatus(dataOrgList.noOrgsMessage, true);
        return;
    }

    dataOrgSelectedIndex = dataOrgList.selectedOrgIndex === null ? null : dataOrgList.selectedOrgIndex;
    isDataOrgSelectShown = true;
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
    if (dataOrgRequestSequence !== null) {
        dataOrgClearedRequestSequence = Math.max(dataOrgClearedRequestSequence === null ? 0 : dataOrgClearedRequestSequence, dataOrgRequestSequence);
    }
    dataOrgRequestSequence = null;
    dataOrgSelectedIndex = null;
    dataOrgSelectionFailureMessage = '';
    dataOrgReadinessByObject = Object.create(null);
    dataOrgReadinessByTreeObjectKey = Object.create(null);
    dataOrgTypeLabel = null;
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
    isDataOrgSelectShown = false;
    dataOrgHiddenNoteText = '';
    startDataOrgCheck();
    clearDataOrgSelection();
    setDataOrgStatus(RECIPE_COCKPIT_ORG_CONNECTION_CHECK_TEXT, false);

}

// A CHECK ALREADY SHOWING KEEPS THE PICKER FROM BEFORE IT, NOT ITS OWN SPINNER
function holdDataOrgPickerBeforeCheck(): void {

    if (isDataOrgChecking && dataOrgPickerBeforeCheck) { return; }

    dataOrgPickerBeforeCheck = {
        labels: dataOrgLabels,
        isLoadShown: isDataOrgLoadShown,
        isSelectShown: isDataOrgSelectShown,
        isRefreshShown: isDataOrgRefreshShown,
        hiddenNoteText: dataOrgHiddenNoteText,
        requestedSequence: dataOrgRequestedSequence,
        requestSequence: dataOrgRequestSequence,
        clearedRequestSequence: dataOrgClearedRequestSequence,
        selectedIndex: dataOrgSelectedIndex,
        selectionFailureMessage: dataOrgSelectionFailureMessage,
        readinessByObject: dataOrgReadinessByObject,
        readinessByTreeObjectKey: dataOrgReadinessByTreeObjectKey,
        typeLabel: dataOrgTypeLabel
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

    dataOrgUnansweredListingCount = Math.max(0, dataOrgUnansweredListingCount - 1);
    if (dataOrgUnansweredListingCount > 0) { return; }

    const pickerBeforeCheck = dataOrgPickerBeforeCheck;
    dataOrgPickerBeforeCheck = null;

    if (pickerBeforeCheck) {
        isDataOrgChecking = false;
        dataOrgCheckingOptionLabels = [];
        dataOrgLabels = pickerBeforeCheck.labels;
        isDataOrgLoadShown = pickerBeforeCheck.isLoadShown;
        isDataOrgSelectShown = pickerBeforeCheck.isSelectShown;
        isDataOrgRefreshShown = pickerBeforeCheck.isRefreshShown;
        dataOrgHiddenNoteText = pickerBeforeCheck.hiddenNoteText;
        dataOrgRequestedSequence = pickerBeforeCheck.requestedSequence;
        dataOrgRequestSequence = pickerBeforeCheck.requestSequence;
        dataOrgClearedRequestSequence = pickerBeforeCheck.clearedRequestSequence;
        dataOrgSelectedIndex = pickerBeforeCheck.selectedIndex;
        dataOrgSelectionFailureMessage = pickerBeforeCheck.selectionFailureMessage;
        dataOrgReadinessByObject = pickerBeforeCheck.readinessByObject;
        dataOrgReadinessByTreeObjectKey = pickerBeforeCheck.readinessByTreeObjectKey;
        dataOrgTypeLabel = pickerBeforeCheck.typeLabel;
    }

    // A SELECTION THAT FAILED STILL SAYS WHY, BEFORE WHAT HELD THE LISTING
    if (dataOrgSelectionFailureMessage) {
        setDataOrgStatus(dataOrgSelectionFailureMessage + ' ' + refusal.message, true);
    } else {
        setDataOrgStatus(refusal.message, false);
    }
    drawTreeInserts();

}

function startDataOrgCheck(): void {

    isDataOrgChecking = true;
    isDataOrgRefreshShown = true;
    dataOrgCheckingOptionLabels = [RECIPE_COCKPIT_ORG_LOADING_PLACEHOLDER];

}

// THE ORG CHOSEN LAST, ELSE THE CLI'S DEFAULT, SHOWN WHILE THE CHECK RUNS -- A LABEL ONLY, NEVER A SELECTION
export function renderDataOrgProvisional(dataOrgProvisional: IDataOrgProvisionalMessage): void {

    if (renderedSequence === null || dataOrgProvisional.renderSequence !== renderedSequence || !isDataOrgChecking) { return; }
    if (typeof dataOrgProvisional.orgLabel !== 'string' || !dataOrgProvisional.orgLabel) { return; }
    if (dataOrgProvisionalRequestSequence !== null && dataOrgProvisional.requestSequence < dataOrgProvisionalRequestSequence) { return; }

    dataOrgProvisionalRequestSequence = dataOrgProvisional.requestSequence;
    dataOrgCheckingOptionLabels = [dataOrgProvisional.orgLabel];
    drawDataOrgViews();

}

export function renderDataOrgSelection(dataOrgSelection: IDataOrgSelectionMessage): void {

    if (renderedSequence === null || dataOrgSelection.renderSequence !== renderedSequence) { return; }
    if (dataOrgRequestSequence !== null && dataOrgSelection.requestSequence < dataOrgRequestSequence) { return; }
    if (dataOrgClearedRequestSequence !== null && dataOrgSelection.requestSequence <= dataOrgClearedRequestSequence) { return; }

    // A NEW SELECTION, OR A REFRESH OF THIS ONE, STARTS FROM NO READINESS
    if (dataOrgSelection.requestSequence !== dataOrgRequestSequence) {
        dataOrgRequestSequence = dataOrgSelection.requestSequence;
        dataOrgReadinessByObject = Object.create(null);
        dataOrgReadinessByTreeObjectKey = Object.create(null);
        dataOrgSelectionFailureMessage = '';
        setDataOrgStatus('Checking ' + dataOrgSelection.orgLabel + '…', false);
    }

    // A FAILED CONNECTION, OR AN ORG THAT IS NOT A SANDBOX, IS THE WHOLE ANSWER ABOUT THIS SELECTION
    if (dataOrgSelection.failureMessage) {
        dataOrgSelectionFailureMessage = dataOrgSelection.failureMessage;
        setDataOrgStatus(dataOrgSelection.failureMessage, true);
    }

    dataOrgSelectedIndex = dataOrgSelection.orgIndex;
    dataOrgTypeLabel = dataOrgSelection.orgTypeLabel || 'checking…';
    isDataOrgRefreshShown = true;

    drawDataOrgViews();
    drawTreeInserts();

}
