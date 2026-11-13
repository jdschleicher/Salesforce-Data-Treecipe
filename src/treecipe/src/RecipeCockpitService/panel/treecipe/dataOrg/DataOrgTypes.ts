import type { RecipeCockpitTroubleshootingSubTab } from '../../../RecipeCockpitTroubleshootingConstants';

/*
    The shapes Target Org Manager and a tree's insert button work on (#654). A tree card's state is
    built by the panel script, which is not type checked yet, so IDataOrgTreeState names only what
    these modules read and write on it.
*/

// ONE VIEW OF THE PANEL-WIDE ORG PICKER; drawnLabels IS THE LIST LAST DRAWN INTO ITS DROPDOWN, SO AN UNCHANGED LIST IS NOT REDRAWN
export interface IDataOrgView {
    element: HTMLElement;
    loadElement: HTMLButtonElement;
    selectElement: HTMLSelectElement;
    spinnerElement: HTMLElement;
    typeElement: HTMLElement;
    openOrgElement: HTMLButtonElement;
    refreshElement: HTMLButtonElement;
    newScratchElement: HTMLButtonElement;
    authorizeElement: HTMLButtonElement;
    hiddenNoteElement: HTMLElement;
    statusElement: HTMLElement;
    drawnLabels: string[] | null;
}

// WHAT THE HOST DECIDED ABOUT ONE OBJECT, OR ONE TREE'S OBJECT, IN THE ORG SELECTED: disabledReason IS SHOWN, disabledReasonCode IS WHAT LINKS
export interface IDataOrgReadiness {
    objectApiName: string;
    treeKey?: string;
    disabledReason?: string;
    disabledReasonCode?: unknown;
    disabledReasonFieldApiName?: unknown;
}

// THE PICKER AS IT WAS WHEN A CHECK STARTED, PUT BACK WHEN THE HOST REFUSES THE LISTING (#537)
export interface IDataOrgPickerBeforeCheck {
    labels: string[] | null;
    isLoadShown: boolean;
    isSelectShown: boolean;
    isRefreshShown: boolean;
    hiddenNoteText: string;
    requestedSequence: number | null;
    requestSequence: number | null;
    clearedRequestSequence: number | null;
    selectedIndex: number | null;
    selectionFailureMessage: string;
    readinessByObject: Record<string, IDataOrgReadiness>;
    readinessByTreeObjectKey: Record<string, IDataOrgReadiness>;
    typeLabel: string | null;
}

// WHAT THE HOST POSTS (dataOrgList, dataOrgSelection, dataOrgProvisional, dataOrgReadiness, dataOrgListingRefused, scratchOrgState), READ AS IT IS SENT
export interface IDataOrgListMessage {
    renderSequence: unknown;
    orgLabels?: unknown;
    selectedOrgIndex: number | null;
    noOrgsMessage: string;
    hiddenOrgNote?: string;
    forgottenOrgNotice?: string;
}

export interface IDataOrgSelectionMessage {
    renderSequence: unknown;
    requestSequence: number;
    orgIndex: number;
    orgLabel: string;
    orgTypeLabel?: string;
    failureMessage?: string;
}

export interface IDataOrgProvisionalMessage {
    renderSequence: unknown;
    requestSequence: number;
    orgLabel: unknown;
}

export interface IDataOrgReadinessMessage {
    renderSequence: unknown;
    requestSequence: unknown;
    objects: IDataOrgReadiness[];
    createTargets?: Array<IDataOrgReadiness & { treeKey: string }>;
}

export interface IDataOrgListingRefusedMessage {
    renderSequence: unknown;
    message: unknown;
}

export interface IScratchOrgStateMessage {
    isRunning?: unknown;
    isAuthorizing?: unknown;
}

// WHERE A DISABLED INSERT'S REASON LINKS TO (#539): A TROUBLESHOOTING SUB-TAB, OR ONE FIELD'S ROW
export type InsertReasonLink =
    | { kind: 'troubleshooting'; subTab: RecipeCockpitTroubleshootingSubTab; label: string }
    | { kind: 'field'; objectState: IInsertTreeObjectState; fieldApiName: string; label: string };

export interface ITreeInsertBlock {
    reason: string;
    readiness: IDataOrgReadiness | null;
}

export interface ITreeInsertView {
    buttonElement: HTMLButtonElement;
    reasonElement: HTMLElement;
    reasonLinkElement: HTMLButtonElement;
    reasonLink: InsertReasonLink | null;
}

export interface IInsertTreeField {
    fieldApiName: string;
}

export interface IInsertTreeFieldState {
    field: IInsertTreeField;
    includeElement?: HTMLElement | null;
    rowElement?: HTMLElement | null;
}

export interface IInsertTree {
    treeKey: string;
    folderName?: string;
    runFakerRecipeFileName?: string;
}

export interface IInsertTreeObjectState {
    tree?: IInsertTree;
    isIteration?: boolean;
    object: { objectApiName: string; nickname?: string; fields: IInsertTreeField[] };
    fieldStates: IInsertTreeFieldState[];
}

export interface IInsertActionCard {
    buttonElement: HTMLButtonElement;
}

// THE PARTS OF A TREE CARD'S STATE THESE MODULES READ AND WRITE; THE SCRIPT BUILDS THE REST
export interface IDataOrgTreeState {
    tree: IInsertTree;
    objectStates: IInsertTreeObjectState[];
    insert?: ITreeInsertView;
    resetSelectionElement?: HTMLElement;
    deployCards?: { fields?: IInsertActionCard };
    permissionSetCard?: IInsertActionCard;
    troubleshootingSubTabStates?: Array<{ subTab: string; tabElement: HTMLElement }>;
}
