jest.mock('vscode', () => require('./acceptance/RecipeCockpitJourneyFakes').journeyVscodeModule, { virtual: true });
jest.mock('@salesforce/core', () => require('./acceptance/RecipeCockpitJourneyFakes').journeySalesforceCoreModule);

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { RecipeCockpitJourney } from './acceptance/RecipeCockpitJourney';
import { GENERATE_AND_INSERT_BUTTON_NAME, INSERT_ORG_LABEL, TREECIPE_TAB_FIXTURE, TREE_NAME, openTreecipeTabJourney } from './acceptance/TreecipeTabWorkspace';
import * as vscode from 'vscode';
import { IDerivedTreeRecipe, RECORD_TYPE_RECIPE_FOLDED_PROGRESS_MESSAGE, RECORD_TYPE_RECIPE_PROGRESS_TITLE, RecipeCockpitRecordTypeRecipe } from '../RecipeCockpitRecordTypeRecipe';
import { DirectoryProcessor, RecipeGenerationCancelledError } from '../../DirectoryProcessingService/DirectoryProcessor';
import { RecipeCockpitRecipeWriter } from '../../RecipeWriter/RecipeCockpitRecipeWriter';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { GlobalValueSetSingleton } from '../../GlobalValueSetSingleton/GlobalValueSetSingleton';
import { RecordTypeSelection } from '../../RecordTypeService/RecordTypeSelection';
import { RelationshipService } from '../../RelationshipService/RelationshipService';
import { XmlFileProcessor } from '../../XMLProcessingService/XmlFileProcessor';

/*
    buildDerivedTreeRecipes (#623, #702) on real object metadata, for both backends: the journey's workspace
    copy (Account with Business and Partner, Contact under it, Visit__c under Contact) stands in for
    an open window, so the same configuration and settings reads run as in the cockpit.
*/
describe.each(['faker-js', 'snowfakery'])('RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipes with %s (#623, #702)', (fakerService) => {

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
        const derivedRecipe = await RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipes(journey.workspaceRoot, treeFolderName, buildTreeRecipe => buildTreeRecipe(recordTypeSelection));
        if ( typeof derivedRecipe === 'string' ) { throw new Error(`no recipe was built: ${derivedRecipe}`); }
        return derivedRecipe;
    };

    // ONE CLICK'S BUILDS IN ONE SESSION, IN ORDER: EACH RECIPE, OR WHY THERE IS NONE
    const buildClickRecipes = (recordTypeSelections: Record<string, string[]>[]) => RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipes(journey.workspaceRoot, TREE_NAME, async buildTreeRecipe => {
        const clickRecipes: Array<IDerivedTreeRecipe | 'treeNotBuilt'> = [];
        for ( const recordTypeSelection of recordTypeSelections ) {
            clickRecipes.push(await buildTreeRecipe(recordTypeSelection));
        }
        return clickRecipes;
    });

    // HOW EACH RECIPE WAS BUILT BEFORE #702: A WALK OF ITS OWN THAT READS EVERY FILE AND COMBINES EVERY TREE
    const buildRecipeTheOldWay = async (recordTypeSelection: Record<string, string[]>): Promise<string | undefined> => {
        const objectsDirectoryPath = ConfigurationService.resolveObjectsDirectoryPath(journey.workspaceRoot);
        const objectInfoWrapper = await new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(objectsDirectoryPath), undefined,
            new RecordTypeSelection(Object.entries(recordTypeSelection), true));
        return objectInfoWrapper.RecipeFiles.find(recipeFile => RelationshipService.buildRecipeTreeFolderName(recipeFile.objects) === TREE_NAME)?.content;
    };

    const CONTACT_RECORD_TYPE_FOLDER = ['force-app', 'main', 'default', 'objects', 'Contact', 'recordTypes'];
    const writeContactRecordTypes = () => {
        const recordTypesFolderPath = path.join(journey.workspaceRoot, ...CONTACT_RECORD_TYPE_FOLDER);
        fs.mkdirSync(recordTypesFolderPath, { recursive: true });
        ['Employee', 'Vendor'].forEach(developerName => fs.writeFileSync(path.join(recordTypesFolderPath, `${developerName}.recordType-meta.xml`),
            `<?xml version="1.0" encoding="UTF-8"?>\n<RecordType xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${developerName}</fullName>\n    <active>true</active>\n    <label>${developerName}</label>\n</RecordType>\n`));
    };

    it.each([
        ['two sets: Account with Business and Partner', false, [
            { Account: ['Business', 'Partner'] },
            { Account: ['Business'] },
            { Account: ['Partner'] }
        ]],
        ['two objects: Account and Contact each with two record types', true, [
            { Account: ['Business', 'Partner'], Contact: ['Employee', 'Vendor'] },
            { Account: ['Business'], Contact: ['Employee'] },
            { Account: ['Business'], Contact: ['Vendor'] },
            { Account: ['Partner'], Contact: ['Employee'] },
            { Account: ['Partner'], Contact: ['Vendor'] }
        ]]
    ])('builds every recipe of one click byte for byte as a walk of its own did, %s', async (_caseName, isContactWithRecordTypes, recordTypeSelections) => {

        if ( isContactWithRecordTypes ) {
            writeContactRecordTypes();
        }

        const clickRecipes = await buildClickRecipes(recordTypeSelections);
        if ( clickRecipes === 'cancelled' ) { throw new Error('the build was cancelled'); }

        for ( const [selectionIndex, recordTypeSelection] of recordTypeSelections.entries() ) {
            const clickRecipe = clickRecipes[selectionIndex];
            if ( clickRecipe === 'treeNotBuilt' ) { throw new Error(`no recipe was built for ${JSON.stringify(recordTypeSelection)}`); }
            const oldRecipeText = await buildRecipeTheOldWay(recordTypeSelection);
            expect(clickRecipe.droppedTicks).toEqual([]);
            expect(clickRecipe.recipeText).toBe(oldRecipeText);
            expect([...RecipeCockpitRecipeWriter.listChosenRecordTypesByObject(clickRecipe.recipeText)]).toEqual(Object.entries(recordTypeSelection));
            expect([...RecipeCockpitRecipeWriter.countRecipeRecordsByObject(clickRecipe.recipeText)])
                .toEqual([...RecipeCockpitRecipeWriter.countRecipeRecordsByObject(oldRecipeText ?? '')]);
        }

    });

    it('reads the global value sets once and each field file once, behind one notification, however many recipes one click builds', async () => {

        const progressCallCountBefore = journey.hostCalls.filter(hostCall => hostCall.call === 'window.withProgress').length;
        const globalValueSetSpy = jest.spyOn(GlobalValueSetSingleton.getInstance(), 'initialize');
        const parseSpy = jest.spyOn(XmlFileProcessor, 'processXmlFieldContent');

        await buildClickRecipes([{ Account: ['Business', 'Partner'] }, { Account: ['Business'] }, { Account: ['Partner'] }]);

        expect(globalValueSetSpy).toHaveBeenCalledTimes(1);
        const parsedFieldFileNames = parseSpy.mock.calls.map(([, fieldFileName]) => fieldFileName);
        expect(parsedFieldFileNames.length).toBeGreaterThan(0);
        expect(parsedFieldFileNames.filter(fieldFileName => fieldFileName === 'Rating__c.field-meta.xml')).toHaveLength(1);
        expect(journey.hostCalls.filter(hostCall => hostCall.call === 'window.withProgress').slice(progressCallCountBefore).map(hostCall => hostCall.args[0])).toEqual([RECORD_TYPE_RECIPE_PROGRESS_TITLE]);

    });

    it('says in each walk message which build it is, and nothing extra for a lone build', async () => {

        const reportCountBefore = journey.hostCalls.filter(hostCall => hostCall.call === 'window.withProgress.report').length;
        await RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipes(journey.workspaceRoot, TREE_NAME, async buildTreeRecipe => {
            await buildTreeRecipe({ Account: ['Business', 'Partner'] });
            await buildTreeRecipe({ Account: ['Partner'] }, 'set 2 of 2 · Account · Partner');
        });
        const progressMessages = journey.hostCalls.filter(hostCall => hostCall.call === 'window.withProgress.report').slice(reportCountBefore).map(hostCall => hostCall.args[1]);

        expect(progressMessages[0]).toBe('Reading global value sets…');
        expect(progressMessages.filter(progressMessage => String(progressMessage).endsWith('Scanning objects…'))).toEqual(['Scanning objects…', 'set 2 of 2 · Account · Partner · Scanning objects…']);

    });

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

        await expect(RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipes(journey.workspaceRoot, 'Account-thru-Gone__c', buildTreeRecipe => buildTreeRecipe({ Account: ['Partner'] }))).resolves.toBe('treeNotBuilt');

    });

    it('answers cancelled when the reader cancels any walk of the click, builds none after it, and rethrows any other failure', async () => {

        const buildPartner = (buildTreeRecipe: (recordTypeSelection: Record<string, string[]>) => Promise<unknown>) => buildTreeRecipe({ Account: ['Partner'] });
        const walkSpy = jest.spyOn(DirectoryProcessor.prototype, 'processAllObjectsAndRelationships').mockRejectedValueOnce(new RecipeGenerationCancelledError());
        await expect(RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipes(journey.workspaceRoot, TREE_NAME, buildPartner)).resolves.toBe('cancelled');

        const buildAfterCancel = jest.fn();
        walkSpy.mockRejectedValueOnce(new RecipeGenerationCancelledError());
        await expect(RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipes(journey.workspaceRoot, TREE_NAME, async buildTreeRecipe => {
            await buildTreeRecipe({ Account: ['Business', 'Partner'] });
            buildAfterCancel();
        })).resolves.toBe('cancelled');
        expect(buildAfterCancel).not.toHaveBeenCalled();

        walkSpy.mockRejectedValueOnce(new Error('EACCES'));
        await expect(RecipeCockpitRecordTypeRecipe.buildDerivedTreeRecipes(journey.workspaceRoot, TREE_NAME, buildPartner)).rejects.toThrow('EACCES');

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

        jest.spyOn(RecipeCockpitRecordTypeRecipe, 'buildDerivedTreeRecipes').mockResolvedValue('cancelled');

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
    Every recipe of "A data set for each record type" is built before the confirmation (#624), behind
    one cancellable notification (#702). Each build's messages say which build it is (#695); a lone
    build says only what the walk does.
*/
describe('Generate fake data and insert, the progress of the record type recipe builds (#695, #702)', () => {

    let journey: RecipeCockpitJourney;

    beforeEach(async () => {
        journey = await openTreecipeTabJourney();
    });

    afterEach(async () => {
        await journey.close();
    });

    const recipeBuildTitles = () => journey.hostCalls
        .filter(hostCall => hostCall.call === 'window.withProgress')
        .map(hostCall => String(hostCall.args[0]))
        .filter(progressTitle => progressTitle.startsWith(RECORD_TYPE_RECIPE_PROGRESS_TITLE));

    // WHAT EACH BUILD'S FIRST WALK MESSAGE SAYS IT IS, IN ORDER; '' FOR A BUILD THAT SAYS NOTHING EXTRA
    const SCANNING_MESSAGE = 'Scanning objects…';
    const recipeBuildNames = () => journey.hostCalls
        .filter(hostCall => hostCall.call === 'window.withProgress.report' && hostCall.args[0] === RECORD_TYPE_RECIPE_PROGRESS_TITLE)
        .map(hostCall => String(hostCall.args[1]))
        .filter(progressMessage => progressMessage.endsWith(SCANNING_MESSAGE))
        .map(progressMessage => progressMessage.slice(0, -SCANNING_MESSAGE.length).replace(/ · $/, ''));

    it('shows one notification and numbers the folded build and each set\'s build in its messages when there is a set for each record type', async () => {

        await journey.click('button', `Manage record types (${TREE_NAME})`);
        await journey.click('checkbox', 'Partner (Account)');
        await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
        await journey.answerQuickPick(INSERT_ORG_LABEL);
        await journey.waitForConfirmation();

        expect(recipeBuildTitles()).toEqual([RECORD_TYPE_RECIPE_PROGRESS_TITLE]);
        expect(recipeBuildNames()).toEqual([
            RECORD_TYPE_RECIPE_FOLDED_PROGRESS_MESSAGE,
            'set 1 of 2 · Account · Business',
            'set 2 of 2 · Account · Partner'
        ]);

    });

    it('keeps the one title, with no build named, when only one data set can be made', async () => {

        await journey.click('button', `Manage record types (${TREE_NAME})`);
        await journey.click('checkbox', 'Partner (Account)');
        await journey.click('checkbox', 'Business (Account)');
        await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
        await journey.answerQuickPick(INSERT_ORG_LABEL);
        await journey.waitForConfirmation();

        expect(recipeBuildTitles()).toEqual([RECORD_TYPE_RECIPE_PROGRESS_TITLE]);
        expect(recipeBuildNames()).toEqual(['']);

    });

    it('refuses a tree the metadata no longer builds once, at the folded build, before any set is built', async () => {

        await journey.click('button', `Manage record types (${TREE_NAME})`);
        await journey.click('checkbox', 'Partner (Account)');
        fs.rmSync(path.join(journey.workspaceRoot, 'force-app', 'main', 'default', 'objects', 'Visit__c'), { recursive: true });
        await journey.click('button', GENERATE_AND_INSERT_BUTTON_NAME);
        await journey.answerQuickPick(INSERT_ORG_LABEL);

        expect(recipeBuildNames()).toEqual([RECORD_TYPE_RECIPE_FOLDED_PROGRESS_MESSAGE]);
        expect(journey.notifications.map(notification => notification.text)).toEqual([
            `Nothing was generated or inserted for ${TREE_NAME}: the object metadata no longer builds this tree, so its recipe could not be built for the ticked record types. Run "Generate Treecipe" again, then tick the record types.`
        ]);

    });

});
