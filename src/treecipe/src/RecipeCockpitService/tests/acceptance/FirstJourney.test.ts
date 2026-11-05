jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { FIRST_JOURNEY_FIXTURE, FIRST_JOURNEY_STEPS } from './FirstJourney';

/*
    #577's first journey, one test per step on one open cockpit: each step starts where the last one
    left the reader, as a reader moves through the panel.
*/
describe('Recipe Cockpit journey: open the cockpit and look around (#577)', () => {

    let journey: RecipeCockpitJourney;

    beforeAll(async () => {
        journey = await new RecipeCockpitJourney().open(FIRST_JOURNEY_FIXTURE);
    });

    afterAll(async () => {
        await journey?.close();
    });

    FIRST_JOURNEY_STEPS.forEach(journeyStep => {
        test(journeyStep.name, () => journeyStep.run(journey));
    });

});
