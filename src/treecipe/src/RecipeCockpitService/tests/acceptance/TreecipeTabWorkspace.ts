import * as fs from 'fs';
import * as path from 'path';
import { RecipeCockpitJourney } from './RecipeCockpitJourney';

/*
    The workspace #578's journeys open: an sfdx project whose objects are Account (two record types and a
    Rating__c picklist), Contact under it and Visit__c under Contact, and one faker-js run that the real
    Generate Treecipe wrote over them (one tree, Account-thru-Visit__c). The org the journeys insert into
    answers a describe of every field that run's recipe writes, and has both of Account's record types.
*/

export const TREECIPE_TAB_FIXTURE = 'treecipeTabWorkspace';
export const TREE_NAME = 'Account-thru-Visit__c';
export const RUN_FOLDER_RELATIVE_PATH = 'treecipe/GeneratedRecipes/recipe-fakerjs-2026-10-15T09-00-00';
export const RECIPE_FILE_NAME = 'recipe-fakerjs--Account-thru-Visit__c-2026-10-15T09-00-00.yml';
export const RECIPE_RELATIVE_PATH = `${RUN_FOLDER_RELATIVE_PATH}/${TREE_NAME}/${RECIPE_FILE_NAME}`;
export const FIXED_VALUES_RELATIVE_PATH = RECIPE_RELATIVE_PATH.replace(/\.yml$/, '.fixedValues.json');
export const OBJECTS_IN_INSERT_ORDER = ['Account', 'Contact', 'Visit__c'];

export const GENERATE_AND_INSERT_BUTTON_NAME = new RegExp(`^Generate fake data and insert (into \\S+ )?for ${TREE_NAME} \\(`);

const ACCOUNT_RECORD_TYPE_IDS: Readonly<Record<string, string>> = { Business: '012000000000001AAA', Partner: '012000000000002AAA' };

// THE FIXTURE'S OWN COPY, AS THE FIXTURE HOLDS IT: WHAT A STEP THAT PUTS A FILE BACK IS COMPARED WITH
export function readFixtureFile(relativePath: string): string {
    return fs.readFileSync(path.join(__dirname, '..', 'mocks', TREECIPE_TAB_FIXTURE, ...relativePath.split('/')), 'utf8');
}

export function readWorkspaceFile(journey: RecipeCockpitJourney, relativePath: string): string {
    return fs.readFileSync(path.join(journey.workspaceRoot, ...relativePath.split('/')), 'utf8');
}

// EVERY FIELD A `- object:` BLOCK OF THE RECIPE WRITES, BY OBJECT
function readRecipeFieldNamesByObject(recipeText: string): Map<string, string[]> {
    const fieldNamesByObject = new Map<string, string[]>();
    let objectFieldNames: string[] | undefined;
    recipeText.split('\n').forEach(recipeLine => {
        const objectLine = /^\s*- object: (\S+)$/.exec(recipeLine);
        if ( objectLine ) {
            objectFieldNames = fieldNamesByObject.get(objectLine[1]) ?? [];
            fieldNamesByObject.set(objectLine[1], objectFieldNames);
            return;
        }
        const fieldLine = /^\s+([A-Za-z][A-Za-z0-9_]*): /.exec(recipeLine);
        if ( objectFieldNames && fieldLine && !['object', 'nickname', 'count'].includes(fieldLine[1]) && !objectFieldNames.includes(fieldLine[1]) ) {
            objectFieldNames.push(fieldLine[1]);
        }
    });
    return fieldNamesByObject;
}

export async function openTreecipeTabJourney(): Promise<RecipeCockpitJourney> {

    const journey = new RecipeCockpitJourney();
    // THE RUN IS faker-js; ANY OTHER CHOICE AND THE CARD WARNS THAT IT WAS GENERATED FOR ANOTHER BACKEND
    journey.settings.set('salesforce-data-treecipe.selectedFakerService', 'faker-js');
    await journey.open(TREECIPE_TAB_FIXTURE);

    const fieldNamesByObject = readRecipeFieldNamesByObject(readWorkspaceFile(journey, RECIPE_RELATIVE_PATH));
    journey.org.describeAnswer = (_username, objectApiName) => {
        const fieldNames = fieldNamesByObject.get(objectApiName);
        return fieldNames && {
            name: objectApiName,
            createable: true,
            updateable: true,
            fields: fieldNames.map(fieldName => ({ name: fieldName, type: 'string', createable: true, updateable: true, nillable: true }))
        };
    };
    journey.org.queryAnswer = (_username, soql) => /\bFROM\s+RecordType\b/i.test(soql)
        ? { totalSize: 2, done: true, records: Object.entries(ACCOUNT_RECORD_TYPE_IDS).map(([developerName, recordTypeId]) => ({ Id: recordTypeId, SobjectType: 'Account', SObjectType: 'Account', DeveloperName: developerName })) }
        : undefined;

    return journey;

}

export function expectEqual(actual: unknown, expected: unknown, what: string) {
    if ( JSON.stringify(actual) !== JSON.stringify(expected) ) {
        throw new Error(`${what}: expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}.`);
    }
}

// THE FILES WRITTEN OR REMOVED SINCE A COUNT OF journey.fileChanges, AS "written <path>" / "removed <path>"
export function fileChangesSince(journey: RecipeCockpitJourney, fileChangeCountBefore: number): string[] {
    return journey.fileChanges.slice(fileChangeCountBefore).map(fileChange => `${fileChange.change} ${fileChange.relativePath}`);
}

// THE ONE DATA SET FOLDER A GENERATE WROTE, BY ITS PATH UNDER THE WORKSPACE; ITS NAME CARRIES THE CLOCK, SO IT IS FOUND, NOT NAMED
export function writtenDatasetFolder(journey: RecipeCockpitJourney, fileChangeCountBefore: number): string {
    const datasetFolders = [...new Set(journey.fileChanges.slice(fileChangeCountBefore)
        .map(fileChange => /^(treecipe\/FakeDataSets\/dataset-fakerjs-[^/]+)\//.exec(fileChange.relativePath)?.[1])
        .filter((datasetFolder): datasetFolder is string => datasetFolder !== undefined))];
    if ( datasetFolders.length !== 1 ) {
        throw new Error(`expected one data set folder written, but ${datasetFolders.length} were: ${JSON.stringify(datasetFolders)}.`);
    }
    return datasetFolders[0];
}

export const INSERT_ORG_LABEL = 'qa';
// HOW EVERY INSERT OUTCOME THE COCKPIT REPORTS BEGINS: LANDED, PARTLY LANDED, NOTHING, OR STOPPED
export const INSERT_OUTCOME_NOTIFICATION = /^(\d+ records? (was|were) inserted|Nothing was inserted|The insert of )/;

// THE GENERATE BUTTON, THE ORG, THE CONFIRMATION AND ALL-OR-NONE, AS A READER ANSWERS THEM; THE DATA SET FOLDER IT WROTE
export async function generateAndInsert(journey: RecipeCockpitJourney, allOrNoneLabel = 'AllOrNone: TRUE'): Promise<string> {
    const fileChangeCountBefore = journey.fileChanges.length;
    // AFTER AN INSERT THE CARD CHECKS ITS TREE AGAINST THE ORG AGAIN, AND THE BUTTON WAITS FOR THAT, AS A READER DOES
    await journey.waitFor('button', GENERATE_AND_INSERT_BUTTON_NAME, undefined, { isEnabled: true });
    // THE BUTTON SAYS WHICH ORG IT INSERTS INTO ONCE ONE IS CHOSEN; WITH NONE, IT ASKS FOR ONE FIRST
    const isOrgChosen = / into \S+ for /.test(journey.screen().get('button', GENERATE_AND_INSERT_BUTTON_NAME).name);
    const notificationCountBefore = journey.notifications.length;
    await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
    if ( !isOrgChosen ) {
        await journey.answerQuickPick(INSERT_ORG_LABEL);
    }
    await journey.answerConfirmation('Generate and insert');
    await journey.answerQuickPick(allOrNoneLabel);
    // THE INSERT ENDS WITH ITS ONE NOTIFICATION, SHOWN AFTER THE HANDLER THAT STARTED IT ANSWERED: NO STEP AFTER THIS RUNS INTO IT
    await journey.waitForNotification(INSERT_OUTCOME_NOTIFICATION, notificationCountBefore);
    return writtenDatasetFolder(journey, fileChangeCountBefore);
}

export function filteredRecipeOf(journey: RecipeCockpitJourney, datasetFolder: string): string {
    return readWorkspaceFile(journey, `${datasetFolder}/BaseArtifactFiles/filteredRecipe-${RECIPE_RELATIVE_PATH.split('/').pop()}`);
}

// EACH insert THE ORG WAS SENT, IN ORDER: ITS OBJECT AND THE RECORDS IT CARRIED
export function insertsSent(journey: RecipeCockpitJourney): Array<{ objectApiName: string; records: Array<Record<string, unknown>> }> {
    return journey.org.calls
        .map(orgCall => ({ match: /^connection\.sobject\((.+)\)\.insert$/.exec(orgCall.call), orgCall }))
        .filter(entry => entry.match)
        .map(entry => ({ objectApiName: entry.match![1], records: entry.orgCall.args[0] as Array<Record<string, unknown>> }));
}
