jest.mock('vscode', () => require('./acceptance/RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./acceptance/RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { RecipeCockpitJourney } from './acceptance/RecipeCockpitJourney';
import { GENERATE_AND_INSERT_BUTTON_NAME, INSERT_ORG_LABEL, TREECIPE_TAB_FIXTURE, TREE_NAME, openTreecipeTabJourney } from './acceptance/TreecipeTabWorkspace';
import { IDerivedTreeRecipe, RECORD_TYPE_RECIPE_PROGRESS_TITLE, RecipeCockpitRecordTypeRecipe } from '../RecipeCockpitRecordTypeRecipe';
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
