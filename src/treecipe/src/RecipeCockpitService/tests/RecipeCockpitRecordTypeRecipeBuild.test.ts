jest.mock('vscode', () => require('./acceptance/RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./acceptance/RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { RecipeCockpitJourney } from './acceptance/RecipeCockpitJourney';
import { TREECIPE_TAB_FIXTURE, TREE_NAME } from './acceptance/TreecipeTabWorkspace';
import { RecipeCockpitRecordTypeRecipe } from '../RecipeCockpitRecordTypeRecipe';
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

    const listWorkspaceFiles = (folderPath: string): string[] => fs.readdirSync(folderPath, { withFileTypes: true })
        .flatMap(entry => entry.isDirectory() ? listWorkspaceFiles(path.join(folderPath, entry.name)) : [path.join(folderPath, entry.name)]);

    it('builds the card\'s tree with a block per ticked record type, each with its own children, and writes nothing', async () => {

        const filesBefore = listWorkspaceFiles(journey.workspaceRoot);

        const derivedRecipe = await RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipe(journey.workspaceRoot, TREE_NAME, { Account: ['Business', 'Partner'] });

        expect(derivedRecipe?.droppedTicks).toEqual([]);
        const recipeText = derivedRecipe?.recipeText as string;
        expect(yaml.load(recipeText)).toBeArray();
        expect([...RecipeCockpitRecipeWriter.listChosenRecordTypesByObject(recipeText)]).toEqual([['Account', ['Business', 'Partner']]]);
        expect([...RecipeCockpitRecipeWriter.countRecipeRecordsByObject(recipeText)]).toEqual([['Account', 2], ['Contact', 2], ['Visit__c', 2]]);
        expect(listWorkspaceFiles(journey.workspaceRoot)).toEqual(filesBefore);

    });

    it('builds the default recipe for a selection that names no object', async () => {

        const derivedRecipe = await RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipe(journey.workspaceRoot, TREE_NAME, {});

        expect([...RecipeCockpitRecipeWriter.listChosenRecordTypesByObject(derivedRecipe?.recipeText as string)]).toEqual([]);
        expect([...RecipeCockpitRecipeWriter.countRecipeRecordsByObject(derivedRecipe?.recipeText as string)]).toEqual([['Account', 1], ['Contact', 1], ['Visit__c', 1]]);

    });

    it('drops the whole choice of an object ticked with a record type the metadata does not have, and names it', async () => {

        const derivedRecipe = await RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipe(journey.workspaceRoot, TREE_NAME, { Account: ['Partner', 'Reseller'] });

        expect(derivedRecipe?.droppedTicks).toEqual([{ objectApiName: 'Account', missingDeveloperNames: ['Reseller'] }]);
        expect([...RecipeCockpitRecipeWriter.listChosenRecordTypesByObject(derivedRecipe?.recipeText as string)]).toEqual([]);

    });

    it('answers no recipe for a tree the object metadata does not build', async () => {

        await expect(RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipe(journey.workspaceRoot, 'Account-thru-Gone__c', { Account: ['Partner'] })).resolves.toBeUndefined();

    });

});
