import { createButton, createElement, setShown } from '../../../../CockpitKit/panel/CockpitPanelElements';
import { buildSearchableSelect } from '../../../../CockpitKit/panel/CockpitSearchableSelect';
import {
    RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL,
    RECIPE_COCKPIT_AUTHORIZE_ORG_RUNNING_LABEL,
    RECIPE_COCKPIT_AUTHORIZE_ORG_TOOLTIP,
    RECIPE_COCKPIT_NEW_SCRATCH_ORG_LABEL,
    RECIPE_COCKPIT_OPEN_ORG_LABEL,
    RECIPE_COCKPIT_ORG_CHOOSE_LABEL,
    RECIPE_COCKPIT_ORG_NONE_LISTED_PLACEHOLDER,
    RECIPE_COCKPIT_ORG_NO_MATCH_PREFIX,
    RECIPE_COCKPIT_ORG_NO_MATCH_SUFFIX,
    RECIPE_COCKPIT_ORG_PICKER_NAME,
    RECIPE_COCKPIT_ORG_SEARCH_PLACEHOLDER,
    RECIPE_COCKPIT_ORG_UNSELECTED_LABEL,
    RECIPE_COCKPIT_REFRESH_ORGS_LABEL
} from '../../../RecipeCockpitDataOrgConstants';
import { requestDataOrgs, showDataOrgConnectionCheck } from './DataOrgListing';
import { IDataOrgView } from './DataOrgTypes';
import { drawTreeInserts } from './TreeInsert';
import { renderedSequence } from '../../shell/PanelRender';
import { vscodeApi } from '../../RecipeCockpitPanelConnection';
import { runLocks } from '../../RecipeCockpitRunLocks';
import { dataOrgPicker } from './DataOrgPickerState';

/*
    Target Org Manager's views (#255, #617): the panel-wide org picker drawn at the top of every
    card's Treecipe tab. The run locks a click takes are runLocks', so
    drawTreeInserts and a reopened panel's replay see them.
*/

/*
    One view of the panel-wide org picker, at the top of a card's Treecipe tab (#255). The
    dropdown is the kit's searchable select (#678) of the "alias -- instance url" LABELS the host
    posted, and the panel posts back only the chosen option's index -- the host holds the usernames.
*/
// hasOrgAddingButtons: false LEAVES + New scratch org AND Authorize org OUT OF THE VIEW (#617); THEY ARE STILL BUILT, SO ONE DRAW SERVES EVERY VIEW
export function buildDataOrgView(hasOrgAddingButtons?: boolean): IDataOrgView {

    const viewElement = createElement('div', 'dataOrgView');
    const pickerElement = createElement('span', 'dataOrgControls');

    const dataOrgView: IDataOrgView = {
        element: viewElement,
        loadElement: createButton('primary', 'dataOrgLoad', 'Choose org…'),
        orgSelect: buildSearchableSelect({
            className: 'dataOrgSelect hidden',
            accessibleName: RECIPE_COCKPIT_ORG_PICKER_NAME,
            searchPlaceholder: RECIPE_COCKPIT_ORG_SEARCH_PLACEHOLDER,
            chooseLabel: RECIPE_COCKPIT_ORG_CHOOSE_LABEL,
            unselectedLabel: RECIPE_COCKPIT_ORG_UNSELECTED_LABEL,
            buildNoMatchText: function (searchText: string) { return RECIPE_COCKPIT_ORG_NO_MATCH_PREFIX + searchText + RECIPE_COCKPIT_ORG_NO_MATCH_SUFFIX; },
            // ONLY AN INDEX THE HOST LISTED: WHILE THE CHECK RUNS THE PICKER HOLDS NO LABEL TO CHOOSE
            onSelect: function (orgIndex: number) {
                if (dataOrgPicker.isDataOrgChecking) { return; }
                vscodeApi.postMessage({ command: 'selectDataOrg', orgIndex: orgIndex });
            }
        }),
        spinnerElement: createElement('span', 'dataOrgSpinner hidden'),
        typeElement: createElement('span', 'dataOrgType hidden'),
        openOrgElement: createButton('secondary', 'dataOrgOpen hidden', RECIPE_COCKPIT_OPEN_ORG_LABEL),
        refreshElement: createButton('secondary', 'dataOrgRefresh hidden'),
        newScratchElement: createButton('primary', 'dataOrgNewScratch', RECIPE_COCKPIT_NEW_SCRATCH_ORG_LABEL),
        authorizeElement: createButton('primary', 'dataOrgAuthorize', RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL),
        hiddenNoteElement: createElement('div', 'dataOrgHiddenNote muted hidden'),
        statusElement: createElement('div', 'dataOrgStatus muted hidden'),
        drawnLabels: null,
        drawnSelectedIndex: null
    };

    dataOrgView.loadElement.setAttribute('title', 'List the connected sandbox and scratch orgs the generated data can go to');
    dataOrgView.loadElement.addEventListener('click', function () { requestDataOrgs(); });

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
        dataOrgPicker.dataOrgUnansweredListingCount++;
        vscodeApi.postMessage({ command: 'refreshDataOrgs' });
    });

    // THE SELECTION'S INDEX ONLY: THE HOST OPENS THE ORG IT HAS SELECTED, AND NOTHING COMES BACK BUT "DONE"
    dataOrgView.openOrgElement.setAttribute('title', 'Log in to the selected org in your browser');
    dataOrgView.openOrgElement.addEventListener('click', function () {
        if (runLocks.isOrgOpenRunning || runLocks.isScratchOrgRunning || runLocks.isPermissionSetAssignRunning || runLocks.isMetadataDeployRunning || dataOrgPicker.dataOrgSelectedIndex === null) { return; }
        runLocks.isOrgOpenRunning = true;
        drawDataOrgViews();
        vscodeApi.postMessage({ command: 'openDataOrg', orgIndex: dataOrgPicker.dataOrgSelectedIndex });
    });

    // THE MESSAGE CARRIES NOTHING: THE DEV HUB, THE DEFINITION FILE AND THE ALIAS ARE ALL THE HOST'S, AND NOTHING IS DEPLOYED (#358)
    dataOrgView.newScratchElement.setAttribute('title', 'Choose a Dev Hub, name the new scratch org, create it through the Dev Hub and select it. Nothing is deployed to it.');
    dataOrgView.newScratchElement.addEventListener('click', function () {
        if (runLocks.isScratchOrgRunning || runLocks.isPermissionSetAssignRunning || runLocks.isMetadataDeployRunning || runLocks.insertRunningTreeKey !== null || renderedSequence === null) { return; }
        dataOrgPicker.isDataOrgPickerInUse = true;
        runLocks.isScratchOrgRunning = true;
        drawDataOrgViews();
        drawTreeInserts();
        vscodeApi.postMessage({ command: 'createScratchOrg' });
    });

    // THE MESSAGE CARRIES NOTHING (#630): THE LOGIN ADDRESS AND THE ALIAS ARE ASKED BY THE HOST
    dataOrgView.authorizeElement.setAttribute('title', RECIPE_COCKPIT_AUTHORIZE_ORG_TOOLTIP);
    dataOrgView.authorizeElement.addEventListener('click', function () {
        if (runLocks.isScratchOrgRunning || runLocks.isPermissionSetAssignRunning || runLocks.isMetadataDeployRunning || runLocks.insertRunningTreeKey !== null || renderedSequence === null) { return; }
        dataOrgPicker.isDataOrgPickerInUse = true;
        runLocks.isScratchOrgRunning = true;
        runLocks.isOrgAuthorizeRunning = true;
        drawDataOrgViews();
        drawTreeInserts();
        vscodeApi.postMessage({ command: 'authorizeOrg' });
    });

    pickerElement.appendChild(dataOrgView.loadElement);
    pickerElement.appendChild(dataOrgView.orgSelect.element);
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

    dataOrgPicker.dataOrgViews.push(dataOrgView);
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

    const optionLabels = dataOrgPicker.isDataOrgChecking ? dataOrgPicker.dataOrgCheckingOptionLabels : dataOrgPicker.dataOrgPickerLabels;
    const selectedIndex = dataOrgPicker.isDataOrgChecking ? null : dataOrgPicker.dataOrgSelectedIndex;

    if (dataOrgView.drawnLabels !== optionLabels || dataOrgView.drawnSelectedIndex !== selectedIndex) {
        if (dataOrgPicker.isDataOrgChecking) {
            dataOrgView.orgSelect.drawPlaceholder(dataOrgPicker.dataOrgCheckingOptionLabels[0]);
        } else if (dataOrgPicker.dataOrgPickerLabels && dataOrgPicker.dataOrgPickerLabels.length > 0) {
            dataOrgView.orgSelect.drawOptions(dataOrgPicker.dataOrgPickerLabels, selectedIndex);
        } else {
            dataOrgView.orgSelect.drawPlaceholder(RECIPE_COCKPIT_ORG_NONE_LISTED_PLACEHOLDER);
        }
        dataOrgView.drawnLabels = optionLabels;
        dataOrgView.drawnSelectedIndex = selectedIndex;
    }

    setShown(dataOrgView.loadElement, dataOrgPicker.isDataOrgLoadShown);
    setShown(dataOrgView.orgSelect.element, dataOrgPicker.isDataOrgSelectShown || dataOrgPicker.isDataOrgChecking);
    setShown(dataOrgView.spinnerElement, dataOrgPicker.isDataOrgChecking);
    setShown(dataOrgView.refreshElement, dataOrgPicker.isDataOrgRefreshShown);
    dataOrgView.typeElement.textContent = dataOrgPicker.dataOrgTypeLabel || '';
    setShown(dataOrgView.typeElement, dataOrgPicker.dataOrgTypeLabel !== null);

    dataOrgView.hiddenNoteElement.textContent = dataOrgPicker.dataOrgHiddenNoteText;
    setShown(dataOrgView.hiddenNoteElement, !!dataOrgPicker.dataOrgHiddenNoteText);

    dataOrgView.statusElement.textContent = dataOrgPicker.dataOrgStatusText;
    setShown(dataOrgView.statusElement, !!dataOrgPicker.dataOrgStatusText);
    if (dataOrgPicker.isDataOrgStatusFailure) { dataOrgView.statusElement.classList.add('failed'); } else { dataOrgView.statusElement.classList.remove('failed'); }

    // AN INSERT IN FLIGHT HOLDS IT TOO: THE HOST WOULD REFUSE A RUN THAT CHANGES THE SELECTION UNDER IT
    // SO DOES A METADATA DEPLOY (#346), TO THE ORG SELECTED; A RETRIEVE DOES NOT, SINCE THE RUN DEPLOYS NOTHING (#358)
    dataOrgView.newScratchElement.disabled = runLocks.isScratchOrgRunning || runLocks.isPermissionSetAssignRunning || runLocks.isMetadataDeployRunning || runLocks.insertRunningTreeKey !== null;
    dataOrgView.newScratchElement.textContent = runLocks.isScratchOrgRunning && !runLocks.isOrgAuthorizeRunning ? 'Setting up scratch org…' : RECIPE_COCKPIT_NEW_SCRATCH_ORG_LABEL;
    dataOrgView.authorizeElement.disabled = dataOrgView.newScratchElement.disabled;
    dataOrgView.authorizeElement.textContent = runLocks.isOrgAuthorizeRunning ? RECIPE_COCKPIT_AUTHORIZE_ORG_RUNNING_LABEL : RECIPE_COCKPIT_AUTHORIZE_ORG_LABEL;
    // A PERMISSION SET ASSIGNMENT HOLDS THE PICKER TOO: IT ASSIGNS IN THE ORG SELECTED, AND CHECKS IT AGAIN WHEN IT ENDS
    // AND A METADATA DEPLOY (#346): IT DEPLOYS TO THE ORG SELECTED, AND CHECKS IT AGAIN WHEN IT ENDS
    dataOrgView.orgSelect.setDisabled(runLocks.isScratchOrgRunning || runLocks.isPermissionSetAssignRunning || runLocks.isMetadataDeployRunning);
    dataOrgView.loadElement.disabled = runLocks.isScratchOrgRunning || runLocks.isPermissionSetAssignRunning || runLocks.isMetadataDeployRunning;
    dataOrgView.refreshElement.disabled = runLocks.isScratchOrgRunning || runLocks.isPermissionSetAssignRunning || runLocks.isMetadataDeployRunning;

    setShown(dataOrgView.openOrgElement, dataOrgPicker.isDataOrgSelectShown && dataOrgPicker.dataOrgSelectedIndex !== null);
    dataOrgView.openOrgElement.disabled = runLocks.isOrgOpenRunning || runLocks.isScratchOrgRunning || runLocks.isPermissionSetAssignRunning || runLocks.isMetadataDeployRunning;
    dataOrgView.openOrgElement.textContent = runLocks.isOrgOpenRunning ? 'Opening…' : RECIPE_COCKPIT_OPEN_ORG_LABEL;

}

export function drawDataOrgViews(): void {
    dataOrgPicker.dataOrgViews.forEach(drawDataOrgView);
}
