import type { RecipeCockpitCreateParentRefusalReason } from '../../../RecipeCockpitTreecipeFieldEditorConstants';
import type { IFieldRowTreeObject, ISelectionTree } from '../fieldRows/FieldRowTypes';

/*
    The shapes the Treecipe tab's field editor, picklist tiles and lookup wiring work on (#653). A
    tree card and its object rows are built by the card (treecipe/card/, #657), one object per row
    that is every tab's view, so these interfaces name only what these modules read and write. A tree, object and field come from
    the posted model (IRecipeCockpitTreeViewModel and the view models it holds).
*/

export interface ITreecipeField {
    fieldApiName: string;
    fieldType: string;
    fieldTypeWithSize?: string;
    controllingField?: string;
    recipeValue?: string;
    isPicklist?: boolean;
    lineNumber?: number;
    todos?: unknown[];
}

export interface ITreecipeObject {
    objectApiName: string;
    nickname?: string;
    iteration?: { insertableFriendObjectApiNames?: string[] };
}

export interface ILookupWiring {
    objectApiName: string;
    objectNickname?: string;
    fieldApiName: string;
    candidateNicknames: string[];
}

export interface IAddableParent {
    objectApiName: string;
    objectNickname?: string;
    fieldApiName: string;
    parentObjectApiName: string;
}

export interface IEmptyLookup {
    objectApiName: string;
    objectNickname?: string;
    fieldApiName: string;
    parentObjectApiName: string;
    createRefusalReason?: RecipeCockpitCreateParentRefusalReason;
    orgRecordRefusal?: string;
}

export interface ITreecipeTree extends ISelectionTree {
    treeKey: string;
    objects: IFieldRowTreeObject[];
    lookupWirings?: ILookupWiring[];
    addableParents?: IAddableParent[];
    emptyLookups?: IEmptyLookup[];
}

// AN EMPTY LOOKUP'S TWO BUTTONS (#421), AND WHY EACH IS DISABLED: THE HOST'S REASON, OR THE CARD'S SELECTION
export interface ILookupDecision {
    element: HTMLElement;
    createParentElement: HTMLButtonElement;
    useOrgRecordElement: HTMLButtonElement;
    emptyLookup: IEmptyLookup;
    createReason: string;
    useReason: string;
    selectionReason?: string;
}

// ONE FIELD ROW'S STATE; buildTreeFieldState FILLS EVERY KEY, buildTreeFieldRow (fieldRows/FieldRow.ts) SETS THE ELEMENTS
export interface ITreeFieldState {
    field: ITreecipeField;
    typeSearchText: string;
    isMatch: boolean;
    rowElement: HTMLElement | null;
    isPicklistExpanded: boolean;
    includeElement: HTMLButtonElement | null;
    noteElement: HTMLElement | null;
    isIncluded: boolean;
    fixedValueButtonElement: HTMLButtonElement | null;
    fixedValueBadgeElement: HTMLElement | null;
    fixedValueElement: HTMLElement | null;
    expressionElement: HTMLElement | null;
    // "Test faker value" (#718): SET ONLY ON A ROW THAT DRAWS THE BUTTON
    fakerValueTestElement: HTMLButtonElement | null;
    fakerValueExampleElement: HTMLElement | null;
    picklistSectionElement: HTMLElement | null;
    validationRuleElement: HTMLElement | null;
    isValidationRuleApplied: boolean;
    recordTypeDeveloperNames: string[] | null;
    todos: unknown[];
    editorElement: HTMLElement | null;
    editorEdit: string;
    editorRefusalElement: HTMLElement | null;
    setPicklistExpanded: ((isExpanded: boolean) => void) | null;
    picklistRefusalElement: HTMLElement | null;
    endPicklistSave: (() => void) | null;
    lookupDecision?: ILookupDecision;
}

export interface ITreeObjectState {
    tree: ITreecipeTree;
    object: ITreecipeObject;
    fieldStates: ITreeFieldState[];
    canSelectFields: boolean;
}

export interface ITreeState {
    tree: ITreecipeTree;
    objectStates: ITreeObjectState[];
}

// WHAT THESE MODULES POST, ONE SHAPE PER COMMAND; THE HOST'S ROUTER CHECKS EACH FIELD AGAIN (routePanelMessage)
export interface ISetFieldFixedValueMessage {
    command: 'setFieldFixedValue';
    treeKey: string;
    objectApiName: string;
    fieldApiName: string;
    nickname?: string;
    value: string;
}

export interface ILoadPicklistValuesMessage {
    command: 'loadPicklistValues';
    objectApiName: string;
    fieldApiName: string;
    treeKey: string;
    nickname?: string;
}

export interface ISetPicklistValueChoiceMessage {
    command: 'setPicklistValueChoice';
    treeKey: string;
    objectApiName: string;
    fieldApiName: string;
    picklistValues: unknown[];
    nickname?: string;
}

export interface IResetPicklistValueChoiceMessage {
    command: 'resetPicklistValueChoice';
    treeKey: string;
    objectApiName: string;
    fieldApiName: string;
    nickname?: string;
}

export interface IAddIterationFriendMessage {
    command: 'addIterationFriend';
    treeKey: string;
    objectApiName: string;
    objectNickname: string | undefined;
    friendObjectApiName: string;
}

// "Wire to…", "Create <Parent> in recipe" AND "Use existing <Parent> from org…" POST THE SAME NAMES
export interface ILookupDecisionMessage {
    command: 'wireLookup' | 'addParentObject' | 'useOrgRecordForLookup';
    treeKey: string;
    objectApiName: string;
    fieldApiName: string;
    objectNickname?: string;
}

export interface IWireAllLookupsMessage {
    command: 'wireAllLookups';
    treeKey: string;
}

export type FieldEditorPanelMessage =
    | ISetFieldFixedValueMessage
    | ILoadPicklistValuesMessage
    | ISetPicklistValueChoiceMessage
    | IResetPicklistValueChoiceMessage
    | IAddIterationFriendMessage
    | ILookupDecisionMessage
    | IWireAllLookupsMessage;

// WHAT THE HOST POSTS (IRecipeCockpitFieldEditResultMessage, IRecipeCockpitPicklistValuesMessage), READ AS UNTRUSTED
export interface IFieldEditResultMessage {
    renderSequence?: unknown;
    edit?: unknown;
    treeKey?: unknown;
    objectApiName?: unknown;
    fieldApiName?: unknown;
    refusal?: unknown;
}

export interface IPicklistValuesMessage {
    renderSequence?: unknown;
    treeKey?: unknown;
    objectApiName?: unknown;
    fieldApiName?: unknown;
    nickname?: unknown;
    picklistValues?: unknown;
    chosenPicklistValues?: unknown;
    isOtherEdit?: unknown;
    isEdited?: unknown;
    recordTypePicklistValues?: unknown;
}

export type PicklistValuesCallback = (picklistValuesMessage: IPicklistValuesMessage) => void;
