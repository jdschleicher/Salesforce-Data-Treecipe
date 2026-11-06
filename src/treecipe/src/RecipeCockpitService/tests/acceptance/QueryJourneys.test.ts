jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { QUERY_JOURNEYS, openQueryJourney } from './QueryJourneys';

/*
    #579's Query tab journeys, each on a cockpit of its own, opened on the Query tab with qa chosen.
*/
describe('Recipe Cockpit journeys: the Query tab (#579)', () => {

    let journey: RecipeCockpitJourney | undefined;

    afterEach(async () => {
        await journey?.close();
        journey = undefined;
    });

    test.each(QUERY_JOURNEYS)('$name', async (queryJourney) => {
        journey = await openQueryJourney();
        await queryJourney.run(journey);
    }, 60000);

});
