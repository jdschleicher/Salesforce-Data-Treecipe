import * as fs from 'fs';
import * as vscode from 'vscode';
import { ConfigurationService } from '../ConfigurationService/ConfigurationService';
import {
    RECORD_TYPE_SELECTIONS_CONFIG_KEY,
    RECORD_TYPES_WHEN_SELECTION_SAVED_CONFIG_KEY,
    SavedRecordTypeSelection
} from './SavedRecordTypeSelection';

/*
    Reads and writes the record type selection in treecipe.config.json. It sits here, above
    ConfigurationService, so the platform layer reads the file without knowing what a record type
    selection is (#574), and SavedRecordTypeSelection stays free of vscode.
*/
export class RecordTypeSelectionConfiguration {

    private static readonly shownRecordTypeSelectionWarnings = new Set<string>();

    /*
        The record type selection saved in treecipe.config.json (#196), or undefined when none is.
        The file is hand-edited, so every entry is type-checked: an unusable one is ignored with a
        warning and never thrown, and the rest still applies.
    */
    static readSavedRecordTypeSelection(): SavedRecordTypeSelection | undefined {

        const configurationDetail = ConfigurationService.getTreecipeConfigurationDetail();
        const isConfigurationObject = typeof configurationDetail === 'object' && configurationDetail !== null && !Array.isArray(configurationDetail);
        if ( !isConfigurationObject ) {
            return undefined;
        }

        const { savedSelection, invalidEntryDescriptions } = SavedRecordTypeSelection.fromConfigurationValues(
            configurationDetail[RECORD_TYPE_SELECTIONS_CONFIG_KEY],
            configurationDetail[RECORD_TYPES_WHEN_SELECTION_SAVED_CONFIG_KEY]
        );

        this.showRecordTypeSelectionWarningOnce(SavedRecordTypeSelection.buildInvalidEntriesWarning(invalidEntryDescriptions));

        return savedSelection;

    }

    /*
        Once per distinct warning per session: every Generate Treecipe reads the saved selection, and
        an entry that stays unusable or stale would otherwise warn on each run.
    */
    static showRecordTypeSelectionWarningOnce(warningMessage: string | undefined, actionLabels: string[] = []): Thenable<string | undefined> | undefined {

        if ( !warningMessage || this.shownRecordTypeSelectionWarnings.has(warningMessage) ) {
            return undefined;
        }
        this.shownRecordTypeSelectionWarnings.add(warningMessage);

        return vscode.window.showWarningMessage(warningMessage, ...actionLabels);

    }

    /*
        Writes the selection into the config file every command reads, keeping every other key. An
        empty selection REMOVES both keys: "Remember this selection" with every object ticked back
        to its default (#623). Throws when the file cannot be read as a JSON object, rather than writing
        over a file a user is in the middle of editing.
    */
    static saveRecordTypeSelections(recordTypeSelections: Record<string, string[]>, recordTypesWhenSelectionSaved: Record<string, string[]>): string {

        const configurationFilePath = ConfigurationService.getTreecipeConfigurationFilePath();
        const configurationDetail = ConfigurationService.getTreecipeConfigurationDetail();

        if ( typeof configurationDetail !== 'object' || configurationDetail === null || Array.isArray(configurationDetail) ) {
            throw new Error('treecipe.config.json is not a JSON object, so the record type selection could not be saved.');
        }

        const selectedObjectApiNames = Object.keys(recordTypeSelections);
        if ( selectedObjectApiNames.length === 0 ) {
            delete configurationDetail[RECORD_TYPE_SELECTIONS_CONFIG_KEY];
            delete configurationDetail[RECORD_TYPES_WHEN_SELECTION_SAVED_CONFIG_KEY];
        } else {
            configurationDetail[RECORD_TYPE_SELECTIONS_CONFIG_KEY] = Object.fromEntries(
                selectedObjectApiNames.map(objectApiName => [objectApiName, [...recordTypeSelections[objectApiName]]]));
            configurationDetail[RECORD_TYPES_WHEN_SELECTION_SAVED_CONFIG_KEY] = Object.fromEntries(
                selectedObjectApiNames
                    .filter(objectApiName => Object.prototype.hasOwnProperty.call(recordTypesWhenSelectionSaved, objectApiName))
                    .map(objectApiName => [objectApiName, [...recordTypesWhenSelectionSaved[objectApiName]]]));
        }

        fs.writeFileSync(configurationFilePath, JSON.stringify(configurationDetail, null, 4));
        return configurationFilePath;

    }

}
