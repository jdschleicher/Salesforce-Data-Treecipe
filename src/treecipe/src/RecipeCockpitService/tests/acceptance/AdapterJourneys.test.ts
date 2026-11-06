jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { ADAPTER_JOURNEYS } from './AdapterJourneys';
import { openAdapterJourney } from './AdapterWorkspace';

/*
    #580's Treecipe Adapter journeys, each on a cockpit of its own, opened on the Adapter tab with qa chosen.
*/
describe('Recipe Cockpit journeys: the Treecipe Adapter (#580)', () => {

    let journey: RecipeCockpitJourney | undefined;

    afterEach(async () => {
        await journey?.close();
        journey = undefined;
    });

    test.each(ADAPTER_JOURNEYS)('$name', async (adapterJourney) => {
        journey = await openAdapterJourney();
        await adapterJourney.run(journey);
    }, 60000);

});
