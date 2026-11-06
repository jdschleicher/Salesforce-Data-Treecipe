import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { TREE_NAME, openTreecipeTabJourney } from './TreecipeTabWorkspace';

/*
    What the Treecipe Adapter journeys (#580) load: treecipeTabWorkspace's tree (Account, Contact under
    it, Visit__c under Contact) and an org holding 201 Accounts in EMEA, one Contact under the first and
    no Visit__c -- 201, so an update of every Account goes in two PATCH requests (200, then 1).
*/

export const ADAPTER_TAB_NAME = 'Treecipe Adapter';
export const PARENT_WHERE_BOX = 'WHERE for the parent records (optional), e.g. Name LIKE \'Acme%\'';
export const PARENT_WHERE = 'Region__c = \'EMEA\'';
export const UPDATE_ATTEMPTS_FOLDER = `treecipe/GeneratedRecipes/recipe-fakerjs-2026-10-15T09-00-00/${TREE_NAME}/RunArtifacts/UpdateAttempts`;
export const SNAPSHOT_FILE_PATTERN = new RegExp(`^${UPDATE_ATTEMPTS_FOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\d{8}-\\d{6}-before\\.json$`);
export const ACCOUNT_COUNT = 201;
export const CONTACT_ID = '003000000000001AAA';
export const OLD_CONTACT_TITLE = 'Old title';

export const accountIdOf = (accountNumber: number) => `001${String(accountNumber).padStart(12, '0')}AAA`;
export const ACCOUNT_IDS = Array.from({ length: ACCOUNT_COUNT }, (_unused, accountIndex) => accountIdOf(accountIndex + 1));

// THE ORG'S ANSWER TO EACH LOAD QUERY, BY ITS OBJECT; ANY OTHER QUERY FALLS THROUGH TO THE FIXTURE'S OWN ANSWERS
export function answerAdapterLoad(journey: RecipeCockpitJourney): void {
    const fixtureQueryAnswer = journey.org.queryAnswer;
    journey.org.queryAnswer = (username, soql) => {
        // THE SAME RECORDS WHATEVER ASKS: THE LOAD, AND THE RE-READ A RESTORE MAKES TO SAVE THE VALUES IT REPLACES
        if ( /\bFROM Account\b/.test(soql) ) {
            return { totalSize: ACCOUNT_COUNT, done: true, records: ACCOUNT_IDS.map(accountId => ({ attributes: { type: 'Account' }, Id: accountId, Region__c: 'EMEA' })) };
        }
        if ( /\bFROM Contact\b/.test(soql) ) {
            return { totalSize: 1, done: true, records: [{ attributes: { type: 'Contact' }, Id: CONTACT_ID, AccountId: ACCOUNT_IDS[0], Title__c: OLD_CONTACT_TITLE }] };
        }
        if ( /\bFROM Visit__c\b/.test(soql) ) {
            return { totalSize: 0, done: true, records: [] };
        }
        return fixtureQueryAnswer(username, soql);
    };
}

// THE ADAPTER TAB WITH qa CHOSEN AND THE ORG'S RECORDS SCRIPTED: WHAT EVERY ADAPTER JOURNEY STARTS FROM
export async function openAdapterJourney(): Promise<RecipeCockpitJourney> {
    const journey = await openTreecipeTabJourney();
    // A JOURNEY THAT FAILS PAST open IS NEVER HANDED TO ITS SUITE TO CLOSE, SO IT CLOSES ITSELF, AS open DOES
    try {
        answerAdapterLoad(journey);
        await journey.click('button', 'Choose org…');
        await journey.pickOrg('qa');
        await journey.openTab(ADAPTER_TAB_NAME);
    } catch (setupError) {
        await journey.close();
        throw setupError;
    }
    return journey;
}

// STEP 1 AND 2: THE PARENT AND ITS WHERE, Next, THEN Account.Region__c AND Contact.Title__c CHOSEN
export async function chooseParentAndFields(journey: RecipeCockpitJourney, parentWhere: string = PARENT_WHERE): Promise<void> {
    await journey.type(PARENT_WHERE_BOX, parentWhere);
    await journey.click('button', 'Next');
    await journey.click('button', 'Show or hide the fields of Account');
    await journey.click('checkbox', 'Account.Region__c: Click to choose this field to fill');
    await journey.click('button', 'Show or hide the fields of Contact');
    await journey.click('checkbox', 'Contact.Title__c: Click to choose this field to fill');
}

// THE QUERIES SENT, BUT NOT THE CONNECTION CHECK'S OR THE RECORD TYPE LOOKUP'S
export const loadQueriesSent = (journey: RecipeCockpitJourney) => journey.org.calls
    .filter(orgCall => orgCall.call === 'connection.query' && !/\bFROM\s+(Organization|RecordType)\b/.test(String(orgCall.args[0])))
    .map(orgCall => String(orgCall.args[0]));

// EACH UPDATE SENT, IN ORDER: ITS OBJECT, ITS RECORDS AND ITS OPTIONS
export const updatesSent = (journey: RecipeCockpitJourney) => journey.org.calls
    .map(orgCall => ({ match: /^connection\.sobject\((.+)\)\.update$/.exec(orgCall.call), orgCall }))
    .filter(entry => entry.match)
    .map(entry => ({ objectApiName: entry.match![1], records: entry.orgCall.args[0] as Array<Record<string, unknown>>, options: entry.orgCall.args[1] }));
