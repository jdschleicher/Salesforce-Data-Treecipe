import { connectConfirmDialog, renderConfirmRequest } from '../../CockpitKit/panel/CockpitConfirmDialogPanel';
import { RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH, RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX } from '../RecipeCockpitPanelConstants';
import { clearAdapterChildPreviews, clearAdapterChildren, renderAdapterChildBlock, renderAdapterChildPreview } from './adapter/AdapterChild';
import { clearUpdaterRecords, clearUpdaterValues, drawUpdaterLoadButtons, renderUpdaterParentChange, renderUpdaterRecords, renderUpdaterRecordsPage, renderUpdaterSnapshots, renderUpdaterValues } from './adapter/AdapterLoadAndUpdate';
import { renderAdapterMetadataChanges } from './adapter/AdapterRetrieve';
import { renderDatasetJourney } from './datasets/DatasetJourney';
import { renderDatasetRecordCounts } from './datasets/DatasetRow';
import { renderDatasetAdded, renderDatasetLastInsert, renderDatasetPreferences } from './datasets/DatasetsTab';
import { drawTreeQueryButtons, renderTreeQueries, renderTreeQueryResult } from './query/QueryTab';
import { cockpitBodyElement, cockpitDialogHostElement, cockpitMetaElement, connectPanel, loadStatusElement, vscodeApi } from './RecipeCockpitPanelConnection';
import { acknowledgeRecordLinks } from './RecipeCockpitRecordTable';
import { runLocks } from './RecipeCockpitRunLocks';
import { setLoadStatus } from './RecipeCockpitPanelShared';
import { renderCockpitMeta, renderExtensionInfo } from './shell/CockpitMeta';
import { readRestorablePlace, saveScrolledPlace } from './shell/PanelPlace';
import { postRenderFailure, renderedSequence, renderPanelGuarded, restoreRunSelection } from './shell/PanelRender';
import { renderPermissionSetAssignState } from './troubleshooting/TroubleshootingActions';
import { renderTroubleshootingHistory } from './troubleshooting/TroubleshootingHistory';
import { renderTroubleshootingSummary } from './troubleshooting/TroubleshootingTab';
import { renderTreeValidationRules } from './troubleshooting/TroubleshootingValidationRules';
import { renderNameEditResult } from './treecipe/card/NameEditor';
import { renderTreePreferences } from './treecipe/card/TreeCard';
import { renderDataOrgList, renderDataOrgListingRefused, renderDataOrgProvisional, renderDataOrgReadiness, renderDataOrgSelection, renderScratchOrgState } from './treecipe/dataOrg/DataOrgListing';
import { drawDataOrgViews } from './treecipe/dataOrg/DataOrgView';
import { drawTreeInserts, setInsertRunning } from './treecipe/dataOrg/TreeInsert';
import { renderFieldEditResult } from './treecipe/fieldEditor/FieldEditor';
import { setAddFriendRunning, setWireLookupRunning } from './treecipe/fieldEditor/LookupWiring';
import { renderPicklistValues } from './treecipe/fieldEditor/PicklistTiles';
import { renderObjectSelection } from './treecipe/fieldRows/FieldRow';
import { renderFakerValueExample } from './treecipe/fieldRows/FieldRowFakerValueTest';
import { renderCustomTreecipePreview } from './treecipe/customTreecipe/CustomTreecipeDialog';
import { navigationState } from './treecipe/navigation/NavigationState';
import { closeNicknameMenu, isElementWithin } from './treecipe/navigation/Nicknames';
import { focusTreeInPlace } from './treecipe/navigation/StructureFilter';
import { drawTreePickerObjectsToggle } from './treecipe/navigation/TreePicker';
import { renderObjectRefreshState } from './treecipe/objectRefresh/ObjectRefreshDialog';

/*
    The Recipe Cockpit's webview starts here (#657): the shell's script is the bundle and one call
    to this. It connects the panel to the host, reads the reader's saved place, draws the header,
    listens, and tells the host it is ready. Every message the host posts is routed below, by its
    command, to the module that draws it; a message for a model not on screen is each module's to
    refuse.
*/
export function startRecipeCockpitPanel(): void {

    connectPanel();
    connectConfirmDialog({
        postMessage: function (message) { vscodeApi.postMessage(message); },
        readRenderedSequence: function () { return renderedSequence; },
        dialogHostElement: cockpitDialogHostElement,
        backgroundElements: [cockpitBodyElement, cockpitMetaElement, loadStatusElement],
        toggleGlyphViewBox: RECIPE_COCKPIT_TREE_GLYPH_VIEW_BOX,
        toggleCollapsedGlyphPath: RECIPE_COCKPIT_TOGGLE_COLLAPSED_GLYPH_PATH
    });
    readRestorablePlace();

    renderCockpitMeta();

    window.addEventListener('message', function (hostMessageEvent) {
        const hostMessage = hostMessageEvent && hostMessageEvent.data;
        if (!hostMessage) { return; }
        routeHostMessage(hostMessage);
    });

    // A THROW OUTSIDE THE RENDER -- A LAZY EXPAND, A KEYSTROKE -- WOULD OTHERWISE BE SILENT
    window.addEventListener('error', function (errorEvent) {

        const thrownError = errorEvent && errorEvent.error;

        postRenderFailure('runtime', {
            message: (errorEvent && errorEvent.message) || (thrownError && thrownError.message),
            type: errorEvent && errorEvent.type,
            stack: thrownError && thrownError.stack
        });

    });

    window.addEventListener('unhandledrejection', function (rejectionEvent) {
        postRenderFailure('runtime', rejectionEvent && rejectionEvent.reason);
    });

    // A CLICK ANYWHERE BUT THE OPEN REFERENCES LIST OR ITS BUTTON CLOSES IT; CAPTURED, SO A LISTENER THAT STOPS THE CLICK CANNOT KEEP IT OPEN
    document.addEventListener('click', function (clickEvent) {
        const openNicknameMenu = navigationState.openNicknameMenu;
        if (!openNicknameMenu) { return; }
        const clickedNode = clickEvent.target as Node | null;
        if (isElementWithin(clickedNode, openNicknameMenu.menuElement) || isElementWithin(clickedNode, openNicknameMenu.openerOf() as Node)) { return; }
        closeNicknameMenu(false);
    }, true);

    // A NARROWER OR WIDER PANEL CAN CUT THE INSERT ORDER LINE, OR STOP CUTTING IT (#464); AN OBSERVER, WHERE THERE IS ONE, ALREADY HEARS IT
    if (typeof window.ResizeObserver !== 'function') { window.addEventListener('resize', drawTreePickerObjectsToggle); }

    window.addEventListener('scroll', saveScrolledPlace);

    /*
        Posted on every load of this document, not only the first. A reveal after the panel was
        hidden reloads it from scratch, and the host answers with whatever it currently holds.
    */
    vscodeApi.postMessage({ command: 'ready' });

}

// ANY SHAPE A HOST MESSAGE HAS: EACH ROUTE'S MODULE CHECKS THE FIELDS IT READS
function routeHostMessage(hostMessage: any): void {

    if (hostMessage.command === 'extensionInfo') {
        renderExtensionInfo(hostMessage);
        return;
    }

    if (hostMessage.command === 'confirmRequest') {
        renderConfirmRequest(hostMessage);
        return;
    }

    if (hostMessage.command === 'objectRefreshState') {
        renderObjectRefreshState(hostMessage);
        return;
    }

    if (hostMessage.command === 'customTreecipePreview') {
        renderCustomTreecipePreview(hostMessage);
        return;
    }

    if (hostMessage.command === 'loadPhase') {
        setLoadStatus(hostMessage.message, false);
        return;
    }

    if (hostMessage.command === 'recipeData') {

        // THE STATUS LINE IS LEFT ALONE WHEN THE RENDER FAILED -- CLEARING IT WOULD READ AS FINISHED
        if (renderPanelGuarded(hostMessage.recipe, hostMessage.renderSequence, hostMessage.focusTree, hostMessage.restorePlace)) {
            setLoadStatus('', false);
        }

        return;

    }

    if (hostMessage.command === 'picklistValues') {
        renderPicklistValues(hostMessage);
        return;
    }

    if (hostMessage.command === 'fakerValueExample') {
        renderFakerValueExample(hostMessage);
        return;
    }

    if (hostMessage.command === 'datasetRecordCounts') {
        renderDatasetRecordCounts(hostMessage);
        return;
    }

    if (hostMessage.command === 'dataOrgList') {
        renderDataOrgList(hostMessage);
        return;
    }

    if (hostMessage.command === 'dataOrgListingRefused') {
        renderDataOrgListingRefused(hostMessage);
        return;
    }

    if (hostMessage.command === 'dataOrgProvisional') {
        renderDataOrgProvisional(hostMessage);
        return;
    }

    if (hostMessage.command === 'dataOrgSelection') {
        renderDataOrgSelection(hostMessage);
        return;
    }

    if (hostMessage.command === 'dataOrgReadiness') {
        renderDataOrgReadiness(hostMessage);
        return;
    }

    if (hostMessage.command === 'insertState') {
        setInsertRunning(hostMessage.isRunning ? hostMessage.treeKey : null, hostMessage.datasetFolderName);
        return;
    }

    if (hostMessage.command === 'addFriendState') {
        setAddFriendRunning(!!hostMessage.isRunning);
        return;
    }

    if (hostMessage.command === 'wireLookupState') {
        setWireLookupRunning(!!hostMessage.isRunning);
        return;
    }

    if (hostMessage.command === 'treePreferences') {
        renderTreePreferences(hostMessage);
        return;
    }

    if (hostMessage.command === 'datasetPreferences') {
        renderDatasetPreferences(hostMessage);
        return;
    }

    if (hostMessage.command === 'nameEditResult') {
        renderNameEditResult(hostMessage);
        return;
    }

    if (hostMessage.command === 'datasetLastInsert') {
        renderDatasetLastInsert(hostMessage);
        return;
    }

    if (hostMessage.command === 'objectSelection') {
        renderObjectSelection(hostMessage);
        return;
    }

    if (hostMessage.command === 'fieldEditResult') {
        renderFieldEditResult(hostMessage);
        return;
    }

    if (hostMessage.command === 'scratchOrgState') {
        renderScratchOrgState(hostMessage);
        return;
    }

    if (hostMessage.command === 'permissionSetAssignState') {
        renderPermissionSetAssignState(hostMessage);
        return;
    }

    if (hostMessage.command === 'metadataDeployState') {
        runLocks.isMetadataDeployRunning = !!hostMessage.isRunning;
        runLocks.metadataDeployRunningKey = runLocks.isMetadataDeployRunning ? hostMessage.treeKey + '\n' + hostMessage.deployKind : null;
        drawTreeInserts();
        drawDataOrgViews();
        return;
    }

    if (hostMessage.command === 'troubleshootingSummary') {
        renderTroubleshootingSummary(hostMessage);
        return;
    }

    if (hostMessage.command === 'treeQueries') {
        renderTreeQueries(hostMessage);
        return;
    }

    if (hostMessage.command === 'treeValidationRules') {
        renderTreeValidationRules(hostMessage);
        return;
    }

    if (hostMessage.command === 'troubleshootingHistory') {
        renderTroubleshootingHistory(hostMessage);
        return;
    }

    if (hostMessage.command === 'datasetJourney') {
        renderDatasetJourney(hostMessage);
        return;
    }

    if (hostMessage.command === 'treeQueryState') {
        runLocks.isTreeQueryRunning = !!hostMessage.isRunning;
        drawTreeQueryButtons();
        return;
    }

    if (hostMessage.command === 'treeQueryResult') {
        renderTreeQueryResult(hostMessage);
        acknowledgeRecordLinks(hostMessage);
        return;
    }

    if (hostMessage.command === 'updaterLoadState') {
        runLocks.updaterLoadRunningTreeKey = hostMessage.isRunning ? String(hostMessage.treeKey) : null;
        runLocks.updaterRunKind = hostMessage.isRunning ? ( ['generate', 'update', 'restore', 'retrieve', 'apply', 'prepareChild', 'generateChild'].indexOf(hostMessage.runKind) !== -1 ? hostMessage.runKind : 'load' ) : '';
        const updaterRunKind = runLocks.updaterRunKind;
        if (updaterRunKind !== 'prepareChild') { runLocks.adapterChildPreparingKey = ''; }
        if (updaterRunKind !== 'restore') { runLocks.updaterRestoringSnapshotName = ''; }
        // THE HOST LETS THE LAST LOAD GO WHEN THE NEXT STARTS, AND ITS VALUES WITH IT; A GENERATION LETS ONLY THE VALUES GO
        if (hostMessage.isRunning) {
            if (updaterRunKind === 'load') { clearUpdaterRecords(); }
            // A NEW CHILD (#447) BELONGS TO THE RECORDS IT IS ADDED UNDER; A NEW ONE REPLACES IT, AND A GENERATION ITS PREVIEW
            if (updaterRunKind === 'load' || updaterRunKind === 'prepareChild') { clearAdapterChildren(); }
            if (updaterRunKind === 'generateChild') { clearAdapterChildPreviews(); }
            // AN UPDATE (#418) KEEPS THE PREVIEW ON SCREEN WHILE ITS CONFIRMATION ASKS ABOUT IT, AND A METADATA RETRIEVE (#445) TOUCHES NO RECORD
            if (['update', 'restore', 'retrieve', 'apply', 'prepareChild', 'generateChild'].indexOf(updaterRunKind) === -1) { clearUpdaterValues(); }
        }
        // AN UPDATE THAT SENT A REQUEST SPENT THE LOADED RECORDS: THEIR "current" VALUES ARE NO LONGER CURRENT
        if (!hostMessage.isRunning && hostMessage.isRecordsSpent === true) {
            clearUpdaterRecords();
            clearUpdaterValues();
            clearAdapterChildren();
        }
        drawUpdaterLoadButtons();
        return;
    }

    if (hostMessage.command === 'updaterRecords') {
        renderUpdaterRecords(hostMessage);
        acknowledgeRecordLinks(hostMessage);
        return;
    }

    if (hostMessage.command === 'updaterRecordsPage') {
        renderUpdaterRecordsPage(hostMessage);
        return;
    }

    if (hostMessage.command === 'updaterParentChange') {
        renderUpdaterParentChange(hostMessage);
        return;
    }

    if (hostMessage.command === 'adapterMetadataChanges') {
        renderAdapterMetadataChanges(hostMessage);
        return;
    }

    if (hostMessage.command === 'adapterChildBlock') {
        renderAdapterChildBlock(hostMessage);
        return;
    }

    if (hostMessage.command === 'adapterChildPreview') {
        renderAdapterChildPreview(hostMessage);
        return;
    }

    if (hostMessage.command === 'updaterSnapshots') {
        renderUpdaterSnapshots(hostMessage);
        return;
    }

    if (hostMessage.command === 'updaterValues') {
        renderUpdaterValues(hostMessage);
        acknowledgeRecordLinks(hostMessage);
        return;
    }

    if (hostMessage.command === 'metadataRetrieveState') {
        runLocks.isMetadataRetrieveRunning = !!hostMessage.isRunning;
        runLocks.metadataRetrieveRunningKey = runLocks.isMetadataRetrieveRunning ? hostMessage.treeKey + '\n' + hostMessage.retrieveKind : null;
        drawTreeInserts();
        drawDataOrgViews();
        return;
    }

    if (hostMessage.command === 'orgOpenState') {
        runLocks.isOrgOpenRunning = !!hostMessage.isRunning;
        drawDataOrgViews();
        return;
    }

    if (hostMessage.command === 'datasetAdded') {
        renderDatasetAdded(hostMessage);
        return;
    }

    if (hostMessage.command === 'focusTree') {
        // A FAILED INSERT'S "Open Troubleshooting" (#375), ON THE MODEL ON SCREEN ONLY
        if (renderedSequence !== null && hostMessage.renderSequence === renderedSequence) { focusTreeInPlace(hostMessage.focusTree); }
        return;
    }

    if (hostMessage.command === 'runSwitchCancelled') {
        restoreRunSelection();
        return;
    }

    if (hostMessage.command === 'loadFailed') {

        setLoadStatus(hostMessage.message, true);

        // A RUN THAT FAILED TO LOAD LEAVES THE PREVIOUS ONE'S ROWS ON SCREEN, SO THE SELECTOR NAMES THAT ONE AGAIN
        restoreRunSelection();

    }

}
