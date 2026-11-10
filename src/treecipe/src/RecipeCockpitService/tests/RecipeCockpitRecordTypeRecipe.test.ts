jest.mock('vscode', () => ({
    Uri: { file: (filePath: string) => ({ scheme: 'file', fsPath: filePath }) }
}), { virtual: true });

import { IRecordTypeTickObject, RecipeCockpitRecordTypeRecipe } from '../RecipeCockpitRecordTypeRecipe';
import { RecipeCockpitRecipeWriter } from '../../RecipeWriter/RecipeCockpitRecipeWriter';

/*
    The rules of #623 that need no workspace: when the ticked record types need a recipe built for
    them, and where a card's settings land in that recipe. The recipe itself is built and inserted
    in the acceptance journeys (GenerateAndInsertJourneys), on real object metadata.
*/

const ACCOUNT_AT_DEFAULT: IRecordTypeTickObject = { objectApiName: 'Account', defaultDeveloperName: 'Business', generatedDeveloperNames: ['Business'] };
const ACCOUNT_WITH_BLOCKS: IRecordTypeTickObject = { objectApiName: 'Account', defaultDeveloperName: 'Business', generatedDeveloperNames: ['Business', 'Partner'] };

// THE FOLDED RECIPE OF Account {Business, Partner} WITH Contact UNDER EACH, AND A SELF-LOOKUP ITERATION UNDER THE FIRST BLOCK
const FOLDED_RECIPE = `- object: Account
  nickname: Account_Business_NickName
  count: 1
  fields:
    RecordTypeId: Account.Business
    Name: \${{faker.company.name()}}
  friends:
    - object: Contact
      nickname: Contact_NickName
      count: 1
      fields:
        LastName: \${{faker.person.lastName()}}
        AccountId: Account_Business_NickName
    - object: Account
      nickname: Account_child_NickName
      count: 1
      fields:
        RecordTypeId: Account.Business
        ParentId: Account_Business_NickName
- object: Account
  nickname: Account_Partner_NickName
  count: 1
  fields:
    RecordTypeId: Account.Partner
    Name: \${{faker.company.name()}}
  friends:
    - object: Contact
      nickname: Contact_Account_Partner_NickName
      count: 1
      fields:
        LastName: \${{faker.person.lastName()}}
        AccountId: Account_Partner_NickName
`;

const keyOf = (objectApiName: string, nickname?: string) => RecipeCockpitRecipeWriter.buildOccurrenceKey(objectApiName, nickname);
const buildPlacer = (runFirstNicknames: Array<[string, string]> = []) =>
    RecipeCockpitRecordTypeRecipe.buildOccurrenceSettingPlacer(FOLDED_RECIPE, new Map(runFirstNicknames), { Account: ['Business', 'Partner'] });

describe('RecipeCockpitRecordTypeRecipe (#623)', () => {

    describe('planGeneration', () => {

        it('given no ticks posted, generates from the run\'s recipe and offers no mode', () => {

            expect(RecipeCockpitRecordTypeRecipe.planGeneration([ACCOUNT_AT_DEFAULT], undefined)).toEqual({ isRecipeDerived: false, offeredModes: [], recordTypeSelection: {} });

        });

        it('given each object ticked at its default, generates from the run\'s recipe and offers no mode', () => {

            expect(RecipeCockpitRecordTypeRecipe.planGeneration([ACCOUNT_AT_DEFAULT], { Account: ['Business'] })).toEqual({ isRecipeDerived: false, offeredModes: [], recordTypeSelection: {} });

        });

        it('given more than one record type ticked, builds the recipe and offers folded', () => {

            expect(RecipeCockpitRecordTypeRecipe.planGeneration([ACCOUNT_AT_DEFAULT], { Account: ['Business', 'Partner'] }))
                .toEqual({ isRecipeDerived: true, offeredModes: ['folded'], recordTypeSelection: { Account: ['Business', 'Partner'] } });

        });

        it('given one record type ticked that is not the default, builds the recipe and offers folded', () => {

            expect(RecipeCockpitRecordTypeRecipe.planGeneration([ACCOUNT_AT_DEFAULT], { Account: ['Partner'] }))
                .toEqual({ isRecipeDerived: true, offeredModes: ['folded'], recordTypeSelection: { Account: ['Partner'] } });

        });

        it('keeps the order the record types were ticked in', () => {

            expect(RecipeCockpitRecordTypeRecipe.planGeneration([ACCOUNT_AT_DEFAULT], { Account: ['Partner', 'Business'] }).recordTypeSelection).toEqual({ Account: ['Partner', 'Business'] });

        });

        it('given a run that already writes both blocks and the same ticks, still builds the recipe, so each block gets its children', () => {

            expect(RecipeCockpitRecordTypeRecipe.planGeneration([ACCOUNT_WITH_BLOCKS], { Account: ['Business', 'Partner'] }))
                .toEqual({ isRecipeDerived: true, offeredModes: ['folded'], recordTypeSelection: { Account: ['Business', 'Partner'] } });

        });

        it('given a run that writes both blocks and only the default ticked, builds the default recipe and offers no mode', () => {

            expect(RecipeCockpitRecordTypeRecipe.planGeneration([ACCOUNT_WITH_BLOCKS], { Account: ['Business'] })).toEqual({ isRecipeDerived: true, offeredModes: [], recordTypeSelection: {} });

        });

        it('reads only the objects of the tree, and only their own keys', () => {

            const plan = RecipeCockpitRecordTypeRecipe.planGeneration([ACCOUNT_AT_DEFAULT], { Opportunity: ['New', 'Renewal'] });
            const inheritedPlan = RecipeCockpitRecordTypeRecipe.planGeneration([{ ...ACCOUNT_AT_DEFAULT, objectApiName: 'constructor' }], {});

            expect(plan).toEqual({ isRecipeDerived: false, offeredModes: [], recordTypeSelection: {} });
            expect(inheritedPlan).toEqual({ isRecipeDerived: false, offeredModes: [], recordTypeSelection: {} });

        });

        it('answers a selection with no prototype, so an object named __proto__ is a key', () => {

            const tickedDeveloperNamesByObject: Record<string, string[]> = Object.create(null);
            tickedDeveloperNamesByObject['__proto__'] = ['A', 'B'];
            const plan = RecipeCockpitRecordTypeRecipe.planGeneration([{ objectApiName: '__proto__', defaultDeveloperName: 'A', generatedDeveloperNames: ['A'] }], tickedDeveloperNamesByObject);

            expect(Object.getPrototypeOf(plan.recordTypeSelection)).toBeNull();
            expect(Object.keys(plan.recordTypeSelection)).toEqual(['__proto__']);

        });

    });

    describe('buildOccurrenceSettingPlacer', () => {

        it('leaves a setting stored by object as it is, so it applies to every block', () => {

            const placer = buildPlacer();

            expect(placer.place('Contact')).toBe('Contact');
            expect(placer.firstBlockOnlyKeys).toEqual([]);
            expect(placer.unplacedKeys).toEqual([]);

        });

        it('places a setting made on the run\'s first block on the recipe\'s first block, and says it reaches that block only', () => {

            const placer = buildPlacer([['Account', 'Account_NickName']]);

            expect(placer.place(keyOf('Account', 'Account_NickName'))).toBe(keyOf('Account', 'Account_Business_NickName'));
            expect(placer.firstBlockOnlyKeys).toEqual([keyOf('Account', 'Account_Business_NickName')]);

        });

        it('keeps a setting made on another copy the recipe still writes', () => {

            const placer = buildPlacer([['Account', 'Account_NickName']]);

            expect(placer.place(keyOf('Account', 'Account_child_NickName'))).toBe(keyOf('Account', 'Account_child_NickName'));
            expect(placer.firstBlockOnlyKeys).toEqual([]);

        });

        it('leaves out, and names, a setting made on a copy the recipe does not write', () => {

            const placer = buildPlacer([['Account', 'Account_NickName']]);

            expect(placer.place(keyOf('Account', 'Account_Reseller_NickName'))).toBeUndefined();
            expect(placer.placeKeys(new Map([[keyOf('Account', 'Account_Reseller_NickName'), ['Name']], ['Contact', ['LastName']]]))).toEqual(new Map([['Contact', ['LastName']]]));
            expect(placer.unplacedKeys).toEqual([keyOf('Account', 'Account_Reseller_NickName')]);

        });

        it('places an object\'s record count on every block and every copy, and never on a self-lookup iteration', () => {

            const placer = buildPlacer();

            expect(placer.placeCounts(new Map([['Account', 3], ['Contact', 5]]))).toEqual(new Map([
                [keyOf('Account', 'Account_Business_NickName'), 3],
                [keyOf('Account', 'Account_Partner_NickName'), 3],
                [keyOf('Contact', 'Contact_NickName'), 5],
                [keyOf('Contact', 'Contact_Account_Partner_NickName'), 5]
            ]));

        });

        it('lets a count made on one copy win over the object\'s count on that copy', () => {

            const placer = buildPlacer();

            expect(placer.placeCounts(new Map([[keyOf('Contact', 'Contact_Account_Partner_NickName'), 2], ['Contact', 5]]))).toEqual(new Map([
                [keyOf('Contact', 'Contact_NickName'), 5],
                [keyOf('Contact', 'Contact_Account_Partner_NickName'), 2]
            ]));

        });

        it('leaves an object the recipe does not write, and a count made on a copy it does not write, as nothing to place', () => {

            const placer = buildPlacer([['Account', 'Account_NickName']]);

            expect(placer.place(keyOf('Opportunity', 'Opportunity_NickName'))).toBeUndefined();
            expect(placer.placeCounts(new Map([['Opportunity', 4], [keyOf('Account', 'Account_Reseller_NickName'), 2], [keyOf('Account', 'Account_NickName'), 7]]))).toEqual(new Map([
                ['Opportunity', 4],
                [keyOf('Account', 'Account_Business_NickName'), 7]
            ]));
            expect(placer.unplacedKeys).toEqual([keyOf('Opportunity', 'Opportunity_NickName'), keyOf('Account', 'Account_Reseller_NickName')]);

        });

        it('given placed counts, the filtered recipe gives each record type the same number of children', () => {

            const placer = buildPlacer();
            const filterResult = RecipeCockpitRecipeWriter.buildFilteredRecipe(FOLDED_RECIPE, {
                excludedObjectApiNames: [],
                parentLookupsByObjectApiName: new Map(),
                objectCountsByObject: placer.placeCounts(new Map([['Contact', 5]]))
            });

            if ( 'refusal' in filterResult ) { throw new Error(filterResult.refusal.message); }
            expect(RecipeCockpitRecipeWriter.countRecipeRecordsByObject(filterResult.recipeText).get('Contact')).toBe(10);

        });

    });

    describe('buildConfirmationWarnings', () => {

        it('always says the recipe is built again from the object metadata', () => {

            expect(RecipeCockpitRecordTypeRecipe.buildConfirmationWarnings([], buildPlacer())).toEqual([
                'The recipe is built again from the object metadata for the ticked record types, so lines edited by hand in the recipe file and friends added on this card are not in it.'
            ]);

        });

        it('names the object and the record type of a tick the metadata no longer has', () => {

            const warnings = RecipeCockpitRecordTypeRecipe.buildConfirmationWarnings([{ objectApiName: 'Account', missingDeveloperNames: ['Partner'] }], buildPlacer());

            expect(warnings[1]).toBe('Account no longer has the record type Partner in the object metadata, so its ticks were dropped and it is generated with its default record type.');

        });

        it('says which settings reach the first block only, and which reach none', () => {

            const placer = buildPlacer([['Account', 'Account_NickName']]);
            placer.place(keyOf('Account', 'Account_NickName'));
            placer.place(keyOf('Account', 'Account_Reseller_NickName'));

            expect(RecipeCockpitRecordTypeRecipe.buildConfirmationWarnings([], placer).slice(1)).toEqual([
                'Settings made on one copy apply to the first record type block only: Account · Account_Business_NickName.',
                'Settings made on a copy this recipe does not write are not applied: Account · Account_Reseller_NickName.'
            ]);

        });

    });

});
