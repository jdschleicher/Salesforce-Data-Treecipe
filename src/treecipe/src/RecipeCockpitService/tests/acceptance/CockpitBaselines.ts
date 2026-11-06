import * as fs from 'fs';
import * as path from 'path';
import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { openTreecipeTabJourney } from './TreecipeTabWorkspace';
import { buildUnifiedDiff } from '../../../ExtensionCommandService/tests/UnifiedDiff';

/*
    Rendered baselines of the Recipe Cockpit's key screens (#580): what each screen looks like to a
    reader, kept as a checked-in text file -- every node's role, accessible name, value and state, in
    document order, as screen().lines() prints it, and never a CSS class. #565 reshapes the panel's
    markup; a control that moves, disappears or changes state shows here as a diff even where no
    journey looks.

    UPDATE_COCKPIT_BASELINES=1 rewrites the files, and the PR then says what a reader now sees
    differently.
*/

export const BASELINES_FOLDER = path.join(__dirname, 'baselines');
export const IS_UPDATING_BASELINES = process.env.UPDATE_COCKPIT_BASELINES === '1';

export interface IBaselineScreen {
    name: string;
    // OPENS THE COCKPIT AND BRINGS UP THE SCREEN, AS A READER WOULD
    show(): Promise<RecipeCockpitJourney>;
}

const openPlain = (fixtureName: string, overlays: string[] = []) => new RecipeCockpitJourney().open(fixtureName, { overlays });

// A JOURNEY THAT FAILS WHILE BRINGING UP ITS SCREEN IS NEVER HANDED BACK TO BE CLOSED, SO IT CLOSES ITSELF
async function showOn(opened: Promise<RecipeCockpitJourney>, bringUp: (journey: RecipeCockpitJourney) => Promise<void> = async () => undefined): Promise<RecipeCockpitJourney> {
    const journey = await opened;
    try {
        await bringUp(journey);
    } catch (bringUpError) {
        await journey.close();
        throw bringUpError;
    }
    return journey;
}

export const BASELINE_SCREENS: IBaselineScreen[] = [
    // A WORKSPACE WITH A treecipe.config.json AND NO GENERATE TREECIPE RUN
    { name: 'empty-state', show: () => showOn(openPlain('troubleshootingConfigOverlay')) },
    { name: 'unreadable-run', show: () => showOn(openPlain('historyWorkspace'), journey => journey.chooseRun('2026-09-10 00:00:00 UTC · faker-js')) },
    { name: 'treecipe-tab', show: () => showOn(openTreecipeTabJourney()) },
    { name: 'data-sets-tab', show: () => showOn(openPlain('historyWorkspace'), journey => journey.openTab('Previously Used Data Sets')) },
    { name: 'troubleshooting-tab', show: () => showOn(openPlain('historyWorkspace'), journey => journey.openTab('Troubleshooting')) },
    { name: 'query-tab', show: () => showOn(openTreecipeTabJourney(), journey => journey.openTab('Query')) },
    { name: 'adapter-tab', show: () => showOn(openTreecipeTabJourney(), journey => journey.openTab('Treecipe Adapter')) },
    {
        name: 'field-editor',
        show: () => showOn(openTreecipeTabJourney(), async journey => {
            await journey.click('button', 'Show or hide the fields of Account');
            await journey.click('button', 'Region__c: Edit the faker expression, or give the field a fixed value');
        })
    },
    {
        name: 'in-panel-confirmation',
        show: () => showOn(openTreecipeTabJourney(), async journey => {
            await journey.click('button', 'Show or hide the fields of Account');
            await journey.click('button', 'Region__c: Edit the faker expression, or give the field a fixed value');
            await journey.type('Value or faker expression for Account.Region__c', 'EMEA');
            await journey.click('button', 'Save', { role: 'group', name: 'Edit Account.Region__c' });
        })
    },
    {
        name: 'picklist-tiles',
        show: () => showOn(openTreecipeTabJourney(), async journey => {
            await journey.click('button', 'Show or hide the fields of Account');
            await journey.click('button', 'Rating__c: Edit the faker expression, or give the field a fixed value');
            await journey.click('button', 'Edit values of Rating__c');
        })
    },
    { name: 'help-section', show: () => showOn(openTreecipeTabJourney(), journey => journey.click('button', 'About this cockpit')) }
];

export const baselineFilePath = (screenName: string) => path.join(BASELINES_FOLDER, `${screenName}.txt`);

export function readBaseline(screenName: string): string | undefined {
    return fs.existsSync(baselineFilePath(screenName)) ? fs.readFileSync(baselineFilePath(screenName), 'utf8') : undefined;
}

// THE WHOLE PAGE A READER SEES, ONE NODE A LINE, ENDING IN A NEWLINE SO THE FILE IS A TEXT FILE
export async function renderBaselineScreen(baselineScreen: IBaselineScreen): Promise<string> {
    const journey = await baselineScreen.show();
    try {
        return journey.screen().lines().join('\n') + '\n';
    } finally {
        await journey.close();
    }
}

// undefined WHEN THE SCREEN IS AS CHECKED IN; OTHERWISE WHAT TO SAY, WITH THE DIFF
export function describeBaselineMismatch(screenName: string, renderedText: string): string | undefined {
    const baselineText = readBaseline(screenName);
    if ( baselineText === undefined ) {
        return `baselines/${screenName}.txt does not exist. Run with UPDATE_COCKPIT_BASELINES=1 to write it.`;
    }
    if ( baselineText === renderedText ) {
        return undefined;
    }
    return `The ${screenName} screen differs from baselines/${screenName}.txt. If the change is intended, run with UPDATE_COCKPIT_BASELINES=1 and say in the PR what a reader now sees differently.\n\n${buildUnifiedDiff(`${screenName}.txt`, baselineText, renderedText)}`;
}
