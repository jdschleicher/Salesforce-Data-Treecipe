/*
    Which Troubleshooting sub-tab (#365) a failed tree insert's "Open Troubleshooting" opens (#375),
    read from the first error Salesforce returned for the first file that failed.

    This file imports NOTHING, like RecipeCockpitRecordCreation: the sub-tab names are repeated
    here, and a test holds them to RECIPE_COCKPIT_TROUBLESHOOTING_SUB_TABS. The error comes from
    an org's answer, so every part of it is type-checked; anything not recognized opens TODO's,
    which lists what the recipe still asks a reader to finish.
*/

export type InsertFailureTroubleshootingSubTab = 'todos' | 'fields' | 'permissions' | 'validationRules' | 'recordTypes' | 'globalValueSets';

export interface IInsertFailureError {
    statusCode: string;
    fields: string[];
}

const SUB_TAB_BY_STATUS_CODE: ReadonlyMap<string, InsertFailureTroubleshootingSubTab> = new Map<string, InsertFailureTroubleshootingSubTab>([
    ['INVALID_FIELD', 'fields'],
    ['INVALID_FIELD_WHEN_USING_TEMPLATE', 'fields'],
    ['INVALID_FIELD_FOR_INSERT_UPDATE', 'permissions'],
    ['INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY', 'permissions'],
    ['INSUFFICIENT_ACCESS_OR_READONLY', 'permissions'],
    ['FIELD_CUSTOM_VALIDATION_EXCEPTION', 'validationRules'],
    ['INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST', 'globalValueSets']
]);

// WHAT SALESFORCE ANSWERS FOR A RECORD THAT DID NOT FAIL ITSELF WHEN ANOTHER IN AN ALL-OR-NONE REQUEST DID
export const ALL_OR_NONE_ROLLED_BACK_STATUS_CODE = 'ALL_OR_NONE_OPERATION_ROLLED_BACK';

export class RecipeCockpitInsertFailureTriage {

    static resolveSubTab(insertFailure: IInsertFailureError | undefined): InsertFailureTroubleshootingSubTab {

        if ( !insertFailure ) {
            return 'todos';
        }

        // A RECORD TYPE THE ORG DOES NOT HOLD IS NAMED BY ITS FIELD, WHATEVER THE CODE SAYS
        if ( insertFailure.fields.some(fieldApiName => fieldApiName.toLowerCase() === 'recordtypeid') ) {
            return 'recordTypes';
        }

        return SUB_TAB_BY_STATUS_CODE.get(insertFailure.statusCode) ?? 'todos';

    }

    /*
        The first error of a failed record's answer that says why IT failed: under all-or-none every
        other record of the request answers ALL_OR_NONE_OPERATION_ROLLED_BACK, which says nothing
        about the cause. undefined when the answer carries no usable error.
    */
    static readFirstError(recordResult: unknown): IInsertFailureError | undefined {

        const resultErrors = ( recordResult as { errors?: unknown } | null | undefined )?.errors;
        if ( !Array.isArray(resultErrors) ) {
            return undefined;
        }

        const insertErrors = resultErrors
            .filter((resultError): resultError is { statusCode: string; fields?: unknown } => typeof resultError?.statusCode === 'string')
            .map(resultError => ({
                statusCode: resultError.statusCode,
                fields: Array.isArray(resultError.fields) ? resultError.fields.filter((fieldApiName): fieldApiName is string => typeof fieldApiName === 'string') : []
            }));

        return insertErrors.find(insertError => insertError.statusCode !== ALL_OR_NONE_ROLLED_BACK_STATUS_CODE) ?? insertErrors[0];

    }

    /*
        The first error, across a file's failed records in order, that is not a rollback answer;
        else the first error of any record.
    */
    static readFirstFailure(recordResults: readonly unknown[]): IInsertFailureError | undefined {

        const firstErrors = recordResults
            .map(recordResult => this.readFirstError(recordResult))
            .filter((insertError): insertError is IInsertFailureError => !!insertError);

        return firstErrors.find(insertError => insertError.statusCode !== ALL_OR_NONE_ROLLED_BACK_STATUS_CODE) ?? firstErrors[0];

    }

}
