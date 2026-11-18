import type { RecipeCockpitTodosView, RecipeCockpitTroubleshootingSubTab } from '../../../RecipeCockpitTroubleshootingConstants';
import type { IDataOrgTreeState } from '../dataOrg/DataOrgTypes';
import type { IFieldRowFieldState, IFieldRowObject, IFieldRowObjectState, IFieldRowTreeState } from '../fieldRows/FieldRowTypes';
import type { IRecordTypeObjectState } from '../recordTypes/RecordTypeTypes';
import type { ITroubleshootingTreeState } from '../../troubleshooting/TroubleshootingTypes';

/*
    The shapes the Recipe Cockpit's navigation works on (#656): the tree picker, the Treecipes
    search, nicknames and their menus, friends and the Treecipe tab's filter. A tree card and its
    object rows are still built by the panel script, so these name what navigation reads and writes,
    over the field rows' view of the same objects.
*/

// A LATER OCCURRENCE OF AN OBJECT (#188), AND THE friends: BLOCK IT NESTS UNDER (#411)
export interface INavigationIteration {
    parentObjectApiName?: string;
    parentNickname?: string;
}

export interface INavigationObject extends IFieldRowObject {
    recipeNickname?: string;
    countParentObjectApiName?: unknown;
    parentNickname?: unknown;
    lineNumber?: number;
    fields: Array<{ fieldApiName: string; fieldLabel?: unknown }>;
    iteration?: INavigationIteration & { insertableFriendObjectApiNames?: string[] };
}

// A LIST THAT OPENS ON A LINE OF ITS OWN UNDER THE ROW THAT OPENED IT; BUILT ON FIRST OPEN
export interface IReferenceMenuOwner {
    nicknameMenuElement: HTMLElement | null;
}

export interface IFriendChip {
    label: string;
    parentLabel: string;
    friendNumber: number;
    ownerState: INavigationObjectState | null;
}

export interface IFriend {
    friendState: INavigationObjectState;
    label: string;
}

export interface INavigationObjectState extends IFieldRowObjectState, IReferenceMenuOwner {
    object: INavigationObject;
    treeState: INavigationTreeState;
    isIteration?: boolean;
    isExpandedByReader?: boolean;
    headerElement: HTMLElement;
    toggleElement: HTMLElement;
    countElement: HTMLElement;
    nicknameSlotElement: HTMLElement | null;
    nicknameChipElement: HTMLButtonElement | null;
    friendsButtonElement: HTMLButtonElement | null;
    friendsMenuOwner: IReferenceMenuOwner;
    friendSlotElement: HTMLElement | null;
    friendChipElementsByOwnerState: Map<INavigationObjectState, HTMLElement>;
    friendSearchText: string;
    objectSearchText: string;
    objectTodos: unknown[];
    recordTypeFieldCount: number;
    matchingFieldCount: number;
    hasMatchingObjectTodos: boolean;
    isFilteredByStructure: boolean;
}

export interface INicknameUsage {
    objectState: INavigationObjectState;
    fieldState: IFieldRowFieldState;
}

// ONE CARD'S NICKNAMES (#380): THE ONE ROW HOLDING EACH, AND THE FIELDS POINTING TO IT; KEYED BY NAMES FROM FILES, SO NO PROTOTYPE
export interface INicknameIndex {
    ownerStateByKey: Record<string, INavigationObjectState>;
    usagesByKey: Record<string, INicknameUsage[]>;
}

export interface IFriendIndex {
    chipsByObjectState: Map<INavigationObjectState, IFriendChip[]>;
    friendsByOwnerState: Map<INavigationObjectState, IFriend[]>;
}

export interface IStructureSearch {
    inputElement: HTMLInputElement;
    matchCountElement: HTMLElement;
}

export interface INavigationTree {
    treeKey: string;
    title: string;
    customName?: string;
    folderName?: string;
    isFavorite?: boolean;
    objects: Array<{ objectApiName: string; iterationNickname?: string }>;
}

export interface INavigationTreeState extends IFieldRowTreeState {
    objectStates: INavigationObjectState[];
    element: HTMLElement;
    bodyElement: HTMLElement;
    isExpanded?: boolean;
    nicknameIndex?: INicknameIndex;
    friendIndex?: IFriendIndex;
    searchTexts: Record<string, string>;
    structureSearch?: IStructureSearch;
    recordTypeObjectStates?: IRecordTypeObjectState[];
}

/*
    Every tab's module is handed its own view of a card's state, and the script builds ONE object
    per card that is all of them. A module that reaches navigation passes its view; navigation
    widens it here, in one place, rather than every caller naming the whole.
*/
export interface ITreeStateView {
    tree: { treeKey: string };
    objectStates: unknown[];
}

export interface ITreeObjectStateView {
    object: { objectApiName: string };
}

export function asNavigationTreeState(treeStateView: ITreeStateView): INavigationTreeState {
    return treeStateView as unknown as INavigationTreeState;
}

export function asNavigationObjectState(treeObjectStateView: ITreeObjectStateView): INavigationObjectState {
    return treeObjectStateView as unknown as INavigationObjectState;
}

// ONE TREE STATE OBJECT IS EVERY TAB'S VIEW AT ONCE: THE SCRIPT BUILDS IT, EACH MODULE NAMES THE PART IT READS
export type ScriptTreeState = INavigationTreeState & ITroubleshootingTreeState & IDataOrgTreeState & { tree: INavigationTree };

export interface ITreecipesSearchEntry {
    kind: 'treecipe' | 'object' | 'field' | 'recordType';
    text: string;
    haystack: string;
    objectApiName?: string;
    fieldApiName?: string;
    qualifiedHaystack?: string;
}

export interface ITreecipesSearchTree {
    treeState: ScriptTreeState;
    entries: ITreecipesSearchEntry[];
}

export interface ITreecipesSearch {
    element: HTMLElement;
    inputElement: HTMLInputElement;
    matchCountElement: HTMLElement;
    resultsElement: HTMLElement;
}

export interface IReferenceMenuEntry {
    label: string;
    choose: () => void;
}

export interface IOpenReferenceMenu {
    menuOwner: IReferenceMenuOwner;
    menuElement: HTMLElement;
    itemElements: HTMLButtonElement[];
    entries: IReferenceMenuEntry[];
    openerOf: () => HTMLElement | null;
}

// WHERE A RELOAD OR A FAILED INSERT'S LINK ASKS THE PANEL TO RE-OPEN; THE HOST'S, READ AS UNTRUSTED
export interface IFocusTree {
    treeKey: string;
    tab: string;
    troubleshootingSubTab?: RecipeCockpitTroubleshootingSubTab;
    todosView?: RecipeCockpitTodosView;
    recordTypes?: { objectApiName?: string };
}
