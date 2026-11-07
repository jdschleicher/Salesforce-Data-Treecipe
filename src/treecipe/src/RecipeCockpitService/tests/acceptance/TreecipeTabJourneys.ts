import { RecipeCockpitJourney } from './RecipeCockpitJourney';
import {
    FIXED_VALUES_RELATIVE_PATH,
    RECIPE_RELATIVE_PATH,
    TREE_NAME,
    expectEqual,
    fileChangesSince,
    filteredRecipeOf,
    generateAndInsert,
    insertsSent,
    readFixtureFile,
    readWorkspaceFile
} from './TreecipeTabWorkspace';

/*
    The Treecipe tab's journeys (#578), each on its own copy of treecipeTabWorkspace: what a reader
    changes on a tree card, what the card then shows, and what Generate then writes and sends. Files are
    checked by their content and org calls by object and order, never by the cockpit's internal state.
*/

const recipeObjectNames = (recipeText: string) => [...recipeText.matchAll(/^\s*- object: (\S+)$/gm)].map(objectLine => objectLine[1]);
const recipeLinesOf = (recipeText: string, fieldApiName: string) => recipeText.split('\n').filter(recipeLine => new RegExp(`^\\s+${fieldApiName}: `).test(recipeLine)).map(recipeLine => recipeLine.trim());

export const TREECIPE_TAB_JOURNEYS: Array<{ name: string; run(journey: RecipeCockpitJourney): Promise<void> }> = [

    {
        name: 'exclude an object: its children are auto-excluded, and Generate writes and sends the tree without them',
        run: async journey => {

            await journey.click('button', 'Contact: Included — click to exclude');

            await journey.step('Contact reads excluded and Visit__c auto-excluded, and the card counts the objects left', () => {
                const screen = journey.screen();
                screen.get('text', 'Contact (Account_NickName-1) (excluded)');
                screen.get('text', 'Visit__c (Contact_NickName-1) (auto-excluded)');
                screen.get('button', 'Contact: Excluded — click to include');
                const visitToggle = screen.get('button', 'Visit__c: Excluded because parent Contact is excluded');
                expectEqual(visitToggle.states.includes('disabled'), true, 'Visit__c\'s include button is disabled');
                screen.get('text', 'auto-excluded — parent Contact excluded');
                screen.get('text', '1 of 3 objects · 51 fields');
            });

            const datasetFolder = await generateAndInsert(journey);

            await journey.step('the filtered recipe and the data set source leave Contact and Visit__c out', () => {
                expectEqual(recipeObjectNames(filteredRecipeOf(journey, datasetFolder)), ['Account'], 'The objects of the filtered recipe');
                const datasetSource = JSON.parse(readWorkspaceFile(journey, `${datasetFolder}/BaseArtifactFiles/datasetSource.json`));
                expectEqual(datasetSource.excludedObjectApiNames, ['Contact', 'Visit__c'], 'datasetSource.json excludedObjectApiNames');
                expectEqual(readWorkspaceFile(journey, RECIPE_RELATIVE_PATH), readFixtureFile(RECIPE_RELATIVE_PATH), 'The recipe file');
            });

            await journey.step('only Account is sent', () => {
                expectEqual(insertsSent(journey).map(insert => insert.objectApiName), ['Account'], 'The objects inserted, in order');
            });

        }
    },

    {
        name: 'untick every field of an object (#611): its row says no records will be generated, its children follow it out, and Generate writes and sends the tree without them',
        run: async journey => {

            await journey.click('button', 'Show or hide the fields of Contact');
            await journey.click('checkbox', /^All fields of Contact: /);

            await journey.step('Contact\'s row shows only the red message, its chain link is a disabled status, and Visit__c names why it is out', () => {
                const screen = journey.screen();
                screen.get('text', 'NO FIELDS SELECTED SO NO RECORDS WILL BE GENERATED');
                const contactLink = screen.get('button', 'Contact: No fields selected, so no records will be generated. Tick a field to include it');
                expectEqual(contactLink.states.includes('disabled'), true, 'Contact\'s chain link is disabled');
                screen.get('text', 'Contact (Account_NickName-1) (no fields selected)');
                const screenNames = screen.all().map(node => node.name);
                expectEqual(screenNames.filter(name => /^Contact_NickName(?!-)|Account_NickName-1, friend|^Create \d+ Contact record/.test(name)), [], 'Contact\'s nickname, friend chip and record count');
                screen.get('text', 'auto-excluded — parent Contact has no fields selected');
                screen.get('button', 'Visit__c: Excluded because parent Contact has no fields selected');
                screen.get('text', '1 of 3 objects · 51 fields');
            });

            const datasetFolder = await generateAndInsert(journey);

            await journey.step('the filtered recipe and the data set source leave Contact and Visit__c out', () => {
                expectEqual(recipeObjectNames(filteredRecipeOf(journey, datasetFolder)), ['Account'], 'The objects of the filtered recipe');
                const datasetSource = JSON.parse(readWorkspaceFile(journey, `${datasetFolder}/BaseArtifactFiles/datasetSource.json`));
                expectEqual(datasetSource.excludedObjectApiNames, ['Contact', 'Visit__c'], 'datasetSource.json excludedObjectApiNames');
                expectEqual(readWorkspaceFile(journey, RECIPE_RELATIVE_PATH), readFixtureFile(RECIPE_RELATIVE_PATH), 'The recipe file');
            });

            await journey.step('only Account is sent', () => {
                expectEqual(insertsSent(journey).map(insert => insert.objectApiName), ['Account'], 'The objects inserted, in order');
            });

            await journey.click('checkbox', 'LastName: Unticked — click to generate this field');

            await journey.step('one ticked field brings Contact and Visit__c back', () => {
                const screen = journey.screen();
                expectEqual(screen.findAll('text', 'NO FIELDS SELECTED SO NO RECORDS WILL BE GENERATED').length, 0, 'The red message is gone');
                screen.get('button', 'Contact: Included — click to exclude');
                screen.get('button', 'Visit__c: Included — click to exclude');
            });

        }
    },

    {
        name: 'untick a field: All fields reads mixed, RecordTypeId stays ticked, and the generated recipe drops the field',
        run: async journey => {

            await journey.click('button', 'Show or hide the fields of Account');
            await journey.click('checkbox', 'Region__c: Ticked — click to leave this field out');

            await journey.step('All fields reads mixed, and RecordTypeId says why it cannot be unticked', () => {
                const screen = journey.screen();
                screen.get('checkbox', 'Region__c: Unticked — click to generate this field');
                const allFieldsBox = screen.get('checkbox', /^All fields of Account: /);
                expectEqual({ name: allFieldsBox.name, states: allFieldsBox.states },
                    { name: 'All fields of Account: 22 of 23 fields ticked — click to tick every field', states: ['mixed'] }, 'The All fields box');
                const recordTypeIdBox = screen.get('checkbox', /^RecordTypeId: /);
                expectEqual({ name: recordTypeIdBox.name, states: recordTypeIdBox.states },
                    { name: 'RecordTypeId: Cannot be unticked: record-type sections depend on it', states: ['checked', 'disabled'] }, 'The RecordTypeId box');
            });

            const datasetFolder = await generateAndInsert(journey);

            await journey.step('the filtered recipe and the Account sent have no Region__c, and the recipe file is unchanged', () => {
                expectEqual(recipeLinesOf(filteredRecipeOf(journey, datasetFolder), 'Region__c'), [], 'Region__c lines in the filtered recipe');
                expectEqual(recipeLinesOf(filteredRecipeOf(journey, datasetFolder), 'Rating__c').length, 1, 'Rating__c lines in the filtered recipe');
                const [accountInsert] = insertsSent(journey);
                expectEqual({ objectApiName: accountInsert.objectApiName, hasRegion: 'Region__c' in accountInsert.records[0], hasRating: 'Rating__c' in accountInsert.records[0] },
                    { objectApiName: 'Account', hasRegion: false, hasRating: true }, 'The Account record sent');
                expectEqual(readWorkspaceFile(journey, RECIPE_RELATIVE_PATH), readFixtureFile(RECIPE_RELATIVE_PATH), 'The recipe file');
            });

        }
    },

    {
        name: 'set a record count: the card says Create 5, the filtered recipe carries count: 5, and the recipe file is unchanged',
        run: async journey => {

            await journey.click('button', 'Create 1 Account record(s), edit count');
            await journey.type('Account record(s)', '5');
            await journey.press('Account record(s)', 'Enter');

            await journey.step('the count reads Create 5', () => {
                journey.screen().get('button', 'Create 5 Account record(s), changed from the recipe\'s 1, edit count');
            });

            const datasetFolder = await generateAndInsert(journey);

            await journey.step('the filtered recipe counts 5 Accounts, 5 are sent, and the recipe file still says 1', () => {
                const filteredRecipe = filteredRecipeOf(journey, datasetFolder);
                expectEqual(/- object: Account\n {2}nickname: Account_NickName\n {2}count: (\d+)/.exec(filteredRecipe)?.[1], '5', 'The Account count in the filtered recipe');
                expectEqual(insertsSent(journey).map(insert => `${insert.objectApiName} × ${insert.records.length}`), ['Account × 5', 'Contact × 5', 'Visit__c × 5'], 'The records sent, in order');
                expectEqual(readWorkspaceFile(journey, RECIPE_RELATIVE_PATH), readFixtureFile(RECIPE_RELATIVE_PATH), 'The recipe file');
            });

        }
    },

    {
        name: 'edit a value, then Clear it: the confirmation names both files, Save pins the value, and Clear puts the lines back',
        run: async journey => {

            await journey.click('button', 'Show or hide the fields of Account');
            await journey.click('button', 'Region__c: Edit the faker expression, or give the field a fixed value');
            await journey.type('Value or faker expression for Account.Region__c', 'EMEA');
            await journey.click('button', 'Save', { role: 'group', name: 'Edit Account.Region__c' });

            await journey.waitForConfirmation();
            await journey.step('the confirmation names the recipe and leaves every other line alone', () => {
                const screen = journey.screen();
                const confirmationText = screen.lines(screen.get('dialog', 'Write a fixed value into Account.Region__c?')).join('\n');
                expectEqual(confirmationText.includes(`This writes to "${RECIPE_RELATIVE_PATH.split('/').pop()}": Account.Region__c becomes "EMEA" on every Account in it`), true, `The confirmation names the recipe: ${confirmationText}`);
            });

            let fileChangeCountBefore = journey.fileChanges.length;
            await journey.answerConfirmation('Write to recipe');

            await journey.step('every Region__c line holds EMEA, and the fixed-values file records the lines it replaced', () => {
                expectEqual(fileChangesSince(journey, fileChangeCountBefore), [`written ${FIXED_VALUES_RELATIVE_PATH}`, `written ${RECIPE_RELATIVE_PATH}`], 'Files written');
                expectEqual(recipeLinesOf(readWorkspaceFile(journey, RECIPE_RELATIVE_PATH), 'Region__c'), ['Region__c: "EMEA"'], 'Region__c lines in the recipe');
                expectEqual(readWorkspaceFile(journey, FIXED_VALUES_RELATIVE_PATH).includes('faker.lorem.text(40)'), true, 'The fixed-values file keeps the original line');
                journey.screen().get('button', 'Region__c: Fixed value — click to change or clear it');
            });

            await journey.click('button', 'Region__c: Fixed value — click to change or clear it');
            await journey.click('button', 'Clear', { role: 'group', name: 'Edit Account.Region__c' });

            await journey.waitForConfirmation();
            await journey.step('the Clear confirmation names the recipe and its fixed-values file', () => {
                const screen = journey.screen();
                const confirmationText = screen.lines(screen.get('dialog', 'Clear the edit of Account.Region__c?')).join('\n');
                expectEqual([RECIPE_RELATIVE_PATH, FIXED_VALUES_RELATIVE_PATH].map(relativePath => confirmationText.includes(`"${relativePath.split('/').pop()}"`)), [true, true], `The Clear confirmation names both files: ${confirmationText}`);
            });

            fileChangeCountBefore = journey.fileChanges.length;
            await journey.answerConfirmation('Put back');

            await journey.step('the recipe is byte for byte what Generate Treecipe wrote, and the fixed-values file is gone', () => {
                expectEqual(fileChangesSince(journey, fileChangeCountBefore), [`written ${RECIPE_RELATIVE_PATH}`, `removed ${FIXED_VALUES_RELATIVE_PATH}`], 'Files written or removed');
                expectEqual(readWorkspaceFile(journey, RECIPE_RELATIVE_PATH), readFixtureFile(RECIPE_RELATIVE_PATH), 'The recipe file');
                journey.screen().get('button', 'Region__c: Edit the faker expression, or give the field a fixed value');
            });

        }
    },

    {
        name: 'choose picklist values from the tiles: Save writes the faker-js expression, and Reset to generated restores the line',
        run: async journey => {

            await journey.click('button', 'Show or hide the fields of Account');
            await journey.click('button', 'Rating__c: Edit the faker expression, or give the field a fixed value');
            await journey.click('button', 'Edit values of Rating__c');
            await journey.click('checkbox', 'Cold', { role: 'group', name: 'Values of Account.Rating__c' });
            await journey.click('button', 'Save', { role: 'group', name: 'Edit values of Account.Rating__c' });

            await journey.waitForConfirmation();
            await journey.step('the confirmation shows the faker-js expression the ticked values make', () => {
                const screen = journey.screen();
                const confirmationText = screen.lines(screen.get('dialog', 'Write an edited faker expression into Account.Rating__c?')).join('\n');
                expectEqual(confirmationText.includes('Account.Rating__c becomes "${{ faker.helpers.arrayElement([`Hot`,`Warm`]) }}" on every Account in it'), true, `The confirmation: ${confirmationText}`);
            });

            await journey.answerConfirmation('Write to recipe');

            await journey.step('the Rating__c line is that expression, and the row reads edited', () => {
                expectEqual(recipeLinesOf(readWorkspaceFile(journey, RECIPE_RELATIVE_PATH), 'Rating__c')[0], 'Rating__c: "${{ faker.helpers.arrayElement([`Hot`,`Warm`]) }}"', 'The Rating__c line');
                journey.screen().get('button', 'Rating__c: Edited expression — click to change or clear it');
            });

            await journey.click('button', 'Edit values of Rating__c');
            await journey.click('button', 'Reset to generated', { role: 'group', name: 'Edit values of Account.Rating__c' });
            await journey.answerConfirmation('Put back');

            await journey.step('the recipe is byte for byte what Generate Treecipe wrote, and every value is ticked again', () => {
                expectEqual(readWorkspaceFile(journey, RECIPE_RELATIVE_PATH), readFixtureFile(RECIPE_RELATIVE_PATH), 'The recipe file');
                journey.screen().get('button', 'Rating__c: Edit the faker expression, or give the field a fixed value');
            });

        }
    },

    {
        name: 'record types: ticking Business and Partner and regenerating writes a run with an Account block for each',
        run: async journey => {

            await journey.click('button', `Manage record types (${TREE_NAME})`);
            await journey.click('checkbox', 'Partner (Account)');
            const fileChangeCountBefore = journey.fileChanges.length;
            await journey.click('button', 'Regenerate with these record types');

            await journey.step('a new run is written whose recipe has one Account block per record type, and the old run is kept', () => {
                const writtenRecipe = journey.fileChanges.slice(fileChangeCountBefore)
                    .map(fileChange => fileChange.relativePath)
                    .find(relativePath => /^treecipe\/GeneratedRecipes\/recipe-fakerjs-(?!2026-10-15T09-00-00)[^/]+\/Account-thru-Visit__c\/recipe-fakerjs--.+\.yml$/.test(relativePath));
                if ( !writtenRecipe ) { throw new Error(`no new run's recipe was written: ${JSON.stringify(fileChangesSince(journey, fileChangeCountBefore))}`); }
                const regeneratedRecipe = readWorkspaceFile(journey, writtenRecipe);
                expectEqual(recipeObjectNames(regeneratedRecipe), ['Account', 'Contact', 'Visit__c', 'Account'], 'The objects of the regenerated recipe: the Business block with its friends, then the Partner block');
                expectEqual(recipeLinesOf(regeneratedRecipe, 'RecordTypeId'), ['RecordTypeId: Account.Business', 'RecordTypeId: Account.Partner'], 'The RecordTypeId lines');
                expectEqual(readWorkspaceFile(journey, RECIPE_RELATIVE_PATH), readFixtureFile(RECIPE_RELATIVE_PATH), 'The run on screen before');
            });

        }
    }

];
