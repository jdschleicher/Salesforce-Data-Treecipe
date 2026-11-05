import {
    RECIPE_COCKPIT_QUERY_TAB_LABEL,
    RECIPE_COCKPIT_RUN_PICKER_LABEL,
    RECIPE_COCKPIT_TREECIPE_PICKER_LABEL,
    RECIPE_COCKPIT_TROUBLESHOOTING_TAB_LABEL,
    RECIPE_COCKPIT_UPDATER_TAB_LABEL
} from '../../RecipeCockpitService';
import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { IScreenNode, RecipeCockpitScreen } from './RecipeCockpitScreen';

/*
    The first journey (#577): open the cockpit on historyWorkspace, and a reader sees the newest run, the
    Treecipes dropdown listing every tree in order, each tree's objects in insert order, and every tab of
    each card opening on its first content; choosing an older run shows that run's trees.

    Kept apart from its test file so JourneyCatchesBreakage.test.ts runs the same steps against a
    broken cockpit and proves they fail. Each step runs as a named journey step, so a failure says which.
*/

export const FIRST_JOURNEY_FIXTURE = 'historyWorkspace';

const NEWEST_RUN_LABEL = '2026-09-20 10:00:00 UTC · snowfakery · latest';
const OLDER_RUN_LABEL = '2026-09-01 00:00:00 UTC · snowfakery';
const RUN_LABELS_NEWEST_FIRST = [NEWEST_RUN_LABEL, '2026-09-10 00:00:00 UTC · faker-js', OLDER_RUN_LABEL];

// THE NEWEST RUN'S TREES, IN THE DROPDOWN'S ORDER, EACH WITH ITS OBJECTS IN INSERT ORDER
const NEWEST_RUN_TREES: ReadonlyArray<{ treeName: string; objectsInInsertOrder: string[] }> = [
    { treeName: 'Account-thru-OtherChildObject__c', objectsInInsertOrder: ['Account', 'Contact', 'OtherChildObject__c'] },
    { treeName: 'Lead-ONLY', objectsInInsertOrder: ['Lead'] }
];
const OLDER_RUN_TREE_NAMES = ['Account-thru-Contact', 'Lead-ONLY'];

const CARD_TAB_NAMES = ['Treecipe', 'Previously Used Data Sets', RECIPE_COCKPIT_TROUBLESHOOTING_TAB_LABEL, RECIPE_COCKPIT_QUERY_TAB_LABEL, RECIPE_COCKPIT_UPDATER_TAB_LABEL];

// WHAT EACH TAB DRAWS FIRST THAT A READER GOES BY, FOR THE TREE ITS CARD SHOWS
const FIRST_CONTENT_BY_TAB_NAME: Readonly<Record<string, (treeName: string) => { role: string; name: string | RegExp }>> = {
    'Treecipe': treeName => ({ role: 'button', name: new RegExp(`^Generate fake data and insert for ${treeName} \\(`) }),
    'Previously Used Data Sets': treeName => ({ role: 'searchbox', name: `Search data sets (${treeName})` }),
    [RECIPE_COCKPIT_TROUBLESHOOTING_TAB_LABEL]: () => ({ role: 'tab', name: /^TODO's/ }),
    [RECIPE_COCKPIT_QUERY_TAB_LABEL]: treeName => ({ role: 'searchbox', name: `Search queries (${treeName})` }),
    [RECIPE_COCKPIT_UPDATER_TAB_LABEL]: treeName => ({ role: 'combobox', name: `Parent object (${treeName})` })
};

// THE OBJECTS A CARD'S TREECIPE TAB LISTS, BY THE BUTTON EACH DRAWS TO SHOW ITS FIELDS
const OBJECT_FIELDS_TOGGLE_NAME = /^Show or hide the fields of (.+)$/;

function expectEqual(actual: unknown, expected: unknown, what: string) {
    if ( JSON.stringify(actual) !== JSON.stringify(expected) ) {
        throw new Error(`${what}: expected ${JSON.stringify(expected)}, but the screen shows ${JSON.stringify(actual)}.`);
    }
}

function listedObjectNames(screen: RecipeCockpitScreen, treecipeTabPanel: IScreenNode): string[] {
    return screen.findAll('button', OBJECT_FIELDS_TOGGLE_NAME, treecipeTabPanel).map(toggle => OBJECT_FIELDS_TOGGLE_NAME.exec(toggle.name)[1]);
}

export interface IJourneyStep {
    name: string;
    run(journey: RecipeCockpitJourney): Promise<void>;
}

export const FIRST_JOURNEY_STEPS: IJourneyStep[] = [

    {
        name: 'the newest run is shown',
        run: journey => journey.step('the newest run is shown', () => {
            expectEqual(journey.screen().get('combobox', RECIPE_COCKPIT_RUN_PICKER_LABEL).value, NEWEST_RUN_LABEL, `The "${RECIPE_COCKPIT_RUN_PICKER_LABEL}" dropdown`);
            expectEqual(journey.optionLabelsOf(RECIPE_COCKPIT_RUN_PICKER_LABEL), RUN_LABELS_NEWEST_FIRST, `The runs the "${RECIPE_COCKPIT_RUN_PICKER_LABEL}" dropdown offers`);
        })
    },

    {
        name: 'the Treecipes dropdown lists every tree in order',
        run: journey => journey.step('the Treecipes dropdown lists every tree in order', () => {
            expectEqual(journey.optionLabelsOf(RECIPE_COCKPIT_TREECIPE_PICKER_LABEL), NEWEST_RUN_TREES.map(tree => tree.treeName), `The "${RECIPE_COCKPIT_TREECIPE_PICKER_LABEL}" dropdown`);
            expectEqual(journey.shownTreeName(), NEWEST_RUN_TREES[0].treeName, 'The card shown first');
        })
    },

    // THE LAST TREE FIRST, SO CHOOSING EVERY ONE CHANGES THE CARD SHOWN
    ...[...NEWEST_RUN_TREES].reverse().map((tree): IJourneyStep => ({
        name: `choosing "${tree.treeName}" shows its objects in insert order`,
        run: journey => journey.step(`choosing "${tree.treeName}" shows its objects in insert order`, async () => {
            await journey.chooseTree(tree.treeName);
            const screen = journey.screen();
            expectEqual(listedObjectNames(screen, screen.get('tabpanel', 'Treecipe')), tree.objectsInInsertOrder, `The objects the "${tree.treeName}" card lists`);
        })
    })),

    ...NEWEST_RUN_TREES.map((tree): IJourneyStep => ({
        name: `each tab of "${tree.treeName}" opens and shows its first content`,
        run: journey => journey.step(`each tab of "${tree.treeName}" opens and shows its first content`, async () => {
            await journey.chooseTree(tree.treeName);
            expectEqual(journey.screen().findAll('tab').filter(tab => CARD_TAB_NAMES.includes(tab.name)).map(tab => tab.name), CARD_TAB_NAMES, `The tabs of the "${tree.treeName}" card`);
            for ( const tabName of CARD_TAB_NAMES ) {
                await journey.openTab(tabName);
                const firstContent = FIRST_CONTENT_BY_TAB_NAME[tabName](tree.treeName);
                const screen = journey.screen();
                await journey.step(`the "${tabName}" tab shows its ${firstContent.role} "${firstContent.name}"`, () => {
                    screen.get(firstContent.role, firstContent.name, screen.get('tabpanel', tabName));
                });
            }
        })
    })),

    {
        name: 'choosing an older run shows its trees',
        run: journey => journey.step('choosing an older run shows its trees', async () => {
            await journey.chooseRun(OLDER_RUN_LABEL);
            expectEqual(journey.optionLabelsOf(RECIPE_COCKPIT_TREECIPE_PICKER_LABEL), OLDER_RUN_TREE_NAMES, `The "${RECIPE_COCKPIT_TREECIPE_PICKER_LABEL}" dropdown`);
            expectEqual(journey.shownTreeName(), OLDER_RUN_TREE_NAMES[0], 'The card shown first');
        })
    },

    // THE JOURNEY ONLY READS: NO FILE, NO NOTIFICATION, NO PROMPT, AND NOTHING ASKED OF AN ORG BEYOND THE CONNECTION CHECK
    {
        name: 'looking around writes nothing and asks nothing',
        run: journey => journey.step('looking around writes nothing and asks nothing', () => {
            expectEqual(journey.fileChanges, [], 'Files written or removed');
            expectEqual(journey.notifications, [], 'Notifications');
            expectEqual(journey.prompts, [], 'Quick picks and input boxes');
            expectEqual([...new Set(journey.org.calls.map(orgCall => orgCall.call))].sort(), ['Org.create', 'org.refreshAuth'], 'Calls on an org');
        })
    }

];

export async function runFirstJourney(journey: RecipeCockpitJourney): Promise<void> {
    for ( const journeyStep of FIRST_JOURNEY_STEPS ) {
        await journeyStep.run(journey);
    }
}
