import type { IActionCardView, ITabSearchView } from '../RecipeCockpitPanelBuilders';

/*
    The shapes the Treecipe Adapter tab's panel modules work on (#641). A tree card's state is built
    by the panel script, which is not type checked yet, so IAdapterTreeState names only what these
    modules read and write on it. What the host posts is read as untrusted: every leaf is unknown,
    and each is checked or converted where it is drawn.
*/

// THE PARTS OF A TREE'S MODEL THE TAB READS
export interface IAdapterParentLookup {
    fieldApiName: string;
    parentObjectApiName: string;
}

export interface IAdapterTreeObject {
    objectApiName: string;
    parentLookups: IAdapterParentLookup[];
}

// WHAT findFixedValue AND THE FIELD EDITOR READ; A NEW CHILD'S BLOCK (#447) BUILDS ONE WITH NO OBJECTS
export interface IAdapterTreeKey {
    treeKey: string;
    fixedValues?: unknown;
}

export interface IAdapterTree extends IAdapterTreeKey {
    objects: IAdapterTreeObject[];
}

export interface IAdapterField {
    fieldApiName: string;
    fieldLabel?: string;
    fieldType?: string;
    fieldTypeWithSize?: string;
    recipeValue?: string;
    controllingField?: string;
    isOnlyInRecipeFile?: boolean;
}

// A NEW CHILD'S BLOCK NAMES ITS OBJECT ONLY
export interface IAdapterObjectName {
    objectApiName: string;
}

export interface IAdapterObject extends IAdapterObjectName {
    fields: IAdapterField[];
    recipeFilePath: string;
    lineNumber: number;
}

// ONE OF THE TREECIPE TAB'S OBJECT STATES, AS THE ADAPTER READS IT
export interface IAdapterTreeObjectState {
    object: IAdapterObject;
    treeObject: IAdapterTreeObject;
    isIteration?: boolean;
}

// WHAT THE HOST POSTS: updaterRecords (#416), updaterValues (#417), updaterSnapshots (#419)
export interface IUpdaterPreviewObject {
    objectApiName?: unknown;
    recordCount?: unknown;
    failureMessage?: unknown;
    skippedReason?: unknown;
    columns?: unknown;
    rows?: unknown;
    hiddenColumnCount?: unknown;
    isTruncated?: unknown;
    totalSize?: unknown;
    recordLinks?: unknown;
}

export interface IUpdaterRecordsMessage {
    renderSequence: unknown;
    treeKey: unknown;
    objects?: Array<IUpdaterPreviewObject | null>;
    orgLabel?: unknown;
    recordLinkSequence?: unknown;
}

export interface IUpdaterValuesMessage {
    renderSequence: unknown;
    treeKey: unknown;
    objects?: Array<IUpdaterPreviewObject | null>;
    valuesSequence?: unknown;
    recordLinkSequence?: unknown;
}

export interface IUpdaterSnapshotsMessage {
    renderSequence: unknown;
    treeKey: unknown;
    snapshotNames?: unknown;
    hiddenSnapshotCount?: unknown;
    snapshotsSequence?: unknown;
}

// WHAT "Retrieve latest metadata" FOUND (#445), WITH WHAT THE HOST OFFERS FOR A FIELD ONLY THE ORG HOLDS (#446)
export interface IAdapterOrgOnlyOffer {
    fieldTypeWithSize?: unknown;
    expression?: unknown;
    note?: unknown;
    lockReason?: unknown;
}

export interface IAdapterFieldChange {
    fieldApiName?: unknown;
    fieldLabel?: unknown;
    fieldType?: unknown;
    status?: unknown;
    differences?: unknown;
    orgOnly?: IAdapterOrgOnlyOffer | null;
}

export interface IAdapterNewChildObject {
    childObjectApiName?: unknown;
    fieldApiName?: unknown;
}

export interface IAdapterObjectChanges {
    objectApiName?: unknown;
    fieldChanges?: Array<IAdapterFieldChange | null>;
    newChildObjects?: IAdapterNewChildObject[];
    moreNewChildObjectCount?: unknown;
    isRetrieved?: unknown;
}

export interface IAdapterHintRow {
    changedAt?: unknown;
    objectApiName?: unknown;
    text?: unknown;
}

export interface IAdapterHintList {
    rows?: unknown;
    note?: unknown;
    moreCount?: unknown;
    skippedCount?: unknown;
}

export interface IAdapterOrgHints {
    sourceTracking?: IAdapterHintList | null;
    auditTrail?: IAdapterHintList | null;
}

export interface IAdapterChangesMessage {
    renderSequence?: unknown;
    treeKey?: unknown;
    objects?: Array<IAdapterObjectChanges | null>;
    orgLabel?: unknown;
    childObjectsNote?: unknown;
    hints?: IAdapterOrgHints | null;
}

// "Add to data set" (#447): THE BLOCK THE HOST PREPARED, AND THE PREVIEW IT GENERATED
export interface IAdapterChildField {
    fieldApiName?: unknown;
    fieldLabel?: unknown;
    fieldTypeWithSize?: unknown;
    expression?: unknown;
    lockReason?: unknown;
    note?: unknown;
    isRequired?: unknown;
}

export interface IAdapterChildBlockMessage {
    renderSequence: unknown;
    treeKey: unknown;
    parentObjectApiName?: unknown;
    childObjectApiName?: unknown;
    lookupFieldApiName?: unknown;
    parentRecordCount?: unknown;
    orgLabel?: unknown;
    fakerService?: unknown;
    fields?: IAdapterChildField[];
    unreadableFieldCount?: unknown;
}

export interface IAdapterChildPreviewMessage {
    renderSequence: unknown;
    treeKey: unknown;
    childObjectApiName?: unknown;
    columns?: unknown;
    rows?: unknown;
    recordCount?: unknown;
    hiddenColumnCount?: unknown;
    countPerParent?: unknown;
}

// A PREVIEW THAT CAN OPEN ITS RECORDS (#556): ITS ACK IS THE ONLY THING THAT MAKES THEM ROUTABLE
export interface IRecordLinksMessage {
    renderSequence?: unknown;
    recordLinkSequence?: unknown;
}

/*
    A field row the Adapter's own parts draw (buildUpdaterFieldRow): a recipe field, a field only the
    org holds that the host offered (#446), or a new child's field (#447). The elements are made when
    the row is drawn.
*/
export interface IUpdaterFieldRowState {
    field: IAdapterField;
    fieldKey: string;
    lockReason: string;
    orgOnlyNote?: string;
    fieldChange?: IAdapterFieldChange | null;
    childObject?: null;
    orgChange: IAdapterFieldChange | null;
    orgChipElement: HTMLElement | null;
    isMatch: boolean;
    rowElement: HTMLElement | null;
    chooseElement: HTMLButtonElement | null;
    editButtonElement: HTMLButtonElement | null;
    editBadgeElement: HTMLElement | null;
    editedValueElement: HTMLElement | null;
    expressionRowElement: HTMLElement | null;
    editorElement: HTMLElement | null;
    isEditorOpen: boolean;
}

// A RECIPE FIELD'S ROW, WHICH THE FILTER READS
export interface IUpdaterRecipeFieldState extends IUpdaterFieldRowState {
    searchText: string;
    orgSearchText: string;
}

// A FIELD ONLY THE ORG HOLDS (#446): A ROW WITH A BOX WHEN THE HOST OFFERED ONE, A PLAIN ROW WHEN IT DID NOT
export interface IAdapterOrgOnlyFieldState extends Omit<IUpdaterFieldRowState, 'field'> {
    field: IAdapterField | null;
    fieldChange: IAdapterFieldChange;
    childObject: null;
    searchText: string;
    orgSearchText: string;
}

// A CUSTOM CHILD OBJECT ONLY THE ORG HOLDS, UNDER ITS PARENT, WITH "Add to data set" (#447)
export interface IAdapterChildObjectRowState {
    fieldChange: null;
    childObject: IAdapterNewChildObject;
    field?: undefined;
    searchText: string;
    isMatch: boolean;
    rowElement: HTMLElement | null;
    addElement?: HTMLButtonElement;
}

export type AdapterOrgOnlyRowState = IAdapterOrgOnlyFieldState | IAdapterChildObjectRowState;

// WHAT A FIELD ROW READS OF ITS OBJECT; A NEW CHILD'S BLOCK (#447) BUILDS ONE OF ITS OWN
export interface IUpdaterFieldObjectState {
    object: IAdapterObjectName;
    chosenFieldCount: number;
    countText: string;
    countElement: HTMLElement;
    loadedRecords: IUpdaterPreviewObject | null;
}

export interface IUpdaterObjectState extends IUpdaterFieldObjectState {
    object: IAdapterObject;
    element: HTMLElement;
    toggleElement: HTMLButtonElement;
    bodyElement: HTMLElement;
    orgChanges: IAdapterObjectChanges | null;
    orgChangesChipElement: HTMLElement;
    orgOnlyFieldsElement: HTMLElement | null;
    orgOnlyFieldStates: AdapterOrgOnlyRowState[];
    moreNewChildObjectCount?: number;
    objectSearchText: string;
    isBodyBuilt: boolean;
    isExpanded: boolean;
    isExpandedByReader: boolean;
    matchingFieldCount: number;
    recordsElement: HTMLElement | null;
    loadedRecordsLinkSequence?: unknown;
    generatedValues: IUpdaterPreviewObject | null;
    generatedValuesLinkSequence?: unknown;
    valuesElement: HTMLElement | null;
    whereInputElement?: HTMLInputElement;
    fieldStates: IUpdaterRecipeFieldState[];
}

// WHAT A FIELD ROW READS AND WRITES OF ITS CARD; A NEW CHILD'S BLOCK (#447) KEEPS ONE OF ITS OWN, SO NOTHING IN IT TOUCHES THE CARD'S CHOICE
export interface IUpdaterFieldTreeState {
    tree: IAdapterTreeKey;
    updaterChosenFieldKeys: Record<string, true>;
    updaterEditedValues: Record<string, string>;
    updaterObjectStates: IUpdaterObjectState[] | null;
    updaterSummaryElement?: HTMLElement | null;
}

export interface IAdapterChild {
    parentObjectApiName: string;
    childObjectApiName: string;
    lookupFieldApiName: string;
    childTreeState: IUpdaterFieldTreeState;
    fieldStates: IUpdaterFieldRowState[];
    editorElement: HTMLElement;
    countInputElement: HTMLInputElement;
    refusalElement: HTMLElement;
    generateElement: HTMLButtonElement;
    previewElement: HTMLElement;
}

export interface IUpdaterSnapshotButton {
    element: HTMLButtonElement;
    snapshotName: string;
}

/*
    The parts of a tree card's state this tab reads and writes; the script builds the rest. The
    elements are made by buildUpdaterTab, and every function that can run before it checks the
    element it draws on first, as the script did.
*/
export interface IAdapterTreeState extends IUpdaterFieldTreeState {
    tree: IAdapterTree;
    objectStates: IAdapterTreeObjectState[];
    searchQueries: Record<string, string>;
    searchTexts: Record<string, string>;
    updaterCardObjectApiNames: string[];
    updaterStep: string;
    updaterParentObjectApiName: string;
    updaterParentWhereText: string;
    updaterWhereTexts: Record<string, string>;
    updaterExpandedObjectKeys: Record<string, true>;
    updaterRecordsMessage: IUpdaterRecordsMessage | null;
    updaterValuesMessage: IUpdaterValuesMessage | null;
    adapterChangesMessage: IAdapterChangesMessage | null;
    adapterChild: IAdapterChild | null;
    adapterChildBlockMessage: IAdapterChildBlockMessage | null;
    adapterChildPreviewMessage: IAdapterChildPreviewMessage | null;
    isUpdaterSnapshotsWanted?: boolean;
    updaterParentStepElement: HTMLElement;
    updaterStructureStepElement: HTMLElement;
    updaterStructureHeadingElement: HTMLElement;
    updaterParentSelectElement: HTMLSelectElement;
    updaterParentWhereInputElement: HTMLInputElement;
    updaterParentWhereNoteElement: HTMLElement;
    updaterSearch?: ITabSearchView;
    updaterRetrieveMetadataElement?: HTMLButtonElement;
    updaterOrgChangesNoteElement?: HTMLElement;
    updaterApplyRetrievedElement?: HTMLButtonElement;
    updaterOrgHintsElement?: HTMLElement;
    updaterLoadCard: IActionCardView;
    updaterLoadButtonElement?: HTMLButtonElement;
    updaterLoadNoteElement: HTMLElement;
    updaterGenerateCard?: IActionCardView;
    updaterGenerateButtonElement: HTMLButtonElement;
    updaterUpdateCard?: IActionCardView;
    updaterUpdateButtonElement: HTMLButtonElement;
    updaterObjectsElement: HTMLElement;
    updaterSnapshotListElement?: HTMLElement;
    updaterSnapshotButtonElements?: IUpdaterSnapshotButton[];
}

// WHAT THIS TAB POSTS; THE HOST'S ROUTER CHECKS EACH FIELD AGAIN (routePanelMessage)
export interface IUpdaterObjectRequest {
    objectApiName: string;
    fieldApiNames: string[];
    whereClause: string;
}

export interface IUpdaterFieldValueRequest {
    objectApiName: string;
    fieldApiName: string;
    value?: string;
}

export interface IAdapterChildFieldRequest {
    fieldApiName: string;
    value?: string;
}

export type AdapterPanelMessage =
    | { command: 'loadUpdaterRecords'; treeKey: string; renderSequence: number; parentObjectApiName: string; objects: IUpdaterObjectRequest[] }
    | { command: 'generateUpdaterValues'; treeKey: string; renderSequence: number; fields: IUpdaterFieldValueRequest[] }
    | { command: 'updateUpdaterRecords'; treeKey: string }
    | { command: 'loadUpdaterSnapshots'; treeKey: string; renderSequence: number }
    | { command: 'updaterSnapshotsRendered'; renderSequence: number; treeKey: string; snapshotsSequence: unknown }
    | { command: 'restoreUpdaterSnapshot'; treeKey: string; snapshotName: string }
    | { command: 'updaterValuesRendered'; renderSequence: number; valuesSequence: unknown }
    | { command: 'retrieveAdapterMetadata'; treeKey: string; renderSequence: number; parentObjectApiName: string }
    | { command: 'applyAdapterRetrievedFiles'; treeKey: string; renderSequence: unknown }
    | { command: 'prepareAdapterChild'; treeKey: string; renderSequence: number; parentObjectApiName: string; childObjectApiName: string; lookupFieldApiName: string }
    | { command: 'generateAdapterChild'; treeKey: string; renderSequence: number; childObjectApiName: string; countPerParent: number; fields: IAdapterChildFieldRequest[] };
