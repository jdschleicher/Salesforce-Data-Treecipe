import * as fs from 'fs';
import * as path from 'path';
import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import { IFakeCliAnswer } from './RecipeCockpitJourneyFakes';
import {
    SANDBOX_ORG_LABEL,
    SANDBOX_USERNAME,
    TROUBLESHOOTING_TREE_NAME,
    chooseOrg,
    expectEqual,
    fileChangesSince,
    openTroubleshootingJourney,
    readWorkspaceFile
} from './TroubleshootingWorkspace';

/*
    "Get latest object detail from target org" (#612), read by role and name as a reader would: the
    Account row's button, step 1's kinds, the review's group and item, the in-panel confirmation, and
    then what landed in the project and the recipe. Opened on the Troubleshooting workspace, whose
    sfdx project holds the tree's Account fields.
*/

export interface IObjectRefreshJourney {
    name: string;
    run(journey: RecipeCockpitJourney): Promise<void>;
}

const ACCOUNT_FIELDS_FOLDER = 'force-app/main/default/objects/Account/fields';
const ACCOUNT_RECIPE_FILE = `treecipe/GeneratedRecipes/recipe-2026-09-20T10-00-00/${TROUBLESHOOTING_TREE_NAME}/recipe--${TROUBLESHOOTING_TREE_NAME}-2026-09-20T10-00-00.yml`;
const IS_PRIORITY_FIELD_XML = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">',
    '    <fullName>Is_Priority__c</fullName>',
    '    <defaultValue>false</defaultValue>',
    '    <label>Is Priority</label>',
    '    <type>Checkbox</type>',
    '</CustomField>',
    ''
].join('\n');

/*
    sf project retrieve start --json for Account: as the real CLI does, it writes the object in source
    format under --output-dir -- the project's own fields as they are, and one field only the org holds.
*/
function answerObjectRetrieve(journey: RecipeCockpitJourney, argv: string[]): IFakeCliAnswer {
    const outputDirectory = argv[argv.indexOf('--output-dir') + 1];
    const stagedFieldsFolder = path.join(journey.workspaceRoot, ...outputDirectory.split('/'), 'main', 'default', 'objects', 'Account', 'fields');
    fs.mkdirSync(stagedFieldsFolder, { recursive: true });
    fs.cpSync(path.join(journey.workspaceRoot, ...ACCOUNT_FIELDS_FOLDER.split('/')), stagedFieldsFolder, { recursive: true });
    fs.writeFileSync(path.join(stagedFieldsFolder, 'Is_Priority__c.field-meta.xml'), IS_PRIORITY_FIELD_XML);
    return { stdout: JSON.stringify({ status: 0, result: { success: true, files: [] } }), exitCode: 0 };
}

export const OBJECT_REFRESH_JOURNEYS: IObjectRefreshJourney[] = [

    {
        name: 'Get latest object detail on the Account row: fields only, one new field listed and ticked, the confirmation, then its file in the project and one line in the recipe',
        run: async journey => {

            journey.cli.answer = argv => argv.slice(0, 3).join(' ') === 'project retrieve start' ? answerObjectRetrieve(journey, argv) : undefined;
            await chooseOrg(journey, SANDBOX_ORG_LABEL);
            const recipeBefore = readWorkspaceFile(journey, ACCOUNT_RECIPE_FILE);

            await journey.click('button', 'Get latest detail for Account');
            await journey.step('step 1 offers every kind, ticked', () => {
                const screen = journey.screen();
                ['Fields', 'Validation rules', 'Record types', 'Global value sets'].forEach(kindLabel => screen.get('checkbox', kindLabel));
            });
            await journey.click('checkbox', 'Validation rules');
            await journey.click('checkbox', 'Record types');
            await journey.click('checkbox', 'Global value sets');

            const fileChangeCountBefore = journey.fileChanges.length;
            await journey.click('button', 'Next');

            await journey.step('the object alone is retrieved into a staging folder, and nothing in the project changes', () => {
                expectEqual(journey.cli.calls.length, 1, 'The CLI calls');
                const argv = journey.cli.calls[0].argv;
                expectEqual(argv.slice(0, 6), ['project', 'retrieve', 'start', '--json', '--target-org', SANDBOX_USERNAME], 'The retrieve');
                expectEqual(fileChangesSince(journey, fileChangeCountBefore).filter(fileChange => fileChange.includes('force-app/') || fileChange.includes(ACCOUNT_RECIPE_FILE)), [], 'Project and recipe changes before Apply');
            });

            await journey.click('button', /^Fields · 1 new/);
            await journey.click('checkbox', 'Apply Is_Priority__c');
            await journey.click('button', 'Apply');
            await journey.waitForConfirmation();
            await journey.answerConfirmation('Apply to project and recipe');

            await journey.step('the field\'s file is in the project, one line is added to the recipe, every other line as it was, and one notification says so', () => {
                expectEqual(readWorkspaceFile(journey, `${ACCOUNT_FIELDS_FOLDER}/Is_Priority__c.field-meta.xml`), IS_PRIORITY_FIELD_XML, 'The copied field file');
                const linesBefore = recipeBefore.split('\n');
                const linesAfter = readWorkspaceFile(journey, ACCOUNT_RECIPE_FILE).split('\n');
                expectEqual(linesAfter.filter(recipeLine => !linesBefore.includes(recipeLine)), ['    Is_Priority__c: ${{ (random_choice("true", "false")).lower() }}'], 'The lines added to the recipe');
                expectEqual(linesBefore.filter(recipeLine => !linesAfter.includes(recipeLine)), [], 'The lines removed from the recipe');
                expectEqual(journey.notifications.map(notification => notification.text), [`Account: copied 1 file from ${SANDBOX_ORG_LABEL} · ${SANDBOX_USERNAME} into the project and wrote 1 recipe line.`], 'The notifications');
            });

        }
    }

];

export { openTroubleshootingJourney };
