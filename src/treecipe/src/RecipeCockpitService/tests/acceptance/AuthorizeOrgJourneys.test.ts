jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { AUTHORIZE_ORG_JOURNEYS } from './AuthorizeOrgJourneys';
import { openTreecipeTabJourney } from './TreecipeTabWorkspace';

// #630's Authorize org journeys, each on a cockpit of its own
describe('Recipe Cockpit journeys: Authorize org (#630)', () => {

    let journey: RecipeCockpitJourney | undefined;

    afterEach(async () => {
        await journey?.close();
        journey = undefined;
    });

    test.each(AUTHORIZE_ORG_JOURNEYS)('$name', async (authorizeOrgJourney) => {
        journey = await openTreecipeTabJourney();
        await authorizeOrgJourney.run(journey);
    }, 60000);

});
