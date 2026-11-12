/*
    The confirmation's words and answer shapes, shared by its host half (CockpitConfirmDialog.ts)
    and its panel half (panel/CockpitConfirmDialogPanel.ts, #637). Imports nothing, so the panel
    bundle can import it without pulling in a Node module.
*/
export const COCKPIT_CONFIRM_WARNINGS_LABEL = 'Before you confirm';
export const COCKPIT_CONFIRM_CHANGE_ORG_LABEL = 'Change org…';

export interface ICockpitConfirmAnswer {
    chosenLabel: string | undefined;
    isChecked: boolean;
}

// ONE RADIO OF A CONFIRMATION (#623): THE NAME THE PANEL ANSWERS WITH, AND THE WORDS BESIDE IT
export interface ICockpitConfirmRecordTypeSetMode {
    name: string;
    label: string;
}
