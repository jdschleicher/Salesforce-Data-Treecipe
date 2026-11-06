import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { INSERT_OUTCOME_NOTIFICATION, TREE_NAME, expectEqual, generateAndInsert, openTreecipeTabJourney } from './TreecipeTabWorkspace';

/*
    The Previously Used Data Sets tab's journeys (#580). Its rows are made the way a reader makes them:
    two Generate fake data and insert runs on treecipeTabWorkspace, then Insert… of the first again --
    so every data set, insert attempt and status chip on screen is one the cockpit wrote.

    Only Date is faked, at a fixed instant moved on between inserts: a data set's folder and an insert
    attempt are named to the second, so two inserts in one second would share a name, and a fixed clock
    gives every row the same name on every run.
*/

export const DATA_SETS_TAB = 'Previously Used Data Sets';
const DATA_SETS_PANEL = { role: 'tabpanel', name: DATA_SETS_TAB };
const FIRST_DATA_SET = 'dataset-fakerjs-2026-10-20T10-00-00';
const SECOND_DATA_SET = 'dataset-fakerjs-2026-10-20T10-01-00';
const RENAMED_FIRST_DATA_SET = 'Smoke data';

// ONLY Date IS FAKED: A JOURNEY AWAITS REAL FILE WRITES, PROMISES AND TIMERS
type RealTimerAPI = 'hrtime' | 'nextTick' | 'performance' | 'queueMicrotask' | 'setImmediate' | 'clearImmediate' | 'setInterval' | 'clearInterval' | 'setTimeout' | 'clearTimeout';
const REAL_TIMER_APIS: RealTimerAPI[] = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'];

export function startDataSetsClock(): void {
    jest.useFakeTimers({ now: new Date('2026-10-20T10:00:00.000Z'), doNotFake: REAL_TIMER_APIS });
}

// THE TREE CARD WITH TWO DATA SETS ON ITS Previously Used Data Sets TAB, EACH INSERTED ONCE INTO qa
export async function openDataSetsJourney(): Promise<RecipeCockpitJourney> {
    const journey = await openTreecipeTabJourney();
    try {
        await generateAndInsert(journey);
        jest.setSystemTime(new Date('2026-10-20T10:01:00.000Z'));
        await generateAndInsert(journey);
        // THE TAB IS FIRST BUILT NOW, AFTER BOTH INSERTS: EACH ROW COMES FROM THE MODEL ITS datasetAdded GREW, WITH NO RELOAD (#604)
        await journey.openTab(DATA_SETS_TAB);
        await journey.waitFor('button', `Rename ${SECOND_DATA_SET}`, DATA_SETS_PANEL);
        await journey.waitFor('button', `Rename ${FIRST_DATA_SET}`, DATA_SETS_PANEL);
    } catch (setupError) {
        await journey.close();
        throw setupError;
    }
    return journey;
}

const panelLines = (journey: RecipeCockpitJourney) => journey.screen().lines(journey.screen().get('tabpanel', DATA_SETS_TAB));
const renameBoxOf = (journey: RecipeCockpitJourney) => journey.screen().findAll('textbox', /^New name for /)[0]?.name ?? 'no rename box is open';

// THE INSERT JOURNEY TABLE'S ROWS, EACH AS ITS Time, Step, Org AND Status CELLS
function insertJourneyRows(journey: RecipeCockpitJourney): string[][] {
    const screen = journey.screen();
    return screen.findAll('row', undefined, screen.get('tabpanel', DATA_SETS_TAB))
        .map(row => screen.findAll('cell', undefined, row).map(cell => cell.name).slice(0, 4))
        .filter(cells => cells.length > 0);
}

/*
    #604: with the Data Sets tab already built, a second insert's row is drawn on it in place. The
    harness once passed the host's own model to the panel instead of a copy, as VS Code never does; the
    host's in-place add then made the panel find the data set already listed and draw no row.
*/
export async function openDataSetsTabBetweenInserts(): Promise<RecipeCockpitJourney> {
    const journey = await openTreecipeTabJourney();
    try {
        await generateAndInsert(journey);
        await journey.openTab(DATA_SETS_TAB);
        await journey.waitFor('button', `Rename ${FIRST_DATA_SET}`, DATA_SETS_PANEL);
        await journey.openTab('Treecipe');
        jest.setSystemTime(new Date('2026-10-20T10:01:00.000Z'));
        await generateAndInsert(journey);
    } catch (setupError) {
        await journey.close();
        throw setupError;
    }
    return journey;
}

export const DATA_SETS_JOURNEYS: Array<{ name: string; open?: () => Promise<RecipeCockpitJourney>; run(journey: RecipeCockpitJourney): Promise<void> }> = [

    {
        name: 'a second insert\'s data set is drawn on a Data Sets tab already built, newest first, without a reload (#604)',
        open: openDataSetsTabBetweenInserts,
        run: async journey => {

            const readyCountBefore = journey.messages.filter(entry => entry.command === 'ready' || entry.command === 'recipeData').length;
            await journey.openTab(DATA_SETS_TAB);

            await journey.step('both data sets are listed, newest first, and the cockpit drew no new model to list them', () => {
                expectEqual(journey.screen().findAll('button', /^Rename dataset-/).map(renameButton => renameButton.name), [`Rename ${SECOND_DATA_SET}`, `Rename ${FIRST_DATA_SET}`], 'The rows');
                journey.screen().get('text', '2 data sets');
                expectEqual(journey.messages.filter(entry => entry.command === 'ready' || entry.command === 'recipeData').length, readyCountBefore, 'Panel reloads or new models while opening the tab');
                expectEqual(journey.messages.filter(entry => entry.command === 'datasetAdded').length, 2, 'datasetAdded messages: one per insert');
            });

        }
    },

    {
        name: 'rename a data set inline, and a name another data set already has is refused under the box',
        run: async journey => {

            await journey.click('button', `Rename ${FIRST_DATA_SET}`);
            await journey.type(renameBoxOf(journey), RENAMED_FIRST_DATA_SET);
            await journey.press(renameBoxOf(journey), 'Enter');

            await journey.step('the row shows its new name, and its folder is unchanged', () => {
                const screen = journey.screen();
                screen.get('button', `Rename ${RENAMED_FIRST_DATA_SET}`);
                screen.get('button', `Mark ${RENAMED_FIRST_DATA_SET} as a favorite`);
                expectEqual(panelLines(journey).includes(`  text "${FIRST_DATA_SET}"`), true, 'The folder name is still shown on the row');
                expectEqual(journey.fileChanges.some(fileChange => fileChange.change === 'removed'), false, 'A folder or file removed by the rename');
            });

            await journey.click('button', `Rename ${SECOND_DATA_SET}`);
            await journey.type(renameBoxOf(journey), RENAMED_FIRST_DATA_SET);
            await journey.press(renameBoxOf(journey), 'Enter');

            await journey.step('the same name on the second data set is refused under its box, and the row keeps its name', () => {
                const screen = journey.screen();
                const renameGroup = screen.get('group', `Rename ${SECOND_DATA_SET}`);
                screen.get('alert', 'Another data set already has that name.', renameGroup);
                screen.get('button', `Rename ${SECOND_DATA_SET}`);
                expectEqual(screen.findAll('button', `Rename ${RENAMED_FIRST_DATA_SET}`).length, 1, 'Rows named Smoke data');
            });

        }
    },

    {
        name: 'favourite a data set, then Favorites only shows only it',
        run: async journey => {

            await journey.step('both data sets are listed, newest first', () => {
                expectEqual(journey.screen().findAll('button', /^Rename /).map(renameButton => renameButton.name).filter(buttonName => buttonName !== `Rename ${TREE_NAME}`), [`Rename ${SECOND_DATA_SET}`, `Rename ${FIRST_DATA_SET}`], 'The rows');
                journey.screen().get('text', '2 data sets');
            });

            await journey.click('button', `Mark ${FIRST_DATA_SET} as a favorite`);
            await journey.click('button', '☆ Favorites only', DATA_SETS_PANEL);

            await journey.step('only the favourite is listed, marked as one, and the button says the filter is on', () => {
                const screen = journey.screen();
                screen.get('button', '★ Favorites only', screen.get('tabpanel', DATA_SETS_TAB));
                screen.get('text', '1 of 2 data sets');
                expectEqual(screen.findAll('button', /^Rename /).map(renameButton => renameButton.name).filter(buttonName => buttonName !== `Rename ${TREE_NAME}`), [`Rename ${FIRST_DATA_SET}`], 'The rows');
                screen.get('button', `Remove ${FIRST_DATA_SET} from favorites`);
            });

            await journey.click('button', '★ Favorites only', DATA_SETS_PANEL);
            await journey.step('turning it off lists both again', () => {
                expectEqual(journey.screen().findAll('button', /^Rename /).filter(renameButton => renameButton.name !== `Rename ${TREE_NAME}`).length, 2, 'The rows');
            });

        }
    },

    {
        name: 'Insert… a data set into the sandbox again: the confirmation, its status chip, and the insert journey table sorted by Time',
        run: async journey => {

            // FAVORITES ONLY LEAVES ONE ROW ON SCREEN, SO ITS Insert… IS THE ONLY ONE
            await journey.click('button', `Mark ${FIRST_DATA_SET} as a favorite`);
            await journey.click('button', '☆ Favorites only', DATA_SETS_PANEL);
            jest.setSystemTime(new Date('2026-10-20T10:05:00.000Z'));
            const insertCountBefore = journey.org.calls.filter(orgCall => /\.insert$/.test(orgCall.call)).length;
            await journey.click('button', 'Insert…', DATA_SETS_PANEL);
            // THE ORG CHOSEN FOR THE TWO GENERATES IS STILL CHOSEN, SO Insert… ASKS FOR NONE
            expectEqual(journey.prompts.filter(prompt => prompt.isWaiting), [], 'Prompts waiting');

            await journey.waitForConfirmation();
            await journey.step('the confirmation names the data set, the sandbox and the records, parents first', () => {
                const screen = journey.screen();
                const confirmation = screen.get('alertdialog', `Insert ${FIRST_DATA_SET} into qa (qa@example.com.qa)?`);
                screen.get('text', 'Insert 3 records from this data set into qa (qa@example.com.qa), parents first.', confirmation);
                screen.get('text', 'Sandbox', confirmation);
                expectEqual(journey.org.calls.filter(orgCall => /\.insert$/.test(orgCall.call)).length, insertCountBefore, 'Inserts sent before the confirmation is answered');
            });

            const notificationCountBeforeInsert = journey.notifications.length;
            await journey.answerConfirmation('Insert');
            await journey.answerQuickPick('AllOrNone: TRUE');
            await journey.waitForNotification(INSERT_OUTCOME_NOTIFICATION, notificationCountBeforeInsert);
            await journey.waitFor('img', 'Inserted. Last insert: 2026-10-20 10:05:00 UTC into qa · 3 records saved · 0 records failed', DATA_SETS_PANEL);

            await journey.step('the records go parents first, and the row\'s status chip names the new insert', () => {
                expectEqual(journey.org.calls.filter(orgCall => /\.insert$/.test(orgCall.call)).slice(insertCountBefore).map(orgCall => orgCall.call),
                    ['connection.sobject(Account).insert', 'connection.sobject(Contact).insert', 'connection.sobject(Visit__c).insert'], 'The inserts, in order');
                journey.screen().get('img', 'Inserted. Last insert: 2026-10-20 10:05:00 UTC into qa · 3 records saved · 0 records failed', journey.screen().get('tabpanel', DATA_SETS_TAB));
                expectEqual(journey.notifications.slice(-1)[0]?.text, `3 records were inserted into qa (qa@example.com.qa) from ${FIRST_DATA_SET}.`, 'The notification: a data set\'s insert names the data set');
            });

            await journey.click('button', `Insert journey: ${FIRST_DATA_SET}`);

            await journey.step('the insert journey lists both attempts, newest first', () => {
                expectEqual(insertJourneyRows(journey), [
                    ['2026-10-20 10:05:00', 'Insert', 'qa · qa@example.com.qa', 'Succeeded'],
                    ['2026-10-20 10:00:00', 'Insert', 'qa · qa@example.com.qa', 'Succeeded']
                ], 'The insert journey rows');
            });

            await journey.click('button', 'Time ↓', DATA_SETS_PANEL);

            await journey.step('sorting by Time again puts the oldest first, and the header says so', () => {
                expectEqual(insertJourneyRows(journey).map(cells => cells[0]), ['2026-10-20 10:00:00', '2026-10-20 10:05:00'], 'The Time column');
                journey.screen().get('button', 'Time ↑', journey.screen().get('tabpanel', DATA_SETS_TAB));
            });

        }
    }

];
