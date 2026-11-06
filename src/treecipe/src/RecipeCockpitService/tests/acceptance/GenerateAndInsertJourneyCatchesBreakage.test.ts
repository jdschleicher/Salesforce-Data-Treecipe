import * as matchers from 'jest-extended';
expect.extend(matchers);

jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import { RecipeCockpitService } from '../../RecipeCockpitService';
import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { GENERATE_AND_INSERT_JOURNEYS } from './GenerateAndInsertJourneys';
import { openTreecipeTabJourney } from './TreecipeTabWorkspace';

/*
    The production-org journey is worth only the rule it proves (#599): with the router's sandbox-only
    check for insertTree bypassed, and nothing else, the journey must fail at the step that says the
    forged message asks and sends nothing.
*/
describe('the production-org journey catches a bypassed sandbox-only rule (#599)', () => {

    const productionJourneyNamePrefix = 'a production org:';
    const productionJourney = GENERATE_AND_INSERT_JOURNEYS.find(generateAndInsertJourney => generateAndInsertJourney.name.startsWith(productionJourneyNamePrefix));
    if ( !productionJourney ) {
        throw new Error(`No journey in GENERATE_AND_INSERT_JOURNEYS is named "${productionJourneyNamePrefix} …": a renamed production-org journey needs this test updated.`);
    }

    let journey: RecipeCockpitJourney | undefined;

    afterEach(async () => {
        await journey?.close();
        journey = undefined;
    });

    test('passes on the cockpit as it is', async () => {

        journey = await openTreecipeTabJourney();
        await expect(productionJourney.run(journey)).resolves.toBeUndefined();

    }, 60000);

    test('fails at "the forged insertTree asks nothing and sends nothing" when insertTree routing no longer reads IsSandbox', async () => {

        const routePanelMessage = RecipeCockpitService.routePanelMessage.bind(RecipeCockpitService);
        const bypassedRoutes: Array<string | undefined> = [];
        jest.spyOn(RecipeCockpitService, 'routePanelMessage').mockImplementation((panelMessage, panelState) => {
            const dataOrgSelection = panelState.dataOrgSelection;
            if ( panelMessage?.command !== 'insertTree' || !dataOrgSelection?.orgTypeDetail ) {
                return routePanelMessage(panelMessage, panelState);
            }
            // THE ROUTER SEES THE SAME STATE, EXCEPT THAT THE ORG CHOSEN ANSWERED IT IS A SANDBOX
            const panelActionWithSandbox = routePanelMessage(panelMessage, { ...panelState, dataOrgSelection: { ...dataOrgSelection, orgTypeDetail: { ...dataOrgSelection.orgTypeDetail, isSandbox: true } } });
            bypassedRoutes.push(panelActionWithSandbox?.kind);
            return panelActionWithSandbox;
        });

        journey = await openTreecipeTabJourney();
        const failureMessage = await productionJourney.run(journey).then(() => { throw new Error('The production-org journey passed with the sandbox-only rule bypassed.'); }, (journeyError: Error) => journeyError.message);

        // THE BREAKAGE MUST REALLY BE MADE: THE FORGED MESSAGE WAS ROUTED AS AN INSERT
        expect(bypassedRoutes).toEqual(['insertTree']);
        expect(failureMessage).toStartWith('Step "the forged insertTree asks nothing and sends nothing" failed: Calls on an org after the forged message:');

    }, 60000);

});
