jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { GENERATE_AND_INSERT_JOURNEYS } from './GenerateAndInsertJourneys';
import { openTreecipeTabJourney } from './TreecipeTabWorkspace';

/*
    #578's Generate fake data and insert journeys, each on a cockpit of its own: the insert into a sandbox,
    and each way it must stop short.
*/
describe('Recipe Cockpit journeys: Generate fake data and insert (#578)', () => {

    let journey: RecipeCockpitJourney | undefined;

    afterEach(async () => {
        await journey?.close();
        journey = undefined;
    });

    test.each(GENERATE_AND_INSERT_JOURNEYS)('$name', async (generateAndInsertJourney) => {
        journey = await openTreecipeTabJourney();
        await generateAndInsertJourney.run(journey);
    }, 60000);

});
