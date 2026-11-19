import type { IDataOrgPickerBeforeCheck, IDataOrgReadiness, IDataOrgView } from './DataOrgTypes';

/*
    The org picker is ONE panel-wide selection (#255) drawn at the top of every card's Treecipe tab:
    each built tab holds a view of it, and every change is drawn into all of them from the state
    below, so a tab built later draws the picker as it stands. Everything but isDataOrgPickerInUse
    belongs to one model, and resetDataOrgPickerState empties it before the next is drawn.
*/
export const dataOrgPicker = {
    // WHETHER THE READER HAS USED THE ORG PICKER; IT OUTLIVES A MODEL, SO A RELOAD CHECKS THE SAME ORG AGAIN
    isDataOrgPickerInUse: false,
    dataOrgViews: [] as IDataOrgView[],
    dataOrgLabels: null as string[] | null,
    isDataOrgLoadShown: true,
    isDataOrgSelectShown: false,
    isDataOrgRefreshShown: false,
    /*
        WHILE THE CONNECTIONS ARE CHECKED (#305) THE PICKER STAYS DRAWN: THE DROPDOWN HOLDS ONE
        OPTION -- THE HOST'S PROVISIONAL LABEL, ELSE "Loading orgs…" -- THAT NOTHING CAN SELECT, AND A
        SPINNER SITS TO ITS RIGHT. A NEW ARRAY PER CHANGE, SO EACH VIEW REDRAWS ITS OPTIONS ONCE
    */
    isDataOrgChecking: false,
    dataOrgCheckingOptionLabels: [] as string[],
    dataOrgProvisionalRequestSequence: null as number | null,
    dataOrgTypeLabel: null as string | null,
    dataOrgStatusText: '',
    isDataOrgStatusFailure: false,
    dataOrgHiddenNoteText: '',
    // THE renderSequence THE PICKER ASKED FOR ITS ORGS UNDER -- ONE ASK PER MODEL, MADE THE FIRST TIME A TREECIPE TAB OPENS OR THE PICKER IS USED
    dataOrgRequestedSequence: null as number | null,
    // THE LATEST SELECTION THE HOST NAMED; COUNTS FOR ANY OTHER ARE A DIFFERENT ORG'S, OR AN OLDER ASK OF THIS ONE
    dataOrgRequestSequence: null as number | null,
    // THE LAST SELECTION CLEARED BY A RE-LISTING: NOTHING AT OR BELOW IT IS DRAWN AGAIN
    dataOrgClearedRequestSequence: null as number | null,
    dataOrgSelectedIndex: null as number | null,
    // SET WHEN THE SELECTION COULD NOT BE CONNECTED TO, SO NO TREE WAITS ON A READINESS THAT IS NEVER POSTED
    dataOrgSelectionFailureMessage: '',
    // KEYED BY OBJECT NAMES, AND BY TREE KEY AND OBJECT NAME -- NAMES FROM FILES, SO NO PROTOTYPE
    dataOrgReadinessByObject: Object.create(null) as Record<string, IDataOrgReadiness>,
    // AN OBJECT'S READINESS IN ONE TREE, FOR ITS BLOCK (#210); THE OBJECT'S ANSWERS WHEN THERE IS NONE
    dataOrgReadinessByTreeObjectKey: Object.create(null) as Record<string, IDataOrgReadiness>,
    // THE PICKER AS IT WAS BEFORE ⟳ OR A FIRST LISTING CLEARED IT, PUT BACK WHEN THE HOST REFUSES THE LISTING (#537)
    dataOrgPickerBeforeCheck: null as IDataOrgPickerBeforeCheck | null,
    // LISTINGS ASKED FOR AND NOT YET ANSWERED: A REFUSAL RESTORES THE PICKER ONLY WHEN IT ANSWERS THE LAST ONE, SINCE AN EARLIER ONE MAY HAVE BEEN ACCEPTED
    dataOrgUnansweredListingCount: 0
};

export function resetDataOrgPickerState(): void {

    dataOrgPicker.dataOrgViews = [];
    dataOrgPicker.dataOrgLabels = null;
    dataOrgPicker.isDataOrgLoadShown = true;
    dataOrgPicker.isDataOrgSelectShown = false;
    dataOrgPicker.isDataOrgRefreshShown = false;
    dataOrgPicker.isDataOrgChecking = false;
    dataOrgPicker.dataOrgCheckingOptionLabels = [];
    dataOrgPicker.dataOrgProvisionalRequestSequence = null;
    dataOrgPicker.dataOrgTypeLabel = null;
    dataOrgPicker.dataOrgStatusText = '';
    dataOrgPicker.isDataOrgStatusFailure = false;
    dataOrgPicker.dataOrgHiddenNoteText = '';
    dataOrgPicker.dataOrgRequestedSequence = null;
    dataOrgPicker.dataOrgRequestSequence = null;
    dataOrgPicker.dataOrgClearedRequestSequence = null;
    dataOrgPicker.dataOrgSelectedIndex = null;
    dataOrgPicker.dataOrgSelectionFailureMessage = '';
    dataOrgPicker.dataOrgReadinessByObject = Object.create(null);
    dataOrgPicker.dataOrgReadinessByTreeObjectKey = Object.create(null);
    dataOrgPicker.dataOrgPickerBeforeCheck = null;
    dataOrgPicker.dataOrgUnansweredListingCount = 0;

}
