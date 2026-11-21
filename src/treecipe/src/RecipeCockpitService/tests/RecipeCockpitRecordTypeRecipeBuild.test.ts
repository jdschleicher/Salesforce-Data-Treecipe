jest.mock('vscode', () => require('./acceptance/RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./acceptance/RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { RecipeCockpitJourney } from './acceptance/RecipeCockpitJourney';
import { GENERATE_AND_INSERT_BUTTON_NAME, INSERT_ORG_LABEL, TREECIPE_TAB_FIXTURE, TREE_NAME, openTreecipeTabJourney } from './acceptance/TreecipeTabWorkspace';
import { IDerivedTreeRecipe, RECORD_TYPE_RECIPE_PROGRESS_TITLE, RECORD_TYPE_SET_MODE_LABELS, RecipeCockpitRecordTypeRecipe } from '../RecipeCockpitRecordTypeRecipe';
import { CollectionsApiService } from '../../CollectionsApiService/CollectionsApiService';
import { RecipeCockpitService } from '../RecipeCockpitService';
import { DirectoryProcessor, RecipeGenerationCancelledError } from '../../DirectoryProcessingService/DirectoryProcessor';
import { RecipeCockpitRecipeWriter } from '../../RecipeWriter/RecipeCockpitRecipeWriter';

/*
    buildDerivedTreeRecipe (#623) on real object metadata, for both backends: the journey's workspace
    copy (Account with Business and Partner, Contact under it, Visit__c under Contact) stands in for
    an open window, so the same configuration and settings reads run as in the cockpit.
*/
describe.each(['faker-js', 'snowfakery'])('RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipe with %s (#623)', (fakerService) => {

    let journey: RecipeCockpitJourney;

    beforeEach(async () => {
        journey = new RecipeCockpitJourney();
        journey.settings.set('salesforce-data-treecipe.selectedFakerService', fakerService);
        await journey.open(TREECIPE_TAB_FIXTURE);
    });

    afterEach(async () => {
        await journey.close();
    });

    // THE RECIPE BUILT, OR A FAILED TEST NAMING WHY THERE IS NONE
    const buildRecipe = async (treeFolderName: string, recordTypeSelection: Record<string, string[]>): Promise<IDerivedTreeRecipe> => {
        const derivedRecipe = await RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipe(journey.workspaceRoot, treeFolderName, recordTypeSelection);
        if ( typeof derivedRecipe === 'string' ) { throw new Error(`no recipe was built: ${derivedRecipe}`); }
        return derivedRecipe;
    };

    const listWorkspaceFiles = (folderPath: string): string[] => fs.readdirSync(folderPath, { withFileTypes: true })
        .flatMap(entry => entry.isDirectory() ? listWorkspaceFiles(path.join(folderPath, entry.name)) : [path.join(folderPath, entry.name)]);

    it('builds the card\'s tree with a block per ticked record type, each with its own children, and writes nothing', async () => {

        const filesBefore = listWorkspaceFiles(journey.workspaceRoot);

        const progressCallCountBefore = journey.hostCalls.filter(hostCall => hostCall.call === 'window.withProgress').length;
        const derivedRecipe = await buildRecipe(TREE_NAME, { Account: ['Business', 'Partner'] });

        expect(journey.hostCalls.filter(hostCall => hostCall.call === 'window.withProgress').slice(progressCallCountBefore).map(hostCall => hostCall.args[0])).toEqual([RECORD_TYPE_RECIPE_PROGRESS_TITLE]);
        expect(derivedRecipe.droppedTicks).toEqual([]);
        const recipeText = derivedRecipe.recipeText;
        expect(yaml.load(recipeText)).toBeArray();
        expect([...RecipeCockpitRecipeWriter.listChosenRecordTypesByObject(recipeText)]).toEqual([['Account', ['Business', 'Partner']]]);
        expect([...RecipeCockpitRecipeWriter.countRecipeRecordsByObject(recipeText)]).toEqual([['Account', 2], ['Contact', 2], ['Visit__c', 2]]);
        expect(listWorkspaceFiles(journey.workspaceRoot)).toEqual(filesBefore);

    });

    it('builds one set of "A data set for each record type" as one block per object, its record type written with no alternatives, and no child copies (#624)', async () => {

        const derivedRecipe = await buildRecipe(TREE_NAME, { Account: ['Partner'] });

        const recipeText = derivedRecipe.recipeText;
        expect(yaml.load(recipeText)).toBeArray();
        expect([...RecipeCockpitRecipeWriter.listChosenRecordTypesByObject(recipeText)]).toEqual([['Account', ['Partner']]]);
        expect([...RecipeCockpitRecipeWriter.countRecipeRecordsByObject(recipeText)]).toEqual([['Account', 1], ['Contact', 1], ['Visit__c', 1]]);
        expect(recipeText).not.toContain('Account.Business');

    });

    it('builds the default recipe for a selection that names no object', async () => {

        const derivedRecipe = await buildRecipe(TREE_NAME, {});

        expect([...RecipeCockpitRecipeWriter.listChosenRecordTypesByObject(derivedRecipe.recipeText)]).toEqual([]);
        expect([...RecipeCockpitRecipeWriter.countRecipeRecordsByObject(derivedRecipe.recipeText)]).toEqual([['Account', 1], ['Contact', 1], ['Visit__c', 1]]);

    });

    it('drops the whole choice of an object ticked with a record type the metadata does not have, and names it', async () => {

        const derivedRecipe = await buildRecipe(TREE_NAME, { Account: ['Partner', 'Reseller'] });

        expect(derivedRecipe.droppedTicks).toEqual([{ objectApiName: 'Account', missingDeveloperNames: ['Reseller'] }]);
        expect([...RecipeCockpitRecipeWriter.listChosenRecordTypesByObject(derivedRecipe.recipeText)]).toEqual([]);

    });

    it('answers no recipe for a tree the object metadata does not build', async () => {

        await expect(RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipe(journey.workspaceRoot, 'Account-thru-Gone__c', { Account: ['Partner'] })).resolves.toBe('treeNotBuilt');

    });

    it('answers cancelled when the reader cancels the walk, and rethrows any other failure', async () => {

        const walkSpy = jest.spyOn(DirectoryProcessor.prototype, 'processAllObjectsAndRelationships').mockRejectedValueOnce(new RecipeGenerationCancelledError());
        await expect(RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipe(journey.workspaceRoot, TREE_NAME, { Account: ['Partner'] })).resolves.toBe('cancelled');

        walkSpy.mockRejectedValueOnce(new Error('EACCES'));
        await expect(RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipe(journey.workspaceRoot, TREE_NAME, { Account: ['Partner'] })).rejects.toThrow('EACCES');

    });

});

describe('Generate fake data and insert, when the reader cancels the recipe build (#623)', () => {

    let journey: RecipeCockpitJourney;

    beforeEach(async () => {
        journey = await openTreecipeTabJourney();
    });

    afterEach(async () => {
        await journey.close();
    });

    it('says so once and asks, generates and sends nothing', async () => {

        jest.spyOn(RecipeCockpitRecordTypeRecipe, 'buildDerivedTreeRecipe').mockResolvedValue('cancelled');

        await journey.click('button', `Manage record types (${TREE_NAME})`);
        await journey.click('checkbox', 'Partner (Account)');
        const fileChangeCountBefore = journey.fileChanges.length;
        await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
        await journey.answerQuickPick(INSERT_ORG_LABEL);

        expect(journey.notifications.map(notification => ({ kind: notification.kind, text: notification.text }))).toEqual([{
            kind: 'information',
            text: `Nothing was generated or inserted for ${TREE_NAME}: building its recipe for the ticked record types was cancelled.`
        }]);
        expect(journey.screen().findAll('alertdialog')).toHaveLength(0);
        expect(journey.fileChanges.slice(fileChangeCountBefore)).toEqual([]);
        expect(journey.org.calls.filter(orgCall => /\.insert$/.test(orgCall.call))).toEqual([]);

    });

});

/*
    A cancel in "A data set for each record type" (#624) stops after the set it lands in: the sets
    before it stay, it ends as a cancel does today, and every set after it is not started.
*/
describe('A data set for each record type, when the reader cancels part way (#624)', () => {

    let journey: RecipeCockpitJourney;

    beforeEach(async () => {
        journey = await openTreecipeTabJourney();
    });

    afterEach(async () => {
        await journey.close();
    });

    const writtenDatasetFolderCount = (fileChangeCountBefore: number) => new Set(journey.fileChanges.slice(fileChangeCountBefore)
        .map(fileChange => /^(treecipe\/FakeDataSets\/dataset-fakerjs-[^/]+)\//.exec(fileChange.relativePath)?.[1])
        .filter(datasetFolder => datasetFolder !== undefined)).size;

    const generateSeparateSets = async () => {
        await journey.click('button', `Manage record types (${TREE_NAME})`);
        await journey.click('checkbox', 'Partner (Account)');
        await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
        await journey.answerQuickPick(INSERT_ORG_LABEL);
        await journey.waitForConfirmation();
        await journey.click('radio', RECORD_TYPE_SET_MODE_LABELS.separate);
        await journey.answerConfirmation('Generate and insert');
        await journey.answerQuickPick('AllOrNone: TRUE');
        await journey.waitForNotification(/^\d+ of \d+ data sets of /, 0);
    };

    const setsNotification = () => journey.notifications
        .filter(notification => /^\d+ of \d+ data sets of /.test(notification.text))
        .map(notification => ({ kind: notification.kind, text: notification.text }));

    it('keeps set 1 and inserts nothing of set 2 when its recipe build is cancelled', async () => {

        // THE FOLDED RECIPE AND SET 1'S ARE BUILT FOR THE CONFIRMATION; SET 2'S IS THE THIRD BUILD
        const buildDerivedTreeRecipe = RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipe.bind(RecipeCockpitRecordTypeRecipe);
        let buildCount = 0;
        jest.spyOn(RecipeCockpitRecordTypeRecipe, 'buildDerivedTreeRecipe').mockImplementation(async (...buildArguments) =>
            ++buildCount === 3 ? 'cancelled' : buildDerivedTreeRecipe(...buildArguments));
        const fileChangeCountBefore = journey.fileChanges.length;

        await generateSeparateSets();

        expect(buildCount).toBe(3);
        expect(writtenDatasetFolderCount(fileChangeCountBefore)).toBe(1);
        expect(journey.org.calls.filter(orgCall => /\.insert$/.test(orgCall.call))).toHaveLength(3);
        expect(setsNotification()).toEqual([{
            kind: 'warning',
            text: `1 of 2 data sets of ${TREE_NAME} were inserted into qa (qa@example.com.qa), one per record type. Set 1 (Account · Business) inserted 3 records. Set 2 (Account · Partner) was cancelled while its recipe was built, so nothing of it was inserted.`
        }]);

    });

    // A NEW OBJECT FOR THE SAME ORG IS A NEW SELECTION, AS ANOTHER PICK OR ⟳ MAKES ONE
    const changeOrgSelection = () => {
        const panelState = (RecipeCockpitService as any).recipeCockpitPanelState;
        panelState.dataOrgSelection = { ...panelState.dataOrgSelection };
    };

    it('numbers each set\'s recipe build in its progress title', async () => {

        await generateSeparateSets();

        expect(journey.hostCalls.filter(hostCall => hostCall.call === 'window.withProgress').map(hostCall => hostCall.args[0])
            .filter(progressTitle => String(progressTitle).startsWith(RECORD_TYPE_RECIPE_PROGRESS_TITLE))).toEqual([
            RECORD_TYPE_RECIPE_PROGRESS_TITLE,
            `${RECORD_TYPE_RECIPE_PROGRESS_TITLE}: set 1 of 2 (Account · Business)`,
            `${RECORD_TYPE_RECIPE_PROGRESS_TITLE}: set 2 of 2 (Account · Partner)`
        ]);

    });

    it('does not build set 2 when the org selection changed during set 1, and says so', async () => {

        const insertDataSetFolderIntoOrg = CollectionsApiService.insertDataSetFolderIntoOrg.bind(CollectionsApiService);
        const buildDerivedTreeRecipe = jest.spyOn(RecipeCockpitRecordTypeRecipe, 'buildDerivedTreeRecipe');
        jest.spyOn(CollectionsApiService, 'insertDataSetFolderIntoOrg').mockImplementation(async (...insertArguments) => {
            const insertResult = await insertDataSetFolderIntoOrg(...insertArguments);
            changeOrgSelection();
            return insertResult;
        });

        await generateSeparateSets();

        expect(buildDerivedTreeRecipe).toHaveBeenCalledTimes(2);
        expect(setsNotification()).toEqual([{
            kind: 'warning',
            text: `1 of 2 data sets of ${TREE_NAME} were inserted into qa (qa@example.com.qa), one per record type. Set 1 (Account · Business) inserted 3 records. Set 2 (Account · Partner) was not inserted, because the org selection changed after the confirmation; choose "Generate fake data and insert" again for the sets left.`
        }]);

    });

    it('generates set 2 but does not insert it when the org selection changed during its build', async () => {

        const buildDerivedTreeRecipe = RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipe.bind(RecipeCockpitRecordTypeRecipe);
        let buildCount = 0;
        jest.spyOn(RecipeCockpitRecordTypeRecipe, 'buildDerivedTreeRecipe').mockImplementation(async (...buildArguments) => {
            const derivedRecipe = await buildDerivedTreeRecipe(...buildArguments);
            if ( ++buildCount === 3 ) { changeOrgSelection(); }
            return derivedRecipe;
        });
        const fileChangeCountBefore = journey.fileChanges.length;

        await generateSeparateSets();

        expect(writtenDatasetFolderCount(fileChangeCountBefore)).toBe(2);
        expect(journey.org.calls.filter(orgCall => /\.insert$/.test(orgCall.call))).toHaveLength(3);
        expect(setsNotification()[0].text).toContain('Set 2 (Account · Partner) was not inserted, because the org selection changed after the confirmation');

    });

    it('names why set 2 was not generated when the metadata no longer builds the tree', async () => {

        const buildDerivedTreeRecipe = RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipe.bind(RecipeCockpitRecordTypeRecipe);
        let buildCount = 0;
        jest.spyOn(RecipeCockpitRecordTypeRecipe, 'buildDerivedTreeRecipe').mockImplementation(async (...buildArguments) =>
            ++buildCount === 3 ? 'treeNotBuilt' : buildDerivedTreeRecipe(...buildArguments));

        await generateSeparateSets();

        expect(setsNotification()).toEqual([{
            kind: 'error',
            text: `1 of 2 data sets of ${TREE_NAME} were inserted into qa (qa@example.com.qa), one per record type. Set 1 (Account · Business) inserted 3 records. Set 2 (Account · Partner) was not generated, so nothing of it was inserted (the object metadata no longer builds this tree, so its recipe could not be built for the ticked record types. Run "Generate Treecipe" again, then tick the record types).`
        }]);

    });

    it('rolls set 1 back as a cancel does, and does not start set 2, when set 1\'s insert is cancelled', async () => {

        const insertDataSetFolderIntoOrg = jest.spyOn(CollectionsApiService, 'insertDataSetFolderIntoOrg').mockResolvedValue({
            outcome: 'cancelled', isRolledBack: true, resultsFilePath: '', savedRecordCount: 0, failedRecordCount: 0
        });
        const fileChangeCountBefore = journey.fileChanges.length;

        await generateSeparateSets();

        expect(insertDataSetFolderIntoOrg).toHaveBeenCalledTimes(1);
        expect(writtenDatasetFolderCount(fileChangeCountBefore)).toBe(1);
        expect(setsNotification()).toEqual([{
            kind: 'warning',
            text: `0 of 2 data sets of ${TREE_NAME} were inserted into qa (qa@example.com.qa), one per record type. Set 1 (Account · Business) was cancelled, and every record it had inserted was deleted. Set 2 (Account · Partner) was not started.`
        }]);

    });

});
