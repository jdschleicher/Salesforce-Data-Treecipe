import { IDataSetInsertResult } from '../CollectionsApiService/CollectionsApiService';
import { RecipeYamlScalar } from '../RecipeYamlScalar/RecipeYamlScalar';
import { IRecipeCockpitConfirmContent } from './RecipeCockpitConfirmContent';
import { RECORD_TYPE_SET_MODE_LABELS } from './RecipeCockpitRecordTypeRecipe';

/*
    "A data set for each record type" (#624, slice D of #620): one data set per combination of one
    record type per object, inserted in turn. Every set's recipe is built BEFORE the confirmation, so
    the confirmation lists each set's own totals and warnings, and nothing walks the metadata between
    the reader's answer and the last insert. The cockpit hands in the steps that touch the panel, the
    org and the disk, so this file holds only the rules.
*/
export const RECIPE_COCKPIT_INSERT_RECORD_TYPE_SETS_SECTION_TITLE = 'A data set for each record type';

// ONE SET, BUILT BEFORE THE CONFIRMATION: ITS RECIPE, WHAT IT INSERTS, AND WHAT THE CONFIRMATION WARNS OF FOR IT
export interface IRecordTypeSet<TRecipe> {
    setLabel: string;
    recipe: TRecipe;
    recordTotalsByObject: ReadonlyMap<string, number>;
    warnings: readonly string[];
}

/*
    How one set ended: inserted (insertResult says how); notInserted, when a guard stopped it before
    its insert (reason says why, escaped); failed, when a step threw (reason is the error, unescaped);
    or notStarted, because a set before it did not wholly land.
*/
export interface IRecordTypeSetOutcome {
    setLabel: string;
    status: 'inserted' | 'notInserted' | 'failed' | 'notStarted';
    datasetFolderPath?: string;
    insertResult?: IDataSetInsertResult;
    reason?: string;
}

export interface IRecordTypeSetInsertSteps<TRecipe> {
    generateDataset: (recipe: TRecipe) => Promise<string | undefined>;
    onDatasetFolderMade: (datasetFolderPath: string) => void;
    // ASKED RIGHT BEFORE EACH INSERT: THE PANEL, ITS STATE AND THE ORG SELECTION ARE STILL THE ONES CONFIRMED
    isSameSelection: () => boolean;
    insertDataset: (datasetFolderPath: string) => Promise<IDataSetInsertResult>;
}

export class RecipeCockpitRecordTypeSets {

    // EVERY FILE SENT AND EVERY RECORD SAVED; ANY OTHER OUTCOME ENDS THE RUN OF SETS
    static isInsertWhollyLanded(insertResult: IDataSetInsertResult): boolean {

        return insertResult.outcome === 'completed' && insertResult.failedRecordCount === 0;

    }

    /*
        Each set generated and inserted in turn, under the one lock, confirmation and all-or-none
        answer the caller already holds. A set that does not wholly land ends the run there: the
        sets before it stay, it rolls back as one insert does, and the rest are notStarted. A step
        that throws is that set's failure, so the sets already in the org are still reported.
    */
    static async insertRecordTypeSets<TRecipe>(recordTypeSets: readonly IRecordTypeSet<TRecipe>[], setSteps: IRecordTypeSetInsertSteps<TRecipe>): Promise<IRecordTypeSetOutcome[]> {

        const setOutcomes: IRecordTypeSetOutcome[] = recordTypeSets.map(recordTypeSet => ({ setLabel: recordTypeSet.setLabel, status: 'notStarted' }));

        for ( let setIndex = 0; setIndex < recordTypeSets.length; setIndex++ ) {

            const setOutcome = setOutcomes[setIndex];

            try {

                const datasetFolderPath = await setSteps.generateDataset(recordTypeSets[setIndex].recipe);
                if ( !datasetFolderPath ) {
                    setOutcome.status = 'notInserted';
                    setOutcome.reason = 'it was not generated';
                    break;
                }
                setOutcome.datasetFolderPath = datasetFolderPath;
                setSteps.onDatasetFolderMade(datasetFolderPath);

                if ( !setSteps.isSameSelection() ) {
                    setOutcome.status = 'notInserted';
                    setOutcome.reason = 'the org selection changed after the insert was confirmed; its data set was generated and can be inserted from its row';
                    break;
                }

                setOutcome.insertResult = await setSteps.insertDataset(datasetFolderPath);
                setOutcome.status = 'inserted';

            } catch (stepError) {
                setOutcome.status = 'failed';
                setOutcome.reason = String(( stepError as Error )?.message ?? stepError);
                break;
            }

            if ( !setOutcome.insertResult || !RecipeCockpitRecordTypeSets.isInsertWhollyLanded(setOutcome.insertResult) ) {
                break;
            }

        }

        return setOutcomes;

    }

    /*
        The confirmation's list of the sets: each by name with its OWN totals, of the objects the tree
        inserts, after the records section. Each set's warnings that the folded confirmation does not
        already give are added under the set's name, and one warning says how the sets are inserted.
    */
    static addRecordTypeSetsToConfirmation<TRecipe>(confirmationContent: IRecipeCockpitConfirmContent,
                                                    recordTypeSets: readonly IRecordTypeSet<TRecipe>[],
                                                    insertObjectApiNames: readonly string[]): IRecipeCockpitConfirmContent {

        const setLines = recordTypeSets.map(recordTypeSet => `${recordTypeSet.setLabel}: ${insertObjectApiNames
            .filter(objectApiName => recordTypeSet.recordTotalsByObject.has(objectApiName))
            .map(objectApiName => `${objectApiName} ${recordTypeSet.recordTotalsByObject.get(objectApiName)}`)
            .join(', ')}`);
        const shownWarnings = new Set(confirmationContent.warnings ?? []);
        const setWarnings = recordTypeSets.flatMap(recordTypeSet => recordTypeSet.warnings
            .filter(setWarning => !shownWarnings.has(setWarning))
            .map(setWarning => `${recordTypeSet.setLabel}: ${setWarning}`));
        const [recordsSection, ...otherSections] = confirmationContent.sections ?? [];

        return {
            ...confirmationContent,
            warnings: [...( confirmationContent.warnings ?? [] ), RecipeCockpitRecordTypeSets.buildRecordTypeSetsWarning(recordTypeSets.length), ...setWarnings],
            sections: [
                ...( recordsSection ? [recordsSection] : [] ),
                { title: RECIPE_COCKPIT_INSERT_RECORD_TYPE_SETS_SECTION_TITLE, count: setLines.length, lines: setLines },
                ...otherSections
            ]
        };

    }

    static buildRecordTypeSetsWarning(setCount: number): string {

        return `${RECORD_TYPE_SET_MODE_LABELS.separate} makes ${setCount} data sets, inserted one after another. A set that is cancelled, stops or has a record that fails ends the run there: the sets before it stay, it is rolled back as a single insert is, and the sets after it are not started.`;

    }

    /*
        The one notification: every set by name and how it ended, in order. An error when a set
        failed, stopped or had a record fail, a warning when one was cancelled or not inserted,
        information when every set landed. treeLabel and orgLabel arrive escaped; a set's label and
        a thrown error are escaped here.
    */
    static buildRecordTypeSetsNotification(setOutcomes: readonly IRecordTypeSetOutcome[], treeLabel: string, orgLabel: string): { severity: 'information' | 'warning' | 'error'; notificationText: string } {

        const recordsText = (recordCount: number) => `${recordCount} ${recordCount === 1 ? 'record' : 'records'}`;
        const wasOrWere = (recordCount: number) => recordCount === 1 ? 'was' : 'were';
        const isLanded = (setOutcome: IRecordTypeSetOutcome) => !!setOutcome.insertResult && RecipeCockpitRecordTypeSets.isInsertWhollyLanded(setOutcome.insertResult);

        const describeSet = (setOutcome: IRecordTypeSetOutcome): string => {
            const insertResult = setOutcome.insertResult;
            if ( setOutcome.status === 'notStarted' ) {
                return 'not started';
            }
            if ( setOutcome.status === 'failed' ) {
                return `failed: ${RecipeYamlScalar.escapeForNotification(setOutcome.reason ?? 'an error with no message')}`;
            }
            if ( setOutcome.status === 'notInserted' || !insertResult ) {
                return `not inserted: ${setOutcome.reason ?? 'it was not generated'}`;
            }
            if ( insertResult.outcome === 'cancelled' ) {
                return insertResult.isRolledBack ? 'cancelled, and every record it had inserted was deleted' : 'cancelled';
            }
            if ( insertResult.outcome === 'stopped' ) {
                return insertResult.isRolledBack
                    ? `stopped at a file that could not be inserted, and every record it had inserted was deleted, because all-or-none was chosen (${recordsText(insertResult.failedRecordCount)} failed)`
                    : `stopped at a file that could not be inserted; ${recordsText(insertResult.savedRecordCount)} ${wasOrWere(insertResult.savedRecordCount)} kept, because all-or-none was not chosen, and ${insertResult.failedRecordCount} failed`;
            }
            if ( insertResult.failedRecordCount > 0 ) {
                return `${recordsText(insertResult.savedRecordCount)} inserted and ${insertResult.failedRecordCount} failed; nothing was rolled back`;
            }
            return `${recordsText(insertResult.savedRecordCount)} inserted`;
        };

        const insertResults = setOutcomes.map(setOutcome => setOutcome.insertResult).filter((insertResult): insertResult is IDataSetInsertResult => !!insertResult);
        const hasError = setOutcomes.some(setOutcome => setOutcome.status === 'failed')
                            || insertResults.some(insertResult => insertResult.outcome === 'stopped' || ( insertResult.outcome === 'completed' && insertResult.failedRecordCount > 0 ));
        const landedSetCount = setOutcomes.filter(isLanded).length;
        const requestFailureDetail = insertResults.find(insertResult => !!insertResult.requestFailureDetail)?.requestFailureDetail;

        return {
            severity: hasError ? 'error' : landedSetCount === setOutcomes.length ? 'information' : 'warning',
            notificationText: `${RECORD_TYPE_SET_MODE_LABELS.separate} of ${treeLabel} into ${orgLabel}: ${landedSetCount} of ${setOutcomes.length} data sets inserted. `
                + setOutcomes.map(setOutcome => `${RecipeYamlScalar.escapeForNotification(setOutcome.setLabel)}: ${describeSet(setOutcome)}.`).join(' ')
                + ( requestFailureDetail ? ` The request for ${RecipeYamlScalar.escapeForNotification(requestFailureDetail)}` : '' )
        };

    }

}
