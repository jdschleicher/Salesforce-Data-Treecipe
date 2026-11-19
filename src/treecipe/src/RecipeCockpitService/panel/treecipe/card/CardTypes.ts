import type { IAdapterTreeObjectState, IAdapterTreeState } from '../../adapter/AdapterTypes';
import type { IDatasetsTreeState } from '../../datasets/DatasetTypes';
import type { IQueryTreeState } from '../../query/QueryTab';
import type { ITodoTreeObjectState } from '../../troubleshooting/TroubleshootingTypes';
import type { IInsertTreeObjectState } from '../dataOrg/DataOrgTypes';
import type { IFieldRowFieldState, IFieldRowTreeObject } from '../fieldRows/FieldRowTypes';
import type { INavigationObjectState, ITreeObjectStateView, ITreeStateView, ScriptTreeState } from '../navigation/NavigationTypes';
import type { IDataset } from '../../datasets/DatasetTypes';
import type { IRecordTypesTreeObjectState } from '../recordTypes/RecordTypeTypes';

/*
    A tree card and its object rows (#657). The card builds ONE state object per card, and one per
    object row, that is every tab's view at once: each tab's module names the part it reads and
    writes (IDataOrgTreeState, IAdapterTreeState …), and the card is all of them. The shell's own
    parts come first, so iterating a card's rows gives the whole row.
*/

// WHAT THE HOST POSTS: ONE RUN'S MODEL (IRecipeCockpitViewModel). EVERY VALUE IS DRAWN WITH textContent
export interface ICardRun {
    runFolderName: string;
    label: string;
}

export interface ICardIterationField {
    fieldApiName: string;
    lineNumber?: number;
    recipeValue?: string;
    todos?: unknown;
}

export interface ICardIteration {
    nickname: string;
    lineNumber?: number;
    recordCount?: unknown;
    parentObjectApiName?: string;
    parentNickname?: string;
    fields: ICardIterationField[];
    todos?: unknown;
    insertableFriendObjectApiNames?: string[];
}

export interface ICardField {
    fieldApiName: string;
    fieldLabel?: string;
    fieldType: string;
    fieldTypeWithSize?: string;
    recipeValue?: string;
    controllingField?: string;
    isOnlyInRecipeFile?: boolean;
    lineNumber?: number;
    todos?: unknown[];
    isPicklist?: boolean;
}

export interface ICardObject {
    objectApiName: string;
    recipeFilePath?: string;
    lineNumber?: number;
    nickname?: string;
    recordCount?: number;
    countParentObjectApiName?: string;
    hasIndistinctOccurrences?: boolean;
    hasRecordTypeSections?: boolean;
    fields: ICardField[];
    todos?: unknown[];
    iteration?: ICardIteration;
    iterations?: ICardIteration[];
    recordTypes?: unknown[];
    generatedRecordTypeDeveloperNames?: string[];
}

export interface ICardTreeObject extends IFieldRowTreeObject {
    nestingDepth?: number;
}

export interface ICardVersion {
    runFolderName: string;
    isCurrent?: boolean;
    generatedAtLabel?: string;
}

export interface ICardTree {
    treeKey: string;
    title: string;
    folderName?: string;
    customName?: string;
    isFavorite?: boolean;
    runFakerRecipeFileName?: string;
    objects: ICardTreeObject[];
    // THE COUNTS THE READER SET (#255), AS THE HOST LAST POSTED THEM
    objectCounts?: unknown[];
    history?: { versions?: ICardVersion[]; datasets: IDataset[] };
}

export interface ICardModel {
    runs: ICardRun[];
    selectedRunFolderName: string;
    objects: ICardObject[];
    trees?: ICardTree[];
    notices: string[];
    emptyStateMessage: string;
}

// THE INLINE NAME EDITOR (#551), OF A CARD OR A DATA SET ROW
export interface INameEditorOptions {
    nameTarget: 'tree' | 'dataset';
    nameKey: string;
    maxLength: number;
    openerElement: HTMLElement;
    displayElement: HTMLElement;
    placeholderText: string;
    readCustomName: () => string;
    readDisplayName: () => string;
    onClose: () => void;
}

export interface INameEditorState extends INameEditorOptions {
    element: HTMLElement | null;
    inputElement: HTMLInputElement | null;
    refusalElement: HTMLElement | null;
    isOpen: boolean;
    postedName: string | null;
}

export interface ICardTabState {
    tabName: string;
    tabElement: HTMLButtonElement;
    panelElement: HTMLElement;
    isBuilt: boolean;
}

// WHAT THE CARD ITSELF DRAWS ON AN OBJECT ROW: ITS ▸, ITS BODY AND ITS RECORD COUNT BOX (#255)
export interface ICardShellObjectState {
    object: ICardObject;
    fieldStates: IFieldRowFieldState[];
    treeState: CardTreeState;
    tree: ICardTree;
    isExpanded: boolean;
    bodyElement: HTMLElement;
    recordCountElement: HTMLElement | null;
    countButtonElement: HTMLButtonElement | null;
    countValueElement: HTMLElement | null;
    countChangedElement: HTMLElement | null;
    countLabelElement: HTMLElement | null;
    countInputElement: HTMLInputElement | null;
    countErrorElement: HTMLElement | null;
    countDrawnKey: string | null;
    isCountEditorOpen: boolean;
}

export type CardObjectState = ICardShellObjectState & INavigationObjectState & IRecordTypesTreeObjectState
    & IInsertTreeObjectState & ITodoTreeObjectState & IAdapterTreeObjectState;

// WHAT THE CARD ITSELF DRAWS: ITS HEADER, NAME, STAR AND COUNT, AND ITS TAB STRIP
export interface ICardShellTreeState {
    tree: ICardTree;
    objectStates: CardObjectState[];
    isBodyBuilt: boolean;
    isExpanded: boolean;
    tabsElement: HTMLElement;
    tabStates: ICardTabState[];
    selectedTab: string;
    favoriteElement?: HTMLButtonElement;
    renameElement?: HTMLButtonElement;
    titleElement: HTMLElement;
    folderElement: HTMLElement | null;
    nameEditor: INameEditorState | null;
}

export type CardTreeState = ICardShellTreeState & ScriptTreeState & IDatasetsTreeState & IAdapterTreeState & IQueryTreeState;

/*
    A tab's module hands the card its own view of a card's state; the card widens it here, in one
    place, since the object behind every view is the one the card built.
*/
export function asCardTreeState(treeStateView: ITreeStateView): CardTreeState {
    return treeStateView as unknown as CardTreeState;
}

export function asCardObjectState(treeObjectStateView: ITreeObjectStateView): CardObjectState {
    return treeObjectStateView as unknown as CardObjectState;
}
