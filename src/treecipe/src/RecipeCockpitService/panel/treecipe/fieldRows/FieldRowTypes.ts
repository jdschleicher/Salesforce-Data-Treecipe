import type { IObjectSelection } from '../../../RecipeCockpitObjectSelection';
import type { ITreeFieldState, ITreeObjectState, ITreeState, ITreecipeField, ITreecipeObject, ITreecipeTree } from '../fieldEditor/FieldEditorTypes';
import type { IRecipeTodo, IRecordTypeObject, IRecordTypesTreeObjectState, IRecordTypesTreeState } from '../recordTypes/RecordTypeTypes';

/*
    The shapes the Treecipe tab's field rows and the object/field selection cascade work on (#655).
    A tree card and its object rows are still built by the panel script, so these name only what
    these modules read and write, over the views the field editor and the Record types section
    already declare. The selections come from the host (IRecipeCockpitTreeViewModel): the panel
    draws them, and never decides one.
*/

export interface IObjectFieldSelectionPost {
    objectApiName: string;
    nickname?: string;
    excludedFieldApiNames?: string[];
    lockedFields?: Array<{ fieldApiName: string; reason: unknown }>;
    isEveryFieldExcluded?: boolean;
}

export interface IFieldSelection {
    objects: IObjectFieldSelectionPost[];
}

// ONE OCCURRENCE'S FIELD SELECTION, INDEXED ONCE PER POSTED SELECTION; KEYED BY NAMES FROM DISK, SO NO PROTOTYPE
export interface IObjectFieldSelection {
    excludedFieldApiNames: Record<string, true>;
    lockReasonsByFieldApiName: Record<string, string>;
    excludedFieldCount: number;
    isEveryFieldExcluded: boolean;
}

export interface IFieldReference {
    objectApiName: string;
    nickname?: string;
    fieldApiName: string;
}

export interface IFixedValueOrgRecord {
    orgLabel: string;
    parentObjectApiName: string;
}

export interface IFixedValue extends IFieldReference {
    value: unknown;
    orgRecord?: IFixedValueOrgRecord;
}

// AN INCLUDED OBJECT WHOSE LOOKUPS TO AN EXCLUDED PARENT ARE DISABLED (#449)
export interface IObjectImpact {
    parentObjectApiNames: string[];
    fieldApiNames: string[];
}

// WHAT THE CASCADE READS FROM A CARD; THE ADAPTER AND THE TREE INSERT HAND IN THEIR OWN VIEW OF THE SAME TREE
export interface ISelectionTree {
    treeKey: string;
    objectSelection?: IObjectSelection;
    fieldSelection?: IFieldSelection;
    fixedValues?: IFixedValue[];
    validationRulesOff?: IFieldReference[];
    objectCounts?: unknown[];
}

export interface IParentLookup {
    fieldApiName: string;
    parentObjectApiName: string;
}

export interface IFieldRowTreeObject {
    objectApiName: string;
    parentLookups: IParentLookup[];
}

export interface IFieldValidationRules {
    appliedRuleNames: string[];
    notAppliedRules: Array<{ ruleName: string; reason: string }>;
    unconstrainedExpression?: string;
    sourceRuleNames?: string[];
}

export interface IFieldRowField extends ITreecipeField {
    fieldLabel?: string;
    controllingField?: string;
    recipeValue?: string;
    isOnlyInRecipeFile?: boolean;
    validationRules?: IFieldValidationRules;
}

export interface IFieldRowObject extends ITreecipeObject, IRecordTypeObject {
    iterations?: unknown[];
    hasIndistinctOccurrences?: boolean;
    recipeFilePath?: string;
}

export interface IFieldRowFieldState extends ITreeFieldState {
    field: IFieldRowField;
    todos: IRecipeTodo[];
}

export type FieldScopeCheckedState = 'true' | 'false' | 'mixed' | null;

export interface IFieldRowObjectState extends ITreeObjectState, IRecordTypesTreeObjectState {
    tree: ITreecipeTree;
    object: IFieldRowObject;
    fieldStates: IFieldRowFieldState[];
    treeState: IFieldRowTreeState;
    treeObject: IFieldRowTreeObject;
    element: HTMLElement;
    exclusionElement: HTMLElement;
    lookupsElement: HTMLElement;
    headerDetailElements: HTMLElement[];
    noFieldsSelectedElement: HTMLElement;
    countButtonElement?: HTMLElement | null;
    includeElement?: HTMLButtonElement;
    glyphElement?: SVGSVGElement;
    glyphPathElement?: SVGPathElement;
    isIncluded?: boolean;
    isBodyBuilt?: boolean;
    isHidingUnselected?: boolean;
    selectAllRowElement?: HTMLElement;
    selectAllCheckElement?: HTMLElement;
    selectAllElement?: HTMLButtonElement;
    selectStandardCheckElement?: HTMLElement;
    selectStandardElement?: HTMLButtonElement;
    selectAllCheckedState?: FieldScopeCheckedState;
    selectStandardCheckedState?: FieldScopeCheckedState;
    hideUnselectedCheckElement?: HTMLElement;
    hideUnselectedLabelElement?: HTMLElement;
    hideUnselectedToggleElement?: HTMLButtonElement;
}

export interface IFieldRowTreeState extends ITreeState, IRecordTypesTreeState {
    tree: ITreecipeTree;
    objectStates: IFieldRowObjectState[];
    countElement?: HTMLElement | null;
    countedObjectCount: number;
    countedFieldCount: number;
    resetSelectionElement?: HTMLElement | null;
    selectedTab?: string;
}

// WHY "Hide unselected" IS OFF, OR '' WITH HOW MANY ROWS IT HIDES
export interface IHideUnselectedState {
    reason: string;
    unselectedCount: number;
}

// WHAT THESE MODULES POST, ONE SHAPE PER COMMAND; THE HOST'S ROUTER CHECKS EACH FIELD AGAIN (routePanelMessage)
export interface ISetObjectIncludedMessage {
    command: 'setObjectIncluded';
    treeKey: string;
    objectApiName: string;
    included: boolean;
    nickname?: string;
}

export interface ISetFieldIncludedMessage {
    command: 'setFieldIncluded';
    treeKey: string;
    objectApiName: string;
    fieldApiName: string;
    included: boolean;
    nickname?: string;
}

export interface ISetAllFieldsIncludedMessage {
    command: 'setAllFieldsIncluded';
    treeKey: string;
    objectApiName: string;
    included: boolean;
    nickname?: string;
    fieldScope?: string;
}

export interface ISetFieldValidationRuleAppliedMessage {
    command: 'setFieldValidationRuleApplied';
    treeKey: string;
    objectApiName: string;
    fieldApiName: string;
    applied: boolean;
    nickname?: string;
}

export type FieldRowsPanelMessage = ISetObjectIncludedMessage | ISetFieldIncludedMessage | ISetAllFieldsIncludedMessage | ISetFieldValidationRuleAppliedMessage;

// THE HOST'S ANSWER TO A SELECTION CHANGE, FOR THE MODEL IT NAMES
export interface IObjectSelectionMessage {
    renderSequence: unknown;
    treeKey: unknown;
    objectSelection?: IObjectSelection;
    fieldSelection?: IFieldSelection;
    objectCounts?: unknown[];
    fixedValues?: IFixedValue[];
    validationRulesOff?: IFieldReference[];
}
