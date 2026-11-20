import * as matchers from 'jest-extended';
expect.extend(matchers);

import {
    RecipeCockpitCustomTreecipe,
    ICustomTreecipeDefinition,
    RECIPE_COCKPIT_CUSTOM_TREE_MAX_COPIES
} from '../RecipeCockpitCustomTreecipe';

const DEFINITION: ICustomTreecipeDefinition = {
    version: 1,
    sourceRunFolderName: 'recipe-2026-09-20T10-00-00',
    sourceTreeFolderName: 'Account-thru-OtherChildObject__c',
    sourceRecipeFileName: 'recipe--Account-thru-OtherChildObject__c-2026-09-20T10-00-00.yml',
    originalTreeFolderName: 'Account-thru-OtherChildObject__c',
    removedObjectApiNames: ['OtherChildObject__c'],
    removedFields: [{ objectApiName: 'Account', fieldApiNames: ['Legacy_Code__c'] }],
    outOfRunObjectApiNames: [],
    name: 'Accounts with contacts only',
    savedAt: '2026-11-20T22:24:09.000Z'
};

describe('RecipeCockpitCustomTreecipe (#677)', () => {

    describe('planCustomTreeFolderName', () => {

        test('names the first copy "custom-" plus the original tree, then takes the first free -2, -3', () => {

            expect(RecipeCockpitCustomTreecipe.planCustomTreeFolderName('Account-thru-Contact', new Set(['Account-thru-Contact']))).toBe('custom-Account-thru-Contact');
            expect(RecipeCockpitCustomTreecipe.planCustomTreeFolderName('Account-thru-Contact', new Set(['custom-Account-thru-Contact']))).toBe('custom-Account-thru-Contact-2');
            expect(RecipeCockpitCustomTreecipe.planCustomTreeFolderName('Account-thru-Contact', new Set(['custom-Account-thru-Contact', 'custom-Account-thru-Contact-2', 'custom-Account-thru-Contact-4'])))
                .toBe('custom-Account-thru-Contact-3');

        });

        test('answers undefined once every copy number up to the limit is taken', () => {

            const takenFolderNames = new Set(['custom-Lead-ONLY', ...Array.from({ length: RECIPE_COCKPIT_CUSTOM_TREE_MAX_COPIES - 1 }, (_, index) => `custom-Lead-ONLY-${index + 2}`)]);

            expect(RecipeCockpitCustomTreecipe.planCustomTreeFolderName('Lead-ONLY', takenFolderNames)).toBeUndefined();

        });

    });

    describe('resolveOriginalTreeFolderName', () => {

        test('a generated tree is its own original', () => {
            expect(RecipeCockpitCustomTreecipe.resolveOriginalTreeFolderName('Account-thru-Contact')).toBe('Account-thru-Contact');
        });

        test('a custom tree names the original its customTreecipe.json records, so customizing it again never gives custom-custom-', () => {

            const original = RecipeCockpitCustomTreecipe.resolveOriginalTreeFolderName('custom-Account-thru-OtherChildObject__c-2', DEFINITION);

            expect(original).toBe('Account-thru-OtherChildObject__c');
            expect(RecipeCockpitCustomTreecipe.planCustomTreeFolderName(original, new Set(['custom-Account-thru-OtherChildObject__c', 'custom-Account-thru-OtherChildObject__c-2'])))
                .toBe('custom-Account-thru-OtherChildObject__c-3');

        });

        test('without a readable customTreecipe.json, the prefix and the copy number come off the folder name', () => {

            expect(RecipeCockpitCustomTreecipe.resolveOriginalTreeFolderName('custom-Account-thru-Contact')).toBe('Account-thru-Contact');
            expect(RecipeCockpitCustomTreecipe.resolveOriginalTreeFolderName('custom-Account-thru-Contact-12')).toBe('Account-thru-Contact');
            // "-1" IS NEVER A COPY NUMBER THIS WRITES, SO IT STAYS PART OF THE NAME
            expect(RecipeCockpitCustomTreecipe.resolveOriginalTreeFolderName('custom-Lead-1')).toBe('Lead-1');

        });

    });

    test('isCustomTreeFolderName needs something after the prefix', () => {

        expect(RecipeCockpitCustomTreecipe.isCustomTreeFolderName('custom-Lead-ONLY')).toBeTrue();
        expect(RecipeCockpitCustomTreecipe.isCustomTreeFolderName('custom-')).toBeFalse();
        expect(RecipeCockpitCustomTreecipe.isCustomTreeFolderName('Customer__c-ONLY')).toBeFalse();

    });

    test('the recipe file name is the folder name and Generate Treecipe\'s UTC stamp, keeping the source\'s backend prefix and extension', () => {

        expect(RecipeCockpitCustomTreecipe.buildRecipeFileName('custom-Lead-ONLY', 'recipe--Lead-ONLY-2026-09-20T10-00-00.yml', new Date('2026-11-20T22:24:09.512Z')))
            .toBe('recipe--custom-Lead-ONLY-2026-11-20T22-24-09.yml');
        expect(RecipeCockpitCustomTreecipe.buildRecipeFileName('custom-Lead-ONLY', 'recipe-fakerjs--Lead-ONLY-2026-09-20T10-00-00.yml', new Date('2026-11-20T22:24:09Z')))
            .toBe('recipe-fakerjs--custom-Lead-ONLY-2026-11-20T22-24-09.yml');
        expect(RecipeCockpitCustomTreecipe.buildRecipeFileName('custom-Lead-ONLY', 'recipe--Lead-ONLY-2026-09-20T10-00-00.yaml', new Date('2026-01-02T03:04:05Z')))
            .toBe('recipe--custom-Lead-ONLY-2026-01-02T03-04-05.yaml');

    });

    test('a name is one trimmed line of at most 80 characters, and an empty one is no name', () => {

        expect(RecipeCockpitCustomTreecipe.normalizeCustomTreeName('  Accounts with contacts  ')).toBe('Accounts with contacts');
        expect(RecipeCockpitCustomTreecipe.normalizeCustomTreeName('   ')).toBeUndefined();
        expect(RecipeCockpitCustomTreecipe.normalizeCustomTreeName('two\nlines')).toBeUndefined();
        expect(RecipeCockpitCustomTreecipe.normalizeCustomTreeName('a\u2028b')).toBeUndefined();
        expect(RecipeCockpitCustomTreecipe.normalizeCustomTreeName('x'.repeat(81))).toBeUndefined();

    });

    describe('readDefinition', () => {

        test('reads back what buildDefinitionText wrote', () => {
            expect(RecipeCockpitCustomTreecipe.readDefinition(RecipeCockpitCustomTreecipe.buildDefinitionText(DEFINITION))).toEqual(DEFINITION);
        });

        test('reads a definition with no name', () => {

            const { name, ...unnamedDefinition } = DEFINITION;

            expect(name).toBeDefined();
            expect(RecipeCockpitCustomTreecipe.readDefinition(JSON.stringify(unnamedDefinition))).toEqual(unnamedDefinition);

        });

        test.each([
            ['not JSON', '{'],
            ['an array', '[]'],
            ['another version', JSON.stringify({ ...DEFINITION, version: 2 })],
            ['a run folder that steps out', JSON.stringify({ ...DEFINITION, sourceRunFolderName: '../elsewhere' })],
            ['a tree folder with a separator', JSON.stringify({ ...DEFINITION, sourceTreeFolderName: 'a/b' })],
            ['a recipe file name that steps out', JSON.stringify({ ...DEFINITION, sourceRecipeFileName: '..' })],
            ['a custom tree as the original', JSON.stringify({ ...DEFINITION, originalTreeFolderName: 'custom-Lead-ONLY' })],
            ['an object that is no api name', JSON.stringify({ ...DEFINITION, removedObjectApiNames: ['Account; DROP'] })],
            ['a field that is no api name', JSON.stringify({ ...DEFINITION, removedFields: [{ objectApiName: 'Account', fieldApiNames: ['<script>'] }] })],
            ['removed fields that are not a list', JSON.stringify({ ...DEFINITION, removedFields: { Account: ['Name'] } })],
            ['a name over two lines', JSON.stringify({ ...DEFINITION, name: 'a\nb' })],
            ['a name with spaces around it', JSON.stringify({ ...DEFINITION, name: ' padded ' })],
            ['a time that is no date', JSON.stringify({ ...DEFINITION, savedAt: 'yesterday' })]
        ])('refuses %s', (_, definitionText) => {
            expect(RecipeCockpitCustomTreecipe.readDefinition(definitionText)).toBeUndefined();
        });

        test('a __proto__ key in the file is a field it ignores, never a prototype', () => {

            const definition = RecipeCockpitCustomTreecipe.readDefinition(`{"__proto__": {"polluted": true}, ${RecipeCockpitCustomTreecipe.buildDefinitionText(DEFINITION).slice(1)}`);

            expect(definition).toEqual(DEFINITION);
            expect(({} as Record<string, unknown>).polluted).toBeUndefined();

        });

    });

});
