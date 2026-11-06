jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { TROUBLESHOOTING_JOURNEYS } from './TroubleshootingJourneys';

/*
    #579's Troubleshooting journeys, each on a cockpit of its own: the deploys, the retrieve, the
    permission sets and the TODO's sub-tab, and each way a deploy or retrieve must stop short.
*/
describe('Recipe Cockpit journeys: the Troubleshooting tab (#579)', () => {

    let journey: RecipeCockpitJourney | undefined;

    afterEach(async () => {
        await journey?.close();
        journey = undefined;
    });

    test.each(TROUBLESHOOTING_JOURNEYS)('$name', async (troubleshootingJourney) => {
        journey = await troubleshootingJourney.open();
        await troubleshootingJourney.run(journey);
    }, 60000);

});
