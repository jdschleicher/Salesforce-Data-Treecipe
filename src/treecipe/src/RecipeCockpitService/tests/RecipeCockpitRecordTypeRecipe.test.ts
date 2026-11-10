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

        const placeOne = (placer: ReturnType<typeof buildPlacer>, settingKey: string) => [...placer.placeKeys(new Map([[settingKey, true]])).keys()];

        it('leaves a setting stored by object as it is, so it applies to every block', () => {

            const placer = buildPlacer();

            expect(placeOne(placer, 'Contact')).toEqual(['Contact']);
            expect(placer.firstBlockOnlyKeys).toEqual([]);
            expect(placer.unplacedKeys).toEqual([]);

        });

        it('places a setting made on the run\'s first block on the recipe\'s first block, and says it reaches that block only', () => {

            const placer = buildPlacer([['Account', 'Account_NickName']]);

            expect(placeOne(placer, keyOf('Account', 'Account_NickName'))).toEqual([keyOf('Account', 'Account_Business_NickName')]);
            expect(placer.firstBlockOnlyKeys).toEqual([keyOf('Account', 'Account_Business_NickName')]);

        });

        it('keeps a setting on its own block when the recipe still writes it, even when that block was the run\'s first and is no longer first', () => {

            // THE RUN WAS GENERATED AS [Partner, Business]; THE TICKS NOW SAY [Business, Partner]
            const placer = buildPlacer([['Account', 'Account_Partner_NickName']]);
            const placedSettings = placer.placeKeys(new Map([
                [keyOf('Account', 'Account_Partner_NickName'), ['Partner setting']],
                [keyOf('Account', 'Account_Business_NickName'), ['Business setting']]
            ]));

            expect(placedSettings).toEqual(new Map([
                [keyOf('Account', 'Account_Partner_NickName'), ['Partner setting']],
                [keyOf('Account', 'Account_Business_NickName'), ['Business setting']]
            ]));
            expect(placer.unplacedKeys).toEqual([]);

        });

        it('never puts a first-block setting over a setting the recipe\'s first block already has, and names the one left out', () => {

            // THE RUN WAS GENERATED AS [Reseller, Business]; RESELLER IS NO LONGER TICKED
            const placer = buildPlacer([['Account', 'Account_Reseller_NickName']]);
            const placedSettings = placer.placeKeys(new Map([
                [keyOf('Account', 'Account_Reseller_NickName'), ['Reseller setting']],
                [keyOf('Account', 'Account_Business_NickName'), ['Business setting']]
            ]));

            expect(placedSettings).toEqual(new Map([[keyOf('Account', 'Account_Business_NickName'), ['Business setting']]]));
            expect(placer.unplacedKeys).toEqual([keyOf('Account', 'Account_Reseller_NickName')]);

        });

        it('keeps a setting made on a self-lookup iteration, without saying it reaches one block only', () => {

            const placer = buildPlacer([['Account', 'Account_NickName']]);

            expect(placeOne(placer, keyOf('Account', 'Account_child_NickName'))).toEqual([keyOf('Account', 'Account_child_NickName')]);
            expect(placer.firstBlockOnlyKeys).toEqual([]);

        });

        it('says nothing of one block only for an object whose only other occurrence is its self-lookup iteration', () => {

            const selfLookupRecipe = FOLDED_RECIPE.slice(0, FOLDED_RECIPE.indexOf('- object: Account\n  nickname: Account_Partner_NickName')).replace(/Account_Business_NickName/g, 'Account_NickName');
            const placer = RecipeCockpitRecordTypeRecipe.buildOccurrenceSettingPlacer(selfLookupRecipe, new Map([['Account', 'Account_NickName']]), {});

            expect(placeOne(placer, keyOf('Account', 'Account_NickName'))).toEqual([keyOf('Account', 'Account_NickName')]);
            expect(placer.firstBlockOnlyKeys).toEqual([]);

        });

        it('leaves out, and names, a setting made on a copy the recipe does not write, or on an object it does not write', () => {

            const placer = buildPlacer([['Account', 'Account_NickName']]);

            expect(placer.placeKeys(new Map([
                [keyOf('Account', 'Account_Reseller_NickName'), ['Name']],
                [keyOf('Opportunity', 'Opportunity_NickName'), ['Name']],
                ['Contact', ['LastName']]
            ]))).toEqual(new Map([['Contact', ['LastName']]]));
            expect(placer.unplacedKeys).toEqual([keyOf('Account', 'Account_Reseller_NickName'), keyOf('Opportunity', 'Opportunity_NickName')]);

        });

        it('places an object\'s record count on every block and every copy, and never on a self-lookup iteration', () => {

            const placer = buildPlacer();

            expect(placer.placeCounts(new Map([['Account', 3], ['Contact', 5], ['Opportunity', 4]]))).toEqual(new Map([
                [keyOf('Account', 'Account_Business_NickName'), 3],
                [keyOf('Account', 'Account_Partner_NickName'), 3],
                [keyOf('Contact', 'Contact_NickName'), 5],
                [keyOf('Contact', 'Contact_Account_Partner_NickName'), 5],
                ['Opportunity', 4]
            ]));

        });

        it('treats a block as a self-lookup iteration only on an object that has one: a record type named child_… is a block', () => {

            const childRecordTypeRecipe = '- object: Case\n  nickname: Case_child_Tier_NickName\n  count: 1\n  fields:\n    RecordTypeId: Case.child_Tier\n- object: Case\n  nickname: Case_Standard_NickName\n  count: 1\n  fields:\n    RecordTypeId: Case.Standard\n';
            const placer = RecipeCockpitRecordTypeRecipe.buildOccurrenceSettingPlacer(childRecordTypeRecipe, new Map(), { Case: ['child_Tier', 'Standard'] });

            expect(placer.placeCounts(new Map([['Case', 2]]))).toEqual(new Map([
                [keyOf('Case', 'Case_child_Tier_NickName'), 2],
                [keyOf('Case', 'Case_Standard_NickName'), 2]
            ]));

        });

        it('lets a count made on one copy win over the object\'s count on that copy, and drops one made on a copy the recipe does not write', () => {

            const placer = buildPlacer([['Account', 'Account_NickName']]);

            expect(placer.placeCounts(new Map([
                [keyOf('Contact', 'Contact_Account_Partner_NickName'), 2],
                ['Contact', 5],
                [keyOf('Account', 'Account_Reseller_NickName'), 9],
                [keyOf('Account', 'Account_NickName'), 7]
            ]))).toEqual(new Map([
                [keyOf('Contact', 'Contact_NickName'), 5],
                [keyOf('Contact', 'Contact_Account_Partner_NickName'), 2],
                [keyOf('Account', 'Account_Business_NickName'), 7]
            ]));
            expect(placer.unplacedKeys).toEqual([keyOf('Account', 'Account_Reseller_NickName')]);

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

        it('names every object the recipe writes', () => {

            expect(buildPlacer().derivedObjectApiNames).toEqual(['Account', 'Contact']);

        });

        it('generates RecordTypeId for an object with record types ticked even when the card unticks it, and names the object', () => {

            const placer = buildPlacer();
            const keptExclusions = placer.keepRecordTypeIdOfChoiceObjects(new Map([
                ['Account', ['RecordTypeId', 'Name']],
                [keyOf('Account', 'Account_Partner_NickName'), ['RecordTypeId']],
                ['Contact', ['RecordTypeId', 'LastName']]
            ]));

            expect(keptExclusions).toEqual(new Map([['Account', ['Name']], ['Contact', ['RecordTypeId', 'LastName']]]));
            expect(placer.heldRecordTypeIdObjectApiNames).toEqual(['Account']);

        });

    });

    describe('buildRememberWarning', () => {

        it('says which record types treecipe.config.json will hold, and that an empty selection removes a saved one', () => {

            expect(RecipeCockpitRecordTypeRecipe.buildRememberWarning({ Account: ['Business', 'Partner'], Case: ['Tier'] }))
                .toBe('Remember this selection: treecipe.config.json will hold these record types for Generate Treecipe: Account: Business, Partner; Case: Tier.');
            expect(RecipeCockpitRecordTypeRecipe.buildRememberWarning({}))
                .toBe('Remember this selection: every object is ticked at its default record type, so any record types saved in treecipe.config.json will be removed.');

        });

    });

    describe('buildConfirmationWarnings', () => {

        it('always says the recipe is built again from the object metadata', () => {

            expect(RecipeCockpitRecordTypeRecipe.buildConfirmationWarnings([], buildPlacer())).toEqual([
                'The recipe is built again from the object metadata for the ticked record types, so what was written into the recipe file is not in it: lines edited by hand, lookups wired on this card, and parents or friends added on it.'
            ]);

        });

        it('names the object and the record type of a tick the metadata no longer has', () => {

            const warnings = RecipeCockpitRecordTypeRecipe.buildConfirmationWarnings([{ objectApiName: 'Account', missingDeveloperNames: ['Partner'] }], buildPlacer());

            expect(warnings[1]).toBe('Account no longer has the record type Partner in the object metadata, so its ticks were dropped and it is generated with its default record type.');

        });

        it('says which settings reach the first block only, and which reach none', () => {

            const placer = buildPlacer([['Account', 'Account_NickName']]);
            placer.placeKeys(new Map([[keyOf('Account', 'Account_NickName'), true], [keyOf('Account', 'Account_Reseller_NickName'), true]]));
            placer.keepRecordTypeIdOfChoiceObjects(new Map([['Account', ['RecordTypeId']]]));

            expect(RecipeCockpitRecordTypeRecipe.buildConfirmationWarnings([], placer).slice(1)).toEqual([
                'Settings made on one copy apply to the first record type block only: Account · Account_Business_NickName.',
                'Settings made on a copy this recipe does not write are not applied: Account · Account_Reseller_NickName.',
                'RecordTypeId is unticked on this card, and is generated all the same for the objects with record types ticked: Account.'
            ]);

        });

    });

});
