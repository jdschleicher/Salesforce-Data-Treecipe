jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { CUSTOM_TREECIPE_JOURNEYS } from './CustomTreecipeJourneys';
import { openTreecipeTabJourney } from './TreecipeTabWorkspace';

// #677's journeys, each on a cockpit of its own: the modal, what Save writes, and the custom tree it opens
describe('Recipe Cockpit journeys: Customize and create new recipe (#677)', () => {

    let journey: RecipeCockpitJourney | undefined;

    afterEach(async () => {
        await journey?.close();
        journey = undefined;
    });

    test.each(CUSTOM_TREECIPE_JOURNEYS)('$name', async (customTreecipeJourney) => {
        journey = await openTreecipeTabJourney();
        await customTreecipeJourney.run(journey);
    }, 60000);

});
