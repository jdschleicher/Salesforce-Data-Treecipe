jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { TREECIPE_TAB_JOURNEYS } from './TreecipeTabJourneys';
import { openTreecipeTabJourney } from './TreecipeTabWorkspace';

/*
    #578's Treecipe tab journeys, each on a cockpit of its own: one reader, one card, from open to what
    the card's change wrote.
*/
describe('Recipe Cockpit journeys: the Treecipe tab (#578)', () => {

    let journey: RecipeCockpitJourney | undefined;

    afterEach(async () => {
        await journey?.close();
        journey = undefined;
    });

    test.each(TREECIPE_TAB_JOURNEYS)('$name', async (treecipeTabJourney) => {
        journey = await openTreecipeTabJourney();
        await treecipeTabJourney.run(journey);
    }, 60000);

});
