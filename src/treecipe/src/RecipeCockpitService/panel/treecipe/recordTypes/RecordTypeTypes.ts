/*
    The shapes the Record types section and the Treecipe tab's toggles work on (#652). A tree card's
    state is built by the panel script, which is not type checked yet, so these name only what the
    modules read and write on it. An object and its record types come from the posted model.
*/
import type { RecipeCockpitRecordTypeImpactKind } from '../../../RecipeCockpitRecordTypesConstants';

export interface IRecordTypeImpact {
    kind: RecipeCockpitRecordTypeImpactKind;
    fieldApiName: string;
    valueCount: number;
}

export interface IRecordType {
    developerName: string;
    isActive: boolean;
    impacts: IRecordTypeImpact[];
}

export interface IRecordTypeObject {
    objectApiName: string;
    recordTypes: IRecordType[];
    generatedRecordTypeDeveloperNames?: string[];
    isRecordTypeSelectionApplied?: boolean;
}

// A FIELD'S OR AN OBJECT'S TODO COMMENT (#354); A TODO WITH NO TEXT IS IN THE VALUE THE ROW ALREADY DRAWS
export interface IRecipeTodo {
    text?: string;
    lineNumber: number;
}

export interface IRecordTypesSection {
    toggleElement: HTMLButtonElement;
    bodyElement: HTMLElement;
    summaryElement: HTMLElement;
    isBuilt: boolean;
}

export interface IRecordTypeObjectState {
    object: IRecordTypeObject;
    element: HTMLElement;
    statusElement: HTMLElement;
    searchText: string;
}

// ONE RECORD TYPE'S BOX; THE SCRIPT EMPTIES THE LIST FOR EVERY NEW MODEL
export interface IRecordTypeRowState {
    objectApiName: string;
    developerName: string;
    checkboxElement: HTMLButtonElement;
}

// THE PARTS OF ONE OF THE TREECIPE TAB'S OBJECT STATES THESE MODULES READ AND WRITE
export interface IRecordTypesTreeObjectState {
    object: IRecordTypeObject;
    treeState: IRecordTypesTreeState;
    isIteration?: boolean;
    hasRecordTypes?: boolean;
    todoCount: number;
    isTodosOnly?: boolean;
    todosToggleElement?: HTMLButtonElement;
}

// THE PARTS OF A TREE CARD'S STATE THESE MODULES READ AND WRITE; THE SCRIPT BUILDS THE REST
export interface IRecordTypesTreeState {
    tree: { treeKey: string };
    objectStates: IRecordTypesTreeObjectState[];
    searchQueries: Record<string, string>;
    structureSearch?: unknown;
    hasRecordTypeObjects?: boolean;
    isRecordTypeFieldsOnly?: boolean;
    recordTypeFieldsToggleElement?: HTMLButtonElement;
    todoCount?: number;
    isTodosOnly?: boolean;
    todosToggleElement?: HTMLButtonElement;
    listedRecordTypeObjects?: IRecordTypeObject[];
    recordTypesSection?: IRecordTypesSection;
    isRecordTypesExpanded?: boolean;
    recordTypeObjectStates?: IRecordTypeObjectState[];
}
