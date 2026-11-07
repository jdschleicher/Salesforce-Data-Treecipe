jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { OBJECT_REFRESH_JOURNEYS, openTroubleshootingJourney } from './ObjectRefreshJourneys';

/*
    #612's journeys, each on a cockpit of its own, on the Troubleshooting workspace.
*/
describe('Recipe Cockpit journeys: Get latest object detail from target org (#612)', () => {

    let journey: RecipeCockpitJourney | undefined;

    afterEach(async () => {
        await journey?.close();
        journey = undefined;
    });

    test.each(OBJECT_REFRESH_JOURNEYS)('$name', async (objectRefreshJourney) => {
        journey = await openTroubleshootingJourney();
        await objectRefreshJourney.run(journey);
    }, 60000);

});
