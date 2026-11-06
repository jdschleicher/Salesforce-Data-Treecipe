jest.mock('vscode', () => require('./RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import * as fs from 'fs';
import { BASELINES_FOLDER, BASELINE_SCREENS, IS_UPDATING_BASELINES, baselineFilePath, describeBaselineMismatch, renderBaselineScreen } from './CockpitBaselines';

/*
    #580's rendered baselines: each key screen, opened from a fixture workspace, must read exactly as
    its checked-in file. UPDATE_COCKPIT_BASELINES=1 rewrites the files.
*/
describe('Recipe Cockpit rendered baselines (#580)', () => {

    test.each(BASELINE_SCREENS)('$name', async (baselineScreen) => {

        const renderedText = await renderBaselineScreen(baselineScreen);

        if ( IS_UPDATING_BASELINES ) {
            fs.mkdirSync(BASELINES_FOLDER, { recursive: true });
            fs.writeFileSync(baselineFilePath(baselineScreen.name), renderedText);
        }

        const mismatch = describeBaselineMismatch(baselineScreen.name, renderedText);
        if ( mismatch ) { throw new Error(mismatch); }

    }, 60000);

    // THE SAME SCREEN OPENED TWICE READS THE SAME: NOTHING IN A BASELINE DEPENDS ON TIME, MACHINE OR TEMP FOLDER
    test('every screen renders the same twice in a row', async () => {
        for ( const baselineScreen of BASELINE_SCREENS ) {
            expect({ screen: baselineScreen.name, text: await renderBaselineScreen(baselineScreen) }).toEqual({ screen: baselineScreen.name, text: await renderBaselineScreen(baselineScreen) });
        }
    }, 120000);

});
