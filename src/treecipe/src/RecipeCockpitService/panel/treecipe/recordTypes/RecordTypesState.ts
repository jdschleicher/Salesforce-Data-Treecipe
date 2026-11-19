import type { RecordTypeFieldsIndex } from './RecordTypeFieldsToggle';
import type { IRecordTypeObject, IRecordTypeRowState } from './RecordTypeTypes';

/*
    The Record types section's choice (#195) is the PANEL's, per object and shared by every card
    that lists the object: object api name -> developer names, in the order ticked, starting from
    what the run on screen generates. It is what the next "Generate fake data and insert" uses
    (#623). Keyed by names from files, so no prototype. All of it belongs to one model, and
    resetRecordTypesState empties it before the next is drawn.
*/
export const recordTypesState = {
    recordTypeChoices: Object.create(null) as Record<string, string[]>,
    recordTypeObjects: [] as IRecordTypeObject[],
    recordTypeRowStates: [] as IRecordTypeRowState[],
    // THE FIELDS EACH OBJECT'S RECORD TYPES RESTRICT (#320), INDEXED BY indexRecordTypeFields FOR EVERY MODEL
    recordTypeFieldsByObjectApiName: Object.create(null) as RecordTypeFieldsIndex,
    // "Remember this selection" (#196): PANEL-WIDE LIKE THE CHOICE, UNTICKED BY DEFAULT AND AGAIN WITH EVERY MODEL
    isRecordTypeSelectionRemembered: false,
    recordTypeRememberElements: [] as HTMLButtonElement[]
};

export function resetRecordTypesState(): void {

    recordTypesState.recordTypeChoices = Object.create(null);
    recordTypesState.recordTypeObjects = [];
    recordTypesState.recordTypeFieldsByObjectApiName = Object.create(null);
    recordTypesState.recordTypeRowStates = [];
    recordTypesState.isRecordTypeSelectionRemembered = false;
    recordTypesState.recordTypeRememberElements = [];

}
