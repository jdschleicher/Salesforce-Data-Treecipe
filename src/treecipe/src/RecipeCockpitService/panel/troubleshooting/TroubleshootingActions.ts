import {
    MetadataDeployKind,
    MetadataRetrieveKind,
    RECIPE_COCKPIT_ASSIGN_PERMISSION_SETS_TITLE,
    RECIPE_COCKPIT_DEPLOY_ACTION_BY_KIND,
    RECIPE_COCKPIT_DEPLOY_ACTION_LABELS,
    RECIPE_COCKPIT_DEPLOY_COMMAND_BY_KIND,
    RECIPE_COCKPIT_GENERATE_PERMISSION_SET_ACTION_LABEL,
    RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL,
    RECIPE_COCKPIT_RETRIEVE_ACTION_BY_KIND,
    RECIPE_COCKPIT_RETRIEVE_ACTION_LABELS,
    RECIPE_COCKPIT_RETRIEVE_COMMAND_BY_KIND
} from '../../RecipeCockpitTroubleshootingConstants';
import { IActionCardView, buildActionCard } from '../RecipeCockpitPanelBuilders';
import { drawDataOrgViews } from '../treecipe/dataOrg/DataOrgView';
import { drawTreeInserts, listTreeInsertObjectApiNames } from '../treecipe/dataOrg/TreeInsert';
import { applyTroubleshootingFilter, describeRunningInsert } from './TroubleshootingTab';
import { ITroubleshootingSummaryMessage, ITroubleshootingTreeState } from './TroubleshootingTypes';

/*
    The Troubleshooting tab's actions (#274, #306, #326, #346, #382, #639): each deploy and retrieve
    card, and the two permission set cards. A click posts the tree's KEY and an org index at most;
    the host plans, confirms and runs. These names are the panel script's own: the run locks a
    click takes are its variables, which drawTreeInserts reads for every other button.
*/
declare const vscodeApi: { postMessage(message: unknown): void };
declare const renderedSequence: number | null;
declare const dataOrgSelectedIndex: number | null;
declare const insertRunningTreeKey: string | null;
declare const isScratchOrgRunning: boolean;
declare let isMetadataDeployRunning: boolean;
declare let metadataDeployRunningKey: string | null;
declare let isMetadataRetrieveRunning: boolean;
declare let metadataRetrieveRunningKey: string | null;
declare let isPermissionSetAssignRunning: boolean;
declare function drawActionCardState(actionCard: IActionCardView, reason: string, title: string): void;
declare function setTextShown(element: HTMLElement, text: string): void;
declare function pluralize(count: number, singular: string, plural: string): string;

// WHAT AN ACTION CARD SAYS BELOW ITS WHY LINE, AND WHY IT CANNOT RUN ('' WHEN IT CAN)
interface IActionSummary {
    text: string;
    emptyReason: string;
}

export function buildDeployAction(treeState: ITroubleshootingTreeState, deployKind: MetadataDeployKind): IActionCardView {

    const actionCard = buildActionCard(RECIPE_COCKPIT_DEPLOY_ACTION_BY_KIND[deployKind], 'troubleshootingDeploy troubleshootingDeploy-' + deployKind, RECIPE_COCKPIT_DEPLOY_ACTION_LABELS[deployKind]);
    const buttonElement = actionCard.buttonElement;
    actionCard.detailElement.classList.add('troubleshootingSummary');
    setTextShown(actionCard.detailElement, 'Reading this project…');

    buttonElement.addEventListener('click', function () {
        if (buttonElement.disabled || renderedSequence === null) { return; }
        isMetadataDeployRunning = true;
        metadataDeployRunningKey = treeState.tree.treeKey + '\n' + deployKind;
        drawTreeInserts();
        drawDataOrgViews();
        const deployMessage: { command: string; treeKey: string; orgIndex?: number } = { command: RECIPE_COCKPIT_DEPLOY_COMMAND_BY_KIND[deployKind], treeKey: treeState.tree.treeKey };
        if (dataOrgSelectedIndex !== null) { deployMessage.orgIndex = dataOrgSelectedIndex; }
        vscodeApi.postMessage(deployMessage);
    });

    (treeState.deployCards as NonNullable<ITroubleshootingTreeState['deployCards']>)[deployKind] = actionCard;

    return actionCard;

}


// WHAT A SECTION SAYS IT WOULD DEPLOY, AND WHY ITS BUTTON IS DISABLED WHEN THERE IS NOTHING
function describeDeploySummary(summary: ITroubleshootingSummaryMessage | undefined, deployKind: MetadataDeployKind): IActionSummary {

    if (!summary) { return { text: 'Reading this project…', emptyReason: 'Reading this project…' }; }
    if (summary.failureMessage) { return { text: summary.failureMessage, emptyReason: summary.failureMessage }; }

    if (deployKind === 'permissionSet') {
        return {
            text: pluralize(summary.permissionSetCount, 'permission set', 'permission sets') + ' in this project grant access to this tree.',
            emptyReason: summary.permissionSetCount === 0 ? 'No permission set in this project grants access to this tree. Generate permission set… writes one.' : ''
        };
    }

    if (deployKind === 'fields') {
        const notes: string[] = [];
        if (summary.standardFieldCount > 0) { notes.push(pluralize(summary.standardFieldCount, 'standard field', 'standard fields') + ' never deployed'); }
        if (summary.unreadableFieldCount > 0) { notes.push(pluralize(summary.unreadableFieldCount, 'custom field', 'custom fields') + ' with no readable source file'); }
        // #402: THE CUSTOM OBJECTS THE FIELDS GO ON ARE DEPLOYED WITH THEM; ONE THE PROJECT LACKS OR CANNOT READ MUST ALREADY BE IN THE ORG
        const missingObjectCount = (summary.missingCustomObjectCount || 0) + (summary.unreadableCustomObjectCount || 0);
        if (missingObjectCount > 0) { notes.push(pluralize(missingObjectCount, 'custom object', 'custom objects') + ' with no readable .object-meta.xml'); }
        return {
            text: pluralize(summary.customFieldCount, 'CustomField', 'CustomField') + (summary.customObjectCount > 0 ? ' and ' + pluralize(summary.customObjectCount, 'CustomObject', 'CustomObject') : '') + (notes.length > 0 ? '; ' + notes.join('; ') : '') + '.',
            emptyReason: summary.customFieldCount === 0 ? 'This tree has no custom field whose source file this project holds.' : ''
        };
    }

    if (deployKind === 'globalValueSets') {
        return {
            text: pluralize(summary.globalValueSetCount, 'GlobalValueSet', 'GlobalValueSet')
                + (summary.missingGlobalValueSetCount > 0 ? '; ' + pluralize(summary.missingGlobalValueSetCount, 'named value set', 'named value sets') + ' this project does not hold' : '') + '.',
            emptyReason: summary.globalValueSetCount === 0 ? 'No field of this tree names a global value set this project holds.' : ''
        };
    }

    return {
        text: pluralize(summary.recordTypeCount, 'RecordType', 'RecordType') + '.',
        emptyReason: summary.recordTypeCount === 0 ? 'No object of this tree has a record type in this project.' : ''
    };

}


/*
    The Troubleshooting tab's retrieves (#326, #382) post the tree's KEY alone, never an org: the
    host asks for the org in the command palette every time, and decides what is retrieved. One
    retrieve per window, so every card's retrieve and deploy is disabled on the click until the
    host's metadataRetrieveState.
*/
export function buildRetrieveAction(treeState: ITroubleshootingTreeState, retrieveKind: MetadataRetrieveKind): IActionCardView {

    const className = retrieveKind === 'validationRules' ? 'treeRetrieveValidationRules' : 'troubleshootingRetrieve troubleshootingRetrieve-' + retrieveKind;
    const actionCard = buildActionCard(RECIPE_COCKPIT_RETRIEVE_ACTION_BY_KIND[retrieveKind], className, RECIPE_COCKPIT_RETRIEVE_ACTION_LABELS[retrieveKind]);
    const retrieveButtonElement = actionCard.buttonElement;
    retrieveButtonElement.addEventListener('click', function () {
        if (retrieveButtonElement.disabled || renderedSequence === null) { return; }
        isMetadataRetrieveRunning = true;
        metadataRetrieveRunningKey = treeState.tree.treeKey + '\n' + retrieveKind;
        drawTreeInserts();
        drawDataOrgViews();
        vscodeApi.postMessage({ command: RECIPE_COCKPIT_RETRIEVE_COMMAND_BY_KIND[retrieveKind], treeKey: treeState.tree.treeKey });
    });
    (treeState.retrieveCards as NonNullable<ITroubleshootingTreeState['retrieveCards']>)[retrieveKind] = actionCard;

    return actionCard;

}


// WHAT A RETRIEVE CARD SAYS BELOW ITS WHY LINE, AND WHY IT CANNOT RUN WHEN THERE IS NOTHING TO ASK FOR (#382)
function describeRetrieveSummary(treeState: ITroubleshootingTreeState, retrieveKind: MetadataRetrieveKind): IActionSummary {

    const summary = treeState.troubleshootingSummary;

    if (retrieveKind === 'validationRules') { return { text: '', emptyReason: '' }; }

    if (retrieveKind === 'recordTypes') {
        return {
            text: pluralize(treeState.tree.objects.length, 'object', 'objects') + ', each asked for every record type the org holds.',
            emptyReason: treeState.tree.objects.length === 0 ? 'This tree has no object.' : ''
        };
    }

    if (!summary) { return { text: 'Reading this project…', emptyReason: 'Reading this project…' }; }
    if (summary.failureMessage) {
        const retrieveFailureMessage = summary.failureMessage.replace(/^Nothing can be deployed: /, 'Nothing can be retrieved: ');
        return { text: retrieveFailureMessage, emptyReason: retrieveFailureMessage };
    }

    if (retrieveKind === 'fields') {
        const fieldCount = summary.customFieldCount + summary.unreadableFieldCount;
        return {
            text: pluralize(fieldCount, 'custom field', 'custom fields') + '; ' + summary.customFieldCount + ' with a source file here.',
            emptyReason: fieldCount === 0 ? 'This tree has no custom field to retrieve.' : ''
        };
    }

    const valueSetCount = summary.globalValueSetCount + summary.missingGlobalValueSetCount;
    return {
        text: pluralize(valueSetCount, 'named value set', 'named value sets') + '; ' + summary.globalValueSetCount + ' held here.',
        emptyReason: valueSetCount === 0 ? 'No field of this tree names a global value set.' : ''
    };

}


/*
    "Assign permission sets to me…" (#274, #302), in the Troubleshooting tab (#346). Posts the
    tree's KEY, and the index of the org the Treecipe tab has selected when it has one; with
    none the host asks for an org itself. Which permission sets are offered is the host's.
    Every assign button and insert is disabled on the click, and only the host's
    permissionSetAssignState gives them back. How it went is a VS Code notification, never a
    line here.
*/
export function buildAssignPermissionSetCard(treeState: ITroubleshootingTreeState): IActionCardView {

    const actionCard = buildActionCard('assignPermissionSets', 'treePermissionSets', RECIPE_COCKPIT_PERMISSION_SET_ACTION_LABEL);
    const buttonElement = actionCard.buttonElement;

    buttonElement.setAttribute('title', RECIPE_COCKPIT_ASSIGN_PERMISSION_SETS_TITLE);
    buttonElement.addEventListener('click', function () {
        if (isPermissionSetAssignRunning || isMetadataDeployRunning || insertRunningTreeKey !== null || isScratchOrgRunning || renderedSequence === null) { return; }
        isPermissionSetAssignRunning = true;
        drawTreeInserts();
        drawDataOrgViews();
        const permissionSetMessage: { command: string; treeKey: string; orgIndex?: number } = { command: 'assignTreePermissionSets', treeKey: treeState.tree.treeKey };
        if (dataOrgSelectedIndex !== null) { permissionSetMessage.orgIndex = dataOrgSelectedIndex; }
        vscodeApi.postMessage(permissionSetMessage);
    });

    treeState.permissionSetCard = actionCard;

    return actionCard;

}


/*
    "Generate permission set…" (#306) posts the tree's KEY alone; what is written, where, and
    the confirmation are the host's. It deploys nothing, so it needs no org and holds no
    other button.
*/
export function buildGeneratePermissionSetCard(treeState: ITroubleshootingTreeState): IActionCardView {

    const actionCard = buildActionCard('generatePermissionSet', 'treeGeneratePermissionSet', RECIPE_COCKPIT_GENERATE_PERMISSION_SET_ACTION_LABEL);
    const generateButtonElement = actionCard.buttonElement;
    generateButtonElement.addEventListener('click', function () {
        if (generateButtonElement.disabled || renderedSequence === null) { return; }
        vscodeApi.postMessage({ command: 'generateTreePermissionSet', treeKey: treeState.tree.treeKey });
    });
    treeState.generatePermissionSetCard = actionCard;

    return actionCard;

}


export function drawTreePermissionSet(treeState: ITroubleshootingTreeState): void {

    const permissionSetCard = treeState.permissionSetCard;
    if (permissionSetCard) {
        const assignReason = isPermissionSetAssignRunning ? 'Permission sets are being assigned.'
            : isMetadataDeployRunning ? 'Metadata is being deployed.'
            : insertRunningTreeKey !== null ? describeRunningInsert()
            : isScratchOrgRunning ? 'A scratch org is being set up.'
            : '';
        drawActionCardState(permissionSetCard, assignReason, RECIPE_COCKPIT_ASSIGN_PERMISSION_SETS_TITLE);
    }

    const generateCard = treeState.generatePermissionSetCard;
    if (generateCard) {
        const generateReason = listTreeInsertObjectApiNames(treeState).length === 0 ? 'Every object of this tree is excluded, so there is nothing to grant.'
            : isPermissionSetAssignRunning ? 'Permission sets are being assigned.'
            : isMetadataDeployRunning ? 'Metadata is being deployed.'
            : '';
        drawActionCardState(generateCard, generateReason, 'Write a permission set granting Create and Read on this tree\'s objects and access to its fields into this project\'s permissionsets/SDT_Treecipe folder, after a confirmation. Nothing is deployed.');
    }

    const retrieveCards = treeState.retrieveCards || {};
    (Object.keys(retrieveCards) as MetadataRetrieveKind[]).forEach(function (retrieveKind) {

        const retrieveCard = retrieveCards[retrieveKind] as IActionCardView;
        const described = describeRetrieveSummary(treeState, retrieveKind);
        const busyReason = isMetadataRetrieveRunning ? 'Metadata is being retrieved.'
            : insertRunningTreeKey !== null ? describeRunningInsert()
            : isPermissionSetAssignRunning ? 'Permission sets are being assigned.'
            : isMetadataDeployRunning ? 'Metadata is being deployed.'
            : '';
        const title = metadataRetrieveRunningKey === treeState.tree.treeKey + '\n' + retrieveKind ? 'Retrieving…' : RECIPE_COCKPIT_RETRIEVE_ACTION_LABELS[retrieveKind];

        setTextShown(retrieveCard.detailElement, described.text);
        if (retrieveCard.titleElement.textContent !== title) { retrieveCard.titleElement.textContent = title; }
        drawActionCardState(retrieveCard, described.emptyReason || busyReason, retrieveKind === 'validationRules'
            ? 'Retrieve the validation rules of this tree\'s objects from an org you choose in the command palette into this project, after a confirmation. Nothing is deployed; Generate Treecipe then applies them.'
            : 'Retrieve these components of this tree from an org you choose in the command palette into this project, after a confirmation. Nothing is deployed; run Generate Treecipe afterwards.');

    });

    const deployCards = treeState.deployCards || {};
    (Object.keys(deployCards) as MetadataDeployKind[]).forEach(function (deployKind) {

        const deployCard = deployCards[deployKind] as IActionCardView;
        const described = describeDeploySummary(treeState.troubleshootingSummary, deployKind);
        const busyReason = isMetadataDeployRunning ? 'Metadata is being deployed.'
            : insertRunningTreeKey !== null ? describeRunningInsert()
            : isScratchOrgRunning ? 'A scratch org is being set up.'
            : isPermissionSetAssignRunning ? 'Permission sets are being assigned.'
            : isMetadataRetrieveRunning ? 'Metadata is being retrieved.'
            : '';
        const deployReason = described.emptyReason || busyReason;
        const title = metadataDeployRunningKey === treeState.tree.treeKey + '\n' + deployKind ? 'Deploying…' : RECIPE_COCKPIT_DEPLOY_ACTION_LABELS[deployKind];

        setTextShown(deployCard.detailElement, described.text);
        if (deployCard.titleElement.textContent !== title) { deployCard.titleElement.textContent = title; }
        drawActionCardState(deployCard, deployReason, 'Deploy these components of this tree, through a generated package.xml, to the sandbox or scratch org selected above, or one you choose, after a confirmation.');

    });

    // A RUN CHANGES WHAT AN ACTION DRAWS ("Deploying…"), SO AN OPEN SEARCH MATCHES WHAT IS ON SCREEN NOW
    if (treeState.troubleshootingSubTabStates) { applyTroubleshootingFilter(treeState, 'actions'); }

}


export function renderPermissionSetAssignState(hostMessage: { isRunning?: unknown }): void {

    isPermissionSetAssignRunning = !!hostMessage.isRunning;

    drawDataOrgViews();
    drawTreeInserts();

}
