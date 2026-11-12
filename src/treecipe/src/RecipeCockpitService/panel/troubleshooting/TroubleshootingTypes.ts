import type { IActionCardView, ITabSearchView } from '../RecipeCockpitPanelBuilders';
import type { MetadataDeployKind, MetadataRetrieveKind, RecipeCockpitHistorySortColumn, RecipeCockpitTodosView, RecipeCockpitTroubleshootingSubTab } from '../../RecipeCockpitTroubleshootingConstants';

/*
    The shapes the Troubleshooting tab's panel modules work on (#639). A tree card's state is built by
    the panel script, which is not type checked yet, so ITroubleshootingTreeState names only what
    these modules read and write on it. What the host posts is typed as the host sends it.
*/

// THE PARTS OF A TREE'S MODEL THE TAB READS
export interface ITroubleshootingTree {
    treeKey: string;
    objects: unknown[];
    runFakerRecipeFileName?: string;
    removedTodos?: unknown;
}

export interface IRecipeTodo {
    text?: string;
    lineNumber?: number;
    removeLock?: string;
    valueStart?: number;
    valueLength?: number;
}

export interface ITodoTreeObject {
    objectApiName: string;
    nickname?: string;
    iteration?: unknown;
    iterations?: unknown;
    recipeFilePath?: string;
}

export interface ITodoTreeObjectState {
    object: ITodoTreeObject;
    todoCount: number;
    objectTodos: IRecipeTodo[];
    fieldStates: Array<{ field: { fieldApiName: string; recipeValue?: unknown }; todos: IRecipeTodo[] }>;
}

export interface IRemovedTodo {
    objectApiName: string;
    objectNickname?: string;
    fieldApiName?: string;
    text: string;
    removalKey: string;
}

// WHAT A SEARCH SHOWS OR HIDES: ITS LAST VISIBILITY IS KEPT, SO ONLY A CHANGE IS WRITTEN
export interface IShownState {
    isShown?: boolean;
}

export interface IActionItem extends IShownState {
    element: HTMLElement;
}

export interface ITodoEntry extends IShownState {
    fieldLabel: string;
    todo: IRecipeTodo;
    todoText: string;
    isFieldTodo: boolean;
    removeReason: string;
    searchText: string;
    isMatch: boolean;
    element: HTMLElement | null;
}

export interface ITodoGroupState extends IShownState {
    object: ITodoTreeObject;
    treeState: ITroubleshootingTreeState;
    element: HTMLElement | null;
    toggleElement: HTMLElement | null;
    countElement: HTMLElement;
    bodyElement: HTMLElement;
    entries: ITodoEntry[];
    matchingCount: number;
    isBuilt: boolean;
    isExpanded: boolean;
}

export interface IRemovedTodoEntry extends IShownState {
    searchText: string;
    isMatch: boolean;
    element: HTMLElement;
}

export interface IRemovedTodoGroupState extends IShownState {
    element: HTMLElement;
    countElement: HTMLElement;
    bodyElement: HTMLElement;
    entries: IRemovedTodoEntry[];
    matchingCount: number;
}

export interface ITodosViewState {
    tabElement: HTMLButtonElement;
    panelElement: HTMLElement;
}

export interface ITodosFrame {
    stripElement: HTMLElement;
    viewStates: Record<RecipeCockpitTodosView, ITodosViewState>;
}

export interface IValidationRule {
    ruleName: unknown;
    status: unknown;
    isActive?: unknown;
    errorMessage?: unknown;
    formula?: unknown;
    fieldApiNames?: unknown;
    reasons?: unknown;
    isFileMissing?: unknown;
}

export interface IValidationRuleEntry extends IShownState {
    rule: IValidationRule;
    ruleName: string;
    statusLabel: string;
    activeLabel: string;
    messageText: string;
    fieldsText: string;
    reasonTexts: string[];
    hasFormula: boolean;
    isFormulaExpanded: boolean;
    formulaElement: HTMLElement | null;
    searchText: string;
    isMatch: boolean;
    element: HTMLElement | null;
    isSourceOpenable?: boolean;
}

export interface IValidationRuleGroupState extends IShownState {
    objectApiName: string;
    element: HTMLElement | null;
    toggleElement: HTMLElement | null;
    countElement: HTMLElement;
    bodyElement: HTMLElement;
    entries: IValidationRuleEntry[];
    matchingCount: number;
    isBuilt: boolean;
    isExpanded: boolean;
}

export interface IHistoryFile {
    fileName: unknown;
    fileIndex: unknown;
}

export interface IHistoryRow {
    status: unknown;
    timeMs?: unknown;
    timeLabel: unknown;
    finishedAtLabel?: unknown;
    stepLabel: unknown;
    orgLabel?: unknown;
    orgUsername?: unknown;
    runFolderName?: unknown;
    succeededCount?: unknown;
    failedCount?: unknown;
    detail?: unknown;
    files?: unknown;
}

export interface IHistoryRowState extends IShownState {
    row: IHistoryRow;
    element: HTMLElement;
    searchText: string;
}

export interface IHistorySort {
    column: RecipeCockpitHistorySortColumn;
    isDescending: boolean;
}

export interface ITroubleshootingSubTabState {
    subTab: RecipeCockpitTroubleshootingSubTab;
    tabElement: HTMLButtonElement;
    panelElement: HTMLElement;
    search: ITabSearchView;
    listElement: HTMLElement;
    items: IActionItem[];
    noun: [string, string];
    todosFrame: ITodosFrame | null;
    cardGridElement?: HTMLElement;
    groupGridElement?: HTMLElement;
    todoGroups?: ITodoGroupState[];
    removedSearch?: ITabSearchView;
    removedListElement?: HTMLElement;
    removedGroups?: IRemovedTodoGroupState[];
    removedEntries?: IRemovedTodoEntry[];
    ruleGroups?: IValidationRuleGroupState[];
    historyRows?: IHistoryRowState[];
}

// WHAT THE HOST COUNTED IN THE PROJECT FOR THE TREE'S DEPLOYS AND RETRIEVES (loadTroubleshootingSummary)
export interface ITroubleshootingSummaryMessage {
    renderSequence?: unknown;
    treeKey?: unknown;
    failureMessage?: string;
    permissionSetCount: number;
    standardFieldCount: number;
    unreadableFieldCount: number;
    customFieldCount: number;
    customObjectCount: number;
    missingCustomObjectCount?: number;
    unreadableCustomObjectCount?: number;
    globalValueSetCount: number;
    missingGlobalValueSetCount: number;
    recordTypeCount: number;
}

export interface IValidationRulesMessage {
    renderSequence?: unknown;
    treeKey?: unknown;
    listSequence?: unknown;
    failureMessage?: unknown;
    objects?: unknown;
    openableRules?: unknown;
}

export interface ITroubleshootingHistoryMessage {
    renderSequence?: unknown;
    treeKey?: unknown;
    historySequence?: unknown;
    rows?: unknown;
    hiddenRowCount?: unknown;
}

export interface ITroubleshootingTreeState {
    tree: ITroubleshootingTree;
    objectStates: ITodoTreeObjectState[];
    searchTexts: Record<string, string>;
    searchQueries: Record<string, string>;
    troubleshootingSubTab?: RecipeCockpitTroubleshootingSubTab;
    troubleshootingStripElement?: HTMLElement;
    troubleshootingSubTabStates?: ITroubleshootingSubTabState[];
    troubleshootingSummary?: ITroubleshootingSummaryMessage;
    isTroubleshootingSummaryWanted?: boolean;
    todosView?: RecipeCockpitTodosView;
    deployCards?: Partial<Record<MetadataDeployKind, IActionCardView>>;
    retrieveCards?: Partial<Record<MetadataRetrieveKind, IActionCardView>>;
    permissionSetCard?: IActionCardView;
    generatePermissionSetCard?: IActionCardView;
    validationRuleSubTabState?: ITroubleshootingSubTabState;
    validationRuleListElement?: HTMLElement;
    isValidationRulesRequested?: boolean;
    historySubTabState?: ITroubleshootingSubTabState;
    historyListElement?: HTMLElement;
    historySort?: IHistorySort;
    historyMessage?: ITroubleshootingHistoryMessage;
    isHistoryRequested?: boolean;
    historySortButtons?: Record<string, HTMLButtonElement>;
    historyBodyElement?: HTMLElement;
}
