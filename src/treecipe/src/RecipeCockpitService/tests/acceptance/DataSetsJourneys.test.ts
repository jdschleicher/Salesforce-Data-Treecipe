jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { DATA_SETS_JOURNEYS, openDataSetsJourney, startDataSetsClock } from './DataSetsJourneys';

/*
    #580's Previously Used Data Sets journeys, each on a cockpit of its own whose two data sets were
    made by two Generate fake data and insert runs, at a fixed clock.
*/
describe('Recipe Cockpit journeys: Previously Used Data Sets (#580)', () => {

    let journey: RecipeCockpitJourney | undefined;

    beforeEach(() => {
        startDataSetsClock();
    });

    afterEach(async () => {
        await journey?.close();
        journey = undefined;
        jest.useRealTimers();
    });

    test.each(DATA_SETS_JOURNEYS)('$name', async (dataSetsJourney) => {
        journey = await ( dataSetsJourney.open ?? openDataSetsJourney )();
        await dataSetsJourney.run(journey);
    }, 60000);

});
