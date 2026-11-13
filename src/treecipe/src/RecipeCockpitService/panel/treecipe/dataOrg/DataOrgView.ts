import { createButton, createElement, setShown } from '../../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL,
    RECIPE_COCKPIT_AUTHORIZE_ORG_RUNNING_LABEL,
    RECIPE_COCKPIT_AUTHORIZE_ORG_TOOLTIP,
    RECIPE_COCKPIT_NEW_SCRATCH_ORG_LABEL,
    RECIPE_COCKPIT_OPEN_ORG_LABEL,
    RECIPE_COCKPIT_ORG_NONE_LISTED_PLACEHOLDER,
    RECIPE_COCKPIT_REFRESH_ORGS_LABEL
} from '../../../RecipeCockpitDataOrgConstants';
import { requestDataOrgs, showDataOrgConnectionCheck } from './DataOrgListing';
import { IDataOrgView } from './DataOrgTypes';
import { drawTreeInserts } from './TreeInsert';

/*
    Target Org Manager's views (#255, #617): the panel-wide org picker drawn at the top of every
    card's Treecipe tab. These names are the panel script's own, read when a function runs; the run
    locks a click takes are its variables, so drawTreeInserts and a reopened panel's replay see them.
*/
declare const vscodeApi: { postMessage(message: unknown): void };
declare const renderedSequence: number | null;
declare const dataOrgViews: IDataOrgView[];
declare const dataOrgLabels: string[] | null;
declare const dataOrgCheckingOptionLabels: string[];
declare const dataOrgSelectedIndex: number | null;
declare const dataOrgTypeLabel: string | null;
declare const dataOrgStatusText: string;
declare const dataOrgHiddenNoteText: string;
declare const isDataOrgStatusFailure: boolean;
declare const isDataOrgLoadShown: boolean;
declare const isDataOrgSelectShown: boolean;
declare const isDataOrgRefreshShown: boolean;
declare const isDataOrgChecking: boolean;
declare const isPermissionSetAssignRunning: boolean;
declare const isMetadataDeployRunning: boolean;
declare const insertRunningTreeKey: string | null;
declare let dataOrgUnansweredListingCount: number;
declare let isDataOrgPickerInUse: boolean;
declare let isScratchOrgRunning: boolean;
declare let isOrgAuthorizeRunning: boolean;
declare let isOrgOpenRunning: boolean;

/*
    One view of the panel-wide org picker, at the top of a card's Treecipe tab (#255). The
    dropdown is a native select of the LABELS the host posted, and the panel posts back only the
    chosen option's index -- the host holds the usernames.
*/
// hasOrgAddingButtons: false LEAVES + New scratch org AND Authorize org OUT OF THE VIEW (#617); THEY ARE STILL BUILT, SO ONE DRAW SERVES EVERY VIEW
export function buildDataOrgView(hasOrgAddingButtons?: boolean): IDataOrgView {

    const viewElement = createElement('div', 'dataOrgView');
    const pickerElement = createElement('span', 'dataOrgControls');

    const dataOrgView: IDataOrgView = {
        element: viewElement,
        loadElement: createButton('primary', 'dataOrgLoad', 'Choose org…'),
        selectElement: createElement('select', 'dataOrgSelect hidden'),
        spinnerElement: createElement('span', 'dataOrgSpinner hidden'),
        typeElement: createElement('span', 'dataOrgType hidden'),
        openOrgElement: createButton('secondary', 'dataOrgOpen hidden', RECIPE_COCKPIT_OPEN_ORG_LABEL),
        refreshElement: createButton('secondary', 'dataOrgRefresh hidden'),
        newScratchElement: createButton('primary', 'dataOrgNewScratch', RECIPE_COCKPIT_NEW_SCRATCH_ORG_LABEL),
        authorizeElement: createButton('primary', 'dataOrgAuthorize', RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL),
        hiddenNoteElement: createElement('div', 'dataOrgHiddenNote muted hidden'),
        statusElement: createElement('div', 'dataOrgStatus muted hidden'),
        drawnLabels: null
    };

    dataOrgView.loadElement.setAttribute('title', 'List the connected sandbox and scratch orgs the generated data can go to');
    dataOrgView.loadElement.addEventListener('click', function () { requestDataOrgs(); });

    dataOrgView.selectElement.setAttribute('aria-label', 'Salesforce org the generated data goes to');
    dataOrgView.selectElement.addEventListener('change', function () {
        const selectedValue = String(dataOrgView.selectElement.value || '');
        // ONLY AN INDEX THE HOST LISTED: THE CHECK'S OWN OPTION, AND EVERY PLACEHOLDER, CARRY NONE
        if (isDataOrgChecking || !/^[0-9]+$/.test(selectedValue)) { return; }
        vscodeApi.postMessage({ command: 'selectDataOrg', orgIndex: Number(selectedValue) });
    });

    dataOrgView.spinnerElement.setAttribute('aria-hidden', 'true');

    // THE ⟳ GLYPH DRAWS SMALLER THAN THE TEXT AROUND IT, SO IT IS SIZED ON ITS OWN AND THE BUTTON SAYS WHAT IT DOES
    const refreshIconElement = createElement('span', 'dataOrgRefreshIcon', '⟳');
    refreshIconElement.setAttribute('aria-hidden', 'true');
    dataOrgView.refreshElement.appendChild(refreshIconElement);
    dataOrgView.refreshElement.appendChild(createElement('span', 'dataOrgRefreshLabel', RECIPE_COCKPIT_REFRESH_ORGS_LABEL));
    dataOrgView.refreshElement.setAttribute('title', 'Check the org connections again');
    // THE ACCESSIBLE NAME STARTS WITH THE VISIBLE LABEL, SO "CLICK REFRESH ORGS" BY VOICE FINDS IT (WCAG 2.5.3)
    dataOrgView.refreshElement.setAttribute('aria-label', RECIPE_COCKPIT_REFRESH_ORGS_LABEL + ': check the org connections again');
    dataOrgView.refreshElement.addEventListener('click', function () {
        showDataOrgConnectionCheck();
        dataOrgUnansweredListingCount++;
        vscodeApi.postMessage({ command: 'refreshDataOrgs' });
    });

    // THE SELECTION'S INDEX ONLY: THE HOST OPENS THE ORG IT HAS SELECTED, AND NOTHING COMES BACK BUT "DONE"
    dataOrgView.openOrgElement.setAttribute('title', 'Log in to the selected org in your browser');
    dataOrgView.openOrgElement.addEventListener('click', function () {
        if (isOrgOpenRunning || isScratchOrgRunning || isPermissionSetAssignRunning || isMetadataDeployRunning || dataOrgSelectedIndex === null) { return; }
        isOrgOpenRunning = true;
        drawDataOrgViews();
        vscodeApi.postMessage({ command: 'openDataOrg', orgIndex: dataOrgSelectedIndex });
    });

    // THE MESSAGE CARRIES NOTHING: THE DEV HUB, THE DEFINITION FILE AND THE ALIAS ARE ALL THE HOST'S, AND NOTHING IS DEPLOYED (#358)
    dataOrgView.newScratchElement.setAttribute('title', 'Choose a Dev Hub, name the new scratch org, create it through the Dev Hub and select it. Nothing is deployed to it.');
    dataOrgView.newScratchElement.addEventListener('click', function () {
        if (isScratchOrgRunning || isPermissionSetAssignRunning || isMetadataDeployRunning || insertRunningTreeKey !== null || renderedSequence === null) { return; }
        isDataOrgPickerInUse = true;
        isScratchOrgRunning = true;
        drawDataOrgViews();
        drawTreeInserts();
        vscodeApi.postMessage({ command: 'createScratchOrg' });
    });

    // THE MESSAGE CARRIES NOTHING (#630): THE LOGIN ADDRESS AND THE ALIAS ARE ASKED BY THE HOST
    dataOrgView.authorizeElement.setAttribute('title', RECIPE_COCKPIT_AUTHORIZE_ORG_TOOLTIP);
    dataOrgView.authorizeElement.addEventListener('click', function () {
        if (isScratchOrgRunning || isPermissionSetAssignRunning || isMetadataDeployRunning || insertRunningTreeKey !== null || renderedSequence === null) { return; }
        isDataOrgPickerInUse = true;
        isScratchOrgRunning = true;
        isOrgAuthorizeRunning = true;
        drawDataOrgViews();
        drawTreeInserts();
        vscodeApi.postMessage({ command: 'authorizeOrg' });
    });

    pickerElement.appendChild(dataOrgView.loadElement);
    pickerElement.appendChild(dataOrgView.selectElement);
    pickerElement.appendChild(dataOrgView.spinnerElement);
    pickerElement.appendChild(dataOrgView.typeElement);
    pickerElement.appendChild(dataOrgView.openOrgElement);
    pickerElement.appendChild(dataOrgView.refreshElement);
    if (hasOrgAddingButtons !== false) {
        pickerElement.appendChild(dataOrgView.newScratchElement);
        pickerElement.appendChild(dataOrgView.authorizeElement);
    }
    viewElement.appendChild(pickerElement);
    viewElement.appendChild(dataOrgView.hiddenNoteElement);
    viewElement.appendChild(dataOrgView.statusElement);

    dataOrgViews.push(dataOrgView);
    drawDataOrgView(dataOrgView);

    return dataOrgView;

}

/*
    The picker state drawn into one view. While a scratch org run is in flight the picker is
    held: the button, the dropdown, ⟳ and "Choose org…" are disabled, whatever a listing posted
    meanwhile draws -- the run ends by selecting the org it made. Every text is the host's,
    through textContent.
*/
function drawDataOrgView(dataOrgView: IDataOrgView): void {

    const optionLabels = isDataOrgChecking ? dataOrgCheckingOptionLabels : dataOrgLabels;

    if (dataOrgView.drawnLabels !== optionLabels) {
        dataOrgView.selectElement.textContent = '';
        if (isDataOrgChecking || (dataOrgLabels && dataOrgLabels.length === 0)) {
            const onlyOptionElement = createElement('option', '', isDataOrgChecking ? dataOrgCheckingOptionLabels[0] : RECIPE_COCKPIT_ORG_NONE_LISTED_PLACEHOLDER);
            onlyOptionElement.value = '';
            dataOrgView.selectElement.appendChild(onlyOptionElement);
        } else if (dataOrgLabels && dataOrgLabels.length > 0) {
            const placeholderElement = createElement('option', '', 'Choose org…');
            placeholderElement.value = '';
            dataOrgView.selectElement.appendChild(placeholderElement);
            dataOrgLabels.forEach(function (orgLabel, orgIndex) {
                const optionElement = createElement('option', '', orgLabel);
                optionElement.value = String(orgIndex);
                dataOrgView.selectElement.appendChild(optionElement);
            });
        }
        dataOrgView.drawnLabels = optionLabels;
    }

    dataOrgView.selectElement.value = isDataOrgChecking || dataOrgSelectedIndex === null ? '' : String(dataOrgSelectedIndex);
    setShown(dataOrgView.loadElement, isDataOrgLoadShown);
    setShown(dataOrgView.selectElement, isDataOrgSelectShown || isDataOrgChecking);
    setShown(dataOrgView.spinnerElement, isDataOrgChecking);
    setShown(dataOrgView.refreshElement, isDataOrgRefreshShown);
    dataOrgView.typeElement.textContent = dataOrgTypeLabel || '';
    setShown(dataOrgView.typeElement, dataOrgTypeLabel !== null);

    dataOrgView.hiddenNoteElement.textContent = dataOrgHiddenNoteText;
    setShown(dataOrgView.hiddenNoteElement, !!dataOrgHiddenNoteText);

    dataOrgView.statusElement.textContent = dataOrgStatusText;
    setShown(dataOrgView.statusElement, !!dataOrgStatusText);
    if (isDataOrgStatusFailure) { dataOrgView.statusElement.classList.add('failed'); } else { dataOrgView.statusElement.classList.remove('failed'); }

    // AN INSERT IN FLIGHT HOLDS IT TOO: THE HOST WOULD REFUSE A RUN THAT CHANGES THE SELECTION UNDER IT
    // SO DOES A METADATA DEPLOY (#346), TO THE ORG SELECTED; A RETRIEVE DOES NOT, SINCE THE RUN DEPLOYS NOTHING (#358)
    dataOrgView.newScratchElement.disabled = isScratchOrgRunning || isPermissionSetAssignRunning || isMetadataDeployRunning || insertRunningTreeKey !== null;
    dataOrgView.newScratchElement.textContent = isScratchOrgRunning && !isOrgAuthorizeRunning ? 'Setting up scratch org…' : RECIPE_COCKPIT_NEW_SCRATCH_ORG_LABEL;
    dataOrgView.authorizeElement.disabled = dataOrgView.newScratchElement.disabled;
    dataOrgView.authorizeElement.textContent = isOrgAuthorizeRunning ? RECIPE_COCKPIT_AUTHORIZE_ORG_RUNNING_LABEL : RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL;
    // A PERMISSION SET ASSIGNMENT HOLDS THE PICKER TOO: IT ASSIGNS IN THE ORG SELECTED, AND CHECKS IT AGAIN WHEN IT ENDS
    // AND A METADATA DEPLOY (#346): IT DEPLOYS TO THE ORG SELECTED, AND CHECKS IT AGAIN WHEN IT ENDS
    dataOrgView.selectElement.disabled = isScratchOrgRunning || isPermissionSetAssignRunning || isMetadataDeployRunning;
    dataOrgView.loadElement.disabled = isScratchOrgRunning || isPermissionSetAssignRunning || isMetadataDeployRunning;
    dataOrgView.refreshElement.disabled = isScratchOrgRunning || isPermissionSetAssignRunning || isMetadataDeployRunning;

    setShown(dataOrgView.openOrgElement, isDataOrgSelectShown && dataOrgSelectedIndex !== null);
    dataOrgView.openOrgElement.disabled = isOrgOpenRunning || isScratchOrgRunning || isPermissionSetAssignRunning || isMetadataDeployRunning;
    dataOrgView.openOrgElement.textContent = isOrgOpenRunning ? 'Opening…' : RECIPE_COCKPIT_OPEN_ORG_LABEL;

}

export function drawDataOrgViews(): void {
    dataOrgViews.forEach(drawDataOrgView);
}
