import { createButton, createElement } from '../../../../CockpitKit/panel/CockpitPanelElements';
import {
    RECIPE_COCKPIT_CANNOT_INSERT_PREFIX,
    RECIPE_COCKPIT_CHOOSE_INSERT_ORG_NOTE,
    RECIPE_COCKPIT_INSERT_ACTION_LABEL,
    RECIPE_COCKPIT_INSERT_REASON_TREECIPE_LINK_PREFIX,
    RECIPE_COCKPIT_INSERT_REASON_TROUBLESHOOTING_LINKS,
    RECIPE_COCKPIT_NO_DATA_ORG_INSERT_REASON
} from '../../../RecipeCockpitDataOrgConstants';
import { RECIPE_COCKPIT_INSERT_RUNNING_LABEL, RECIPE_COCKPIT_ORG_CONNECTION_CHECK_INSERT_REASON } from '../../../RecipeCockpitDatasetsTabConstants';
import { RECIPE_COCKPIT_DATASET_INSERT_RUNNING_REASON } from '../../../RecipeCockpitTroubleshootingConstants';
import { drawDatasetInserts } from '../../datasets/DatasetRow';
import { drawTreeQueryButtons } from '../../query/QueryTab';
import { drawTreePermissionSet } from '../../troubleshooting/TroubleshootingActions';
import { ITroubleshootingTreeState } from '../../troubleshooting/TroubleshootingTypes';
import { drawDataOrgViews } from './DataOrgView';
import { IDataOrgReadiness, IDataOrgTreeState, IInsertTree, IInsertTreeObjectState, InsertReasonLink, ITreeInsertBlock, ITreeInsertView } from './DataOrgTypes';

/*
    A tree's one insert button (#255, #375) and why it cannot run (#539). The host decides each
    object's readiness and checks every reason again on the click; the button only draws that
    answer. The run locks are the panel script's variables, which a reopened panel's replay sets.
*/
declare const vscodeApi: { postMessage(message: unknown): void };
declare const renderedSequence: number | null;
declare const treeStates: Array<IDataOrgTreeState & ITroubleshootingTreeState>;
declare const dataOrgLabels: string[] | null;
declare const dataOrgSelectedIndex: number | null;
declare const dataOrgRequestSequence: number | null;
declare const dataOrgSelectionFailureMessage: string;
declare const dataOrgReadinessByObject: Record<string, IDataOrgReadiness>;
declare const dataOrgReadinessByTreeObjectKey: Record<string, IDataOrgReadiness>;
declare const isDataOrgChecking: boolean;
declare const isScratchOrgRunning: boolean;
declare const isPermissionSetAssignRunning: boolean;
declare const isMetadataDeployRunning: boolean;
declare const recordTypeObjects: unknown[];
declare const isRecordTypeSelectionRemembered: boolean;
declare let insertRunningTreeKey: string | null;
declare let insertRunningDatasetFolderName: string | null;
declare function hasOwnKey(record: object, key: unknown): boolean;
declare function displayTitleOf(tree: unknown): string;
declare function setTextShown(element: HTMLElement, text: string): void;
declare function savePanelPlace(): void;
declare function buildTreeObjectKey(treeKey: string, objectApiName: string): string;
declare function indexObjectExclusions(tree: IInsertTree): Record<string, unknown>;
declare function findObjectFieldSelection(tree: IInsertTree | undefined, objectApiName: string, nickname: string): object | null;
declare function occurrenceNicknameOf(object: { nickname?: string }): string;
declare function isTreeFieldUnticked(objectFieldSelection: object | null, fieldApiName: string): boolean;
declare function buildRecordTypeSelection(): Record<string, string[]>;
declare function drawRecordTypeChoices(): void;
declare function applyTreeFocus(focusTree: { treeKey: string; tab: string; troubleshootingSubTab: string }): void;
declare function revealTreeObjectRow(treeState: IDataOrgTreeState, treeObjectState: IInsertTreeObjectState, fieldState: unknown, focusElement: null): void;

// WHAT THE CLICK POSTS: THE TREE'S KEY, AND THE RECORD TYPES TICKED UNDER Manage record types (#623) WHEN THEY DIFFER OR ARE REMEMBERED
interface IInsertTreeMessage {
    command: 'insertTree';
    treeKey: string;
    recordTypeSelection?: Record<string, string[]>;
    isRemembered?: true;
}

export function buildTreeInsertElement(treeState: IDataOrgTreeState): HTMLElement {

    const controlsElement = createElement('div', 'treeInsertControls');
    const insert: ITreeInsertView = {
        buttonElement: createButton('primary', 'treeInsert', RECIPE_COCKPIT_INSERT_ACTION_LABEL),
        reasonElement: createElement('span', 'treeInsertReason muted'),
        reasonLinkElement: createButton('link', 'treeInsertReasonLink hidden', ''),
        reasonLink: null
    };

    /*
        The ONE button always generates AND inserts (#375): with no org chosen the host asks for
        one first; any other reason the insert cannot run disables it. It never generates only.
    */
    insert.buttonElement.addEventListener('click', function () {
        const treeKey = treeState.tree.treeKey;
        if (isTreeRunning(treeKey) || renderedSequence === null) { return; }
        const insertReason = findTreeInsertReason(treeState);
        if (insertReason !== '' && insertReason !== RECIPE_COCKPIT_NO_DATA_ORG_INSERT_REASON) { return; }
        setInsertRunning(treeKey);
        const insertMessage: IInsertTreeMessage = { command: 'insertTree', treeKey: treeKey };
        const recordTypeSelection = buildRecordTypeSelection();
        // WITH "Remember this selection" TICKED THE TICKS ARE SENT EVEN WHEN NONE DIFFERS, SO A SAVED CHOICE IS FORGOTTEN
        if (Object.keys(recordTypeSelection).length > 0 || (isRecordTypeSelectionRemembered && recordTypeObjects.length > 0)) {
            insertMessage.recordTypeSelection = recordTypeSelection;
            if (isRecordTypeSelectionRemembered) { insertMessage.isRemembered = true; }
        }
        vscodeApi.postMessage(insertMessage);
    });

    insert.reasonLinkElement.addEventListener('click', function () {
        if (insert.reasonLink) { followInsertReasonLink(treeState, insert.reasonLink); }
    });

    controlsElement.appendChild(insert.buttonElement);
    if (treeState.resetSelectionElement) { controlsElement.appendChild(treeState.resetSelectionElement); }
    controlsElement.appendChild(insert.reasonElement);
    controlsElement.appendChild(insert.reasonLinkElement);

    treeState.insert = insert;
    drawTreeInsert(treeState);

    return controlsElement;

}

function isTreeRunning(treeKey: string): boolean {
    return insertRunningTreeKey === treeKey;
}

/*
    The objects a tree's insert sends: once each, not excluded -- the host checks the same list
    before it inserts anything.
*/
export function listTreeInsertObjectApiNames(treeState: { tree: IInsertTree; objectStates: Array<{ isIteration?: boolean; object: { objectApiName: string } }> }): string[] {

    const exclusionsByObjectApiName = indexObjectExclusions(treeState.tree);

    return treeState.objectStates
        .filter(function (treeObjectState) { return !treeObjectState.isIteration && !hasOwnKey(exclusionsByObjectApiName, treeObjectState.object.objectApiName); })
        .map(function (treeObjectState) { return treeObjectState.object.objectApiName; });

}

/*
    Why a tree's insert is not offered, or '' when it is (#255). The host decides each object's
    readiness and says why not; the button only draws that answer, and the host checks every
    one of them again on the click.
*/
function findTreeInsertReason(treeState: IDataOrgTreeState): string {
    return findTreeInsertBlock(treeState).reason;
}

// THE REASON, AND THE OBJECT READINESS IT CAME FROM WHEN ONE DID (#539): ONLY THAT READINESS CAN LINK
function findTreeInsertBlock(treeState: IDataOrgTreeState): ITreeInsertBlock {

    const blockedBy = function (reason: string): ITreeInsertBlock { return { reason: reason, readiness: null }; };

    if (isDataOrgChecking) { return blockedBy(RECIPE_COCKPIT_ORG_CONNECTION_CHECK_INSERT_REASON); }
    if (insertRunningDatasetFolderName !== null) { return blockedBy(RECIPE_COCKPIT_DATASET_INSERT_RUNNING_REASON); }
    if (insertRunningTreeKey !== null && insertRunningTreeKey !== treeState.tree.treeKey) { return blockedBy('Another tree is being inserted.'); }
    if (isScratchOrgRunning) { return blockedBy('A scratch org is being set up.'); }
    if (isPermissionSetAssignRunning) { return blockedBy('Permission sets are being assigned.'); }
    if (isMetadataDeployRunning) { return blockedBy('Metadata is being deployed.'); }

    const insertObjectApiNames = listTreeInsertObjectApiNames(treeState);
    if (insertObjectApiNames.length === 0) { return blockedBy('Every object of this tree is excluded.'); }

    // THE ONE REASON THAT LEAVES THE BUTTON ENABLED (#375): THE CLICK ASKS FOR THE ORG
    if (dataOrgRequestSequence === null || dataOrgSelectedIndex === null) { return blockedBy(RECIPE_COCKPIT_NO_DATA_ORG_INSERT_REASON); }
    if (dataOrgSelectionFailureMessage) { return blockedBy(dataOrgSelectionFailureMessage); }

    for (let objectIndex = 0; objectIndex < insertObjectApiNames.length; objectIndex++) {
        const objectApiName = insertObjectApiNames[objectIndex];
        const treeObjectKey = buildTreeObjectKey(treeState.tree.treeKey, objectApiName);
        const readiness = hasOwnKey(dataOrgReadinessByTreeObjectKey, treeObjectKey) ? dataOrgReadinessByTreeObjectKey[treeObjectKey]
            : hasOwnKey(dataOrgReadinessByObject, objectApiName) ? dataOrgReadinessByObject[objectApiName]
            : null;
        if (!readiness) { return blockedBy('checking whether this tree can be inserted…'); }
        if (readiness.disabledReason) { return { reason: readiness.disabledReason, readiness: readiness }; }
    }

    return blockedBy('');

}

/*
    Where a disabled insert's reason links to (#539), or null: an object the org lacks to the
    Fields sub-tab (Deploy fields & dependencies… deploys the object too, #402), one it will not create to
    Permissions, an unticked required field to its own row. Read from the posted readiness's
    code, never its sentence; an unknown code, or a target this card does not draw, links nowhere.
*/
function findInsertReasonLink(treeState: IDataOrgTreeState, readiness: IDataOrgReadiness | null): InsertReasonLink | null {

    if (!readiness || typeof readiness.disabledReasonCode !== 'string') { return null; }

    if (hasOwnKey(RECIPE_COCKPIT_INSERT_REASON_TROUBLESHOOTING_LINKS, readiness.disabledReasonCode)) {
        if (!treeState.tree.folderName) { return null; }
        const troubleshootingLink = RECIPE_COCKPIT_INSERT_REASON_TROUBLESHOOTING_LINKS[readiness.disabledReasonCode as keyof typeof RECIPE_COCKPIT_INSERT_REASON_TROUBLESHOOTING_LINKS];
        return { kind: 'troubleshooting', subTab: troubleshootingLink.subTab, label: troubleshootingLink.label };
    }

    if (readiness.disabledReasonCode !== 'requiredFieldUnticked' || typeof readiness.disabledReasonFieldApiName !== 'string') { return null; }

    const objectApiName = readiness.objectApiName;
    // THE ORG'S FIELD NAME, AND SALESFORCE READS NAMES CASE-INSENSITIVELY
    const lowerFieldApiName = readiness.disabledReasonFieldApiName.toLowerCase();
    const findField = function (treeObjectState: IInsertTreeObjectState) {
        return treeObjectState.object.fields.find(function (candidateField) { return candidateField.fieldApiName.toLowerCase() === lowerFieldApiName; });
    };

    // EVERY OCCURRENCE KEEPS ITS OWN UNTICKS (#467): THE ROW OPENED IS ONE THAT UNTICKS IT, ELSE THE FIRST
    const occurrenceStates = treeState.objectStates.filter(function (candidateState) { return candidateState.object.objectApiName === objectApiName && !!findField(candidateState); });
    const untickingState = occurrenceStates.find(function (candidateState) {
        const objectFieldSelection = findObjectFieldSelection(candidateState.tree, objectApiName, occurrenceNicknameOf(candidateState.object));
        const field = findField(candidateState);
        return !!objectFieldSelection && !!field && isTreeFieldUnticked(objectFieldSelection, field.fieldApiName);
    });
    const treeObjectState = untickingState || occurrenceStates.find(function (candidateState) { return !candidateState.isIteration; }) || occurrenceStates[0];
    const field = treeObjectState ? findField(treeObjectState) : undefined;
    if (!treeObjectState || !field) { return null; }

    const fieldApiName = field.fieldApiName;
    return { kind: 'field', objectState: treeObjectState, fieldApiName: fieldApiName, label: RECIPE_COCKPIT_INSERT_REASON_TREECIPE_LINK_PREFIX + objectApiName + '.' + fieldApiName };

}

function followInsertReasonLink(treeState: IDataOrgTreeState, reasonLink: InsertReasonLink): void {

    if (reasonLink.kind === 'troubleshooting') {

        applyTreeFocus({ treeKey: treeState.tree.treeKey, tab: 'troubleshooting', troubleshootingSubTab: reasonLink.subTab });
        savePanelPlace();

        const actionCard = reasonLink.subTab === 'fields' ? (treeState.deployCards || {}).fields : treeState.permissionSetCard;
        if (!actionCard) { return; }
        if (typeof actionCard.buttonElement.scrollIntoView === 'function') { actionCard.buttonElement.scrollIntoView({ block: 'nearest' }); }

        // A DISABLED BUTTON TAKES NO FOCUS IN A BROWSER, SO A DISABLED CARD (A ZERO COUNT) LEAVES IT ON ITS SUB-TAB, NEXT TO THE CARD AND ITS REASON
        const subTabState = (treeState.troubleshootingSubTabStates || []).find(function (candidateState) { return candidateState.subTab === reasonLink.subTab; });
        const focusElement = actionCard.buttonElement.disabled && subTabState ? subTabState.tabElement : actionCard.buttonElement;
        focusElement.focus();
        return;

    }

    const treeObjectState = reasonLink.objectState;
    const fieldState = treeObjectState.fieldStates.find(function (candidateState) { return candidateState.field.fieldApiName === reasonLink.fieldApiName; }) || null;

    revealTreeObjectRow(treeState, treeObjectState, fieldState, null);

    const focusElement = fieldState && (fieldState.includeElement || fieldState.rowElement);
    if (focusElement && typeof focusElement.focus === 'function') { focusElement.focus(); }

}

export function drawTreeInsert(treeState: IDataOrgTreeState): void {

    const insert = treeState.insert;
    if (!insert) { return; }

    const tree = treeState.tree;
    const insertBlock = findTreeInsertBlock(treeState);
    const insertReason = insertBlock.reason;
    const isOrgToChoose = insertReason === RECIPE_COCKPIT_NO_DATA_ORG_INSERT_REASON;
    const orgLabel = dataOrgLabels && dataOrgSelectedIndex !== null && dataOrgLabels[dataOrgSelectedIndex] ? dataOrgLabels[dataOrgSelectedIndex] : '';
    const actionLabel = RECIPE_COCKPIT_INSERT_ACTION_LABEL + (insertReason === '' && orgLabel ? ' into ' + orgLabel : '');

    insert.buttonElement.disabled = isTreeRunning(tree.treeKey) || (insertReason !== '' && !isOrgToChoose);

    insert.buttonElement.textContent = insertRunningTreeKey === tree.treeKey ? RECIPE_COCKPIT_INSERT_RUNNING_LABEL : actionLabel;
    insert.buttonElement.setAttribute('aria-label', actionLabel + ' for ' + displayTitleOf(tree) + ' (' + tree.runFakerRecipeFileName + ')');
    insert.buttonElement.setAttribute('title', isOrgToChoose
        ? 'Choose the org to insert into, then generate this tree with its selection and counts from ' + tree.runFakerRecipeFileName + ' and insert it, parents first'
        : 'Generate this tree with its selection and counts from ' + tree.runFakerRecipeFileName + ', then insert it into the chosen org, parents first');
    insert.reasonElement.textContent = insertReason === '' ? '' : isOrgToChoose ? RECIPE_COCKPIT_CHOOSE_INSERT_ORG_NOTE : RECIPE_COCKPIT_CANNOT_INSERT_PREFIX + insertReason;

    insert.reasonLink = findInsertReasonLink(treeState, insertBlock.readiness);
    setTextShown(insert.reasonLinkElement, insert.reasonLink ? insert.reasonLink.label : '');

}

export function drawTreeInserts(): void {
    treeStates.forEach(drawTreeInsert);
    drawDatasetInserts();
    treeStates.forEach(drawTreePermissionSet);
    drawTreeQueryButtons();
}

// THE CLICKED TREE'S BUTTON IS DISABLED ON THE CLICK AND EVERY OTHER IS DISABLED; ITS insertState GIVES THEM BACK
export function setInsertRunning(runningTreeKey: string | null, runningDatasetFolderName?: unknown): void {

    insertRunningTreeKey = runningTreeKey;
    insertRunningDatasetFolderName = runningTreeKey !== null && typeof runningDatasetFolderName === 'string' ? runningDatasetFolderName : null;
    drawTreeInserts();
    drawDataOrgViews();
    drawRecordTypeChoices();

}
