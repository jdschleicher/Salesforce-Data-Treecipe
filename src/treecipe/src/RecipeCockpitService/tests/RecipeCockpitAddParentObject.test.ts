import * as matchers from 'jest-extended';
expect.extend(matchers);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

jest.mock('vscode', () => ({}), { virtual: true });

import {
    RecipeCockpitRecipeWriter,
    ILookupWiringContext,
    IRecipeFilterLookup,
    IParentObjectAdditionRequest,
    RecipeParentObjectAdditionResult,
    RecipeWriterRefusalReason
} from '../RecipeCockpitRecipeWriter';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';
import { CollectionsApiService } from '../../CollectionsApiService/CollectionsApiService';

const TODO = '### TODO -- REFERENCE ID REQUIRED';
const RECIPE_WRITER_MOCKS_PATH = path.join(__dirname, 'mocks', 'recipeWriter');

const GENERATED_LAYOUTS: ReadonlyArray<[string, string]> = [
    ['snowfakery', 'recipe-snowfakery--RelationshipTree_1.yml'],
    ['faker-js', 'recipe-fakerjs--RelationshipTree_1.yml'],
    ['faker-js nested', 'recipe-fakerjs-nested--RelationshipTree_1.yml']
];

const LINE_ENDING_VARIANTS: ReadonlyArray<[string, string, boolean]> = [
    ['LF with a final newline', '\n', true],
    ['LF without a final newline', '\n', false],
    ['CRLF with a final newline', '\r\n', true],
    ['CRLF without a final newline', '\r\n', false]
];

const BACKEND_TEMPLATES: ReadonlyArray<[string, Record<string, Record<string, string>>]> = [
    ['faker-js', new FakerJSRecipeFakerService().getMinimumRequiredFieldsTemplate()],
    ['snowfakery', new SnowfakeryRecipeFakerService().getMinimumRequiredFieldsTemplate()]
];

function buildContext(lookups: Record<string, IRecipeFilterLookup[]>, levels?: Record<string, number>): ILookupWiringContext {
    return {
        parentLookupsByObjectApiName: new Map(Object.entries(lookups)),
        ...( levels ? { levelsByObjectApiName: new Map(Object.entries(levels)) } : {} )
    };
}

function toVariant(recipeText: string, lineEnding: string, hasFinalNewline: boolean): string {
    const lines = recipeText.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    return lines.join(lineEnding) + ( hasFinalNewline ? lineEnding : '' );
}

function expectApplied(result: RecipeParentObjectAdditionResult): Extract<RecipeParentObjectAdditionResult, { isApplied: true }> {
    if ( 'refusal' in result ) {
        throw new Error(`expected the parent to be added: ${result.refusal.message}`);
    }
    return result;
}

function expectRefused(result: RecipeParentObjectAdditionResult, expectedReason: RecipeWriterRefusalReason) {
    if ( !( 'refusal' in result ) ) {
        throw new Error('expected the addition to be refused');
    }
    expect(result.refusal.reason).toBe(expectedReason);
    return result.refusal;
}

const CONTACT_RECIPE = [
    '# Relationship Tree: RelationshipTree_1',
    '',
    '# Contact (Parents: Account)',
    '- object: Contact',
    '  nickname: Contact_NickName',
    '  count: 2',
    '  fields:',
    '    LastName: ${{ faker.person.lastName() }}',
    `    AccountId: ${TODO}`,
    `    Opportunity__c: ${TODO}`,
    `    Lead__c: ${TODO}`,
    `    Case__c: ${TODO}`,
    `    Owner__c: ${TODO}`,
    `    WhatId__c: ${TODO}`,
    `    Custom__c: ${TODO}`,
    ''
].join('\n');

const CONTACT_CONTEXT = buildContext({
    Contact: [
        { fieldApiName: 'AccountId', parentObjectApiName: 'Account' },
        { fieldApiName: 'Opportunity__c', parentObjectApiName: 'Opportunity' },
        { fieldApiName: 'Lead__c', parentObjectApiName: 'Lead' },
        { fieldApiName: 'Case__c', parentObjectApiName: 'Case' },
        { fieldApiName: 'Owner__c', parentObjectApiName: 'User' },
        { fieldApiName: 'WhatId__c', parentObjectApiName: 'Account' },
        { fieldApiName: 'WhatId__c', parentObjectApiName: 'Opportunity' },
        { fieldApiName: 'Custom__c', parentObjectApiName: 'Gadget__c' }
    ]
}, { Account: 0, Opportunity: 0, Lead: 0, Case: 0, User: 0, Gadget__c: 0, Contact: 1 });

function request(fieldApiName: string, parentTemplates: Record<string, Record<string, string>>, objectApiName = 'Contact', objectNickname?: string): IParentObjectAdditionRequest {
    return {
        objectApiName: objectApiName,
        ...( objectNickname !== undefined ? { objectNickname: objectNickname } : {} ),
        fieldApiName: fieldApiName,
        parentTemplatesByObjectApiName: parentTemplates
    };
}

describe('RecipeCockpitRecipeWriter add parent object (#294)', () => {

    describe('listAddableParentObjects', () => {

        test('lists a TODO lookup to one templated parent the recipe does not write, at a lower level', () => {

            const addable = RecipeCockpitRecipeWriter.listAddableParentObjects(CONTACT_RECIPE, CONTACT_CONTEXT, new Set(['Account', 'Contact', 'Lead', 'Opportunity', 'Case']));

            expect(addable).toEqual([
                { objectApiName: 'Contact', fieldApiName: 'AccountId', parentObjectApiName: 'Account' },
                { objectApiName: 'Contact', fieldApiName: 'Opportunity__c', parentObjectApiName: 'Opportunity' },
                { objectApiName: 'Contact', fieldApiName: 'Lead__c', parentObjectApiName: 'Lead' },
                { objectApiName: 'Contact', fieldApiName: 'Case__c', parentObjectApiName: 'Case' }
            ]);

        });

        test('lists nothing for a parent the recipe already writes', () => {

            const recipeWithAccount = `- object: Account\n  nickname: Account_NickName\n  count: 1\n  fields:\n    Name: x\n\n${CONTACT_RECIPE}`;
            const addable = RecipeCockpitRecipeWriter.listAddableParentObjects(recipeWithAccount, CONTACT_CONTEXT, new Set(['Account']));

            expect(addable).toEqual([]);

        });

        test('lists nothing without the levels that put the parent first', () => {

            const contextWithoutLevels = buildContext({ Contact: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }] });
            expect(RecipeCockpitRecipeWriter.listAddableParentObjects(CONTACT_RECIPE, contextWithoutLevels, new Set(['Account']))).toEqual([]);

            const sameLevelContext = buildContext({ Contact: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }] }, { Account: 1, Contact: 1 });
            expect(RecipeCockpitRecipeWriter.listAddableParentObjects(CONTACT_RECIPE, sameLevelContext, new Set(['Account']))).toEqual([]);

        });

        test('lists a lookup of an object written twice by its nickname only when every occurrence has its own', () => {

            const twiceRecipe = [
                '- object: Contact',
                '  nickname: Contact_NickName',
                '  count: 1',
                '  fields:',
                `    AccountId: ${TODO}`,
                '',
                '- object: Contact',
                '  nickname: Contact_Other_NickName',
                '  count: 1',
                '  fields:',
                `    AccountId: ${TODO}`,
                ''
            ].join('\n');

            expect(RecipeCockpitRecipeWriter.listAddableParentObjects(twiceRecipe, CONTACT_CONTEXT, new Set(['Account']))).toEqual([
                { objectApiName: 'Contact', objectNickname: 'Contact_NickName', fieldApiName: 'AccountId', parentObjectApiName: 'Account' },
                { objectApiName: 'Contact', objectNickname: 'Contact_Other_NickName', fieldApiName: 'AccountId', parentObjectApiName: 'Account' }
            ]);

            const indistinctRecipe = twiceRecipe.replace('Contact_Other_NickName', 'Contact_NickName');
            expect(RecipeCockpitRecipeWriter.listAddableParentObjects(indistinctRecipe, CONTACT_CONTEXT, new Set(['Account']))).toEqual([]);

        });

    });

    describe.each(BACKEND_TEMPLATES)('with the %s template', (_backendName, template) => {

        test.each(['Account', 'Opportunity', 'Lead', 'Case'])('adds %s with its minimum required fields and wires the lookup', (parentObjectApiName) => {

            const fieldApiName = { Account: 'AccountId', Opportunity: 'Opportunity__c', Lead: 'Lead__c', Case: 'Case__c' }[parentObjectApiName];
            const result = expectApplied(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request(fieldApiName, template), CONTACT_CONTEXT));

            expect(result.parentObjectApiName).toBe(parentObjectApiName);
            expect(result.parentNickname).toBe(`${parentObjectApiName}_NickName`);

            const loadedObjects = yaml.load(result.recipeText) as { object: string; nickname: string; count: number; fields?: Record<string, unknown> }[];
            expect(loadedObjects.map(loadedObject => loadedObject.object)).toEqual([parentObjectApiName, 'Contact']);

            const [loadedParent, loadedContact] = loadedObjects;
            expect(loadedParent.nickname).toBe(`${parentObjectApiName}_NickName`);
            expect(loadedParent.count).toBe(1);
            expect(Object.keys(loadedParent.fields ?? {})).toEqual(Object.keys(template[parentObjectApiName]));
            expect(loadedContact.fields[fieldApiName]).toBe(`${parentObjectApiName}_NickName`);
            // EVERY OTHER TODO STAYS THE NULL IT WAS
            expect(loadedContact.fields.Owner__c).toBeNull();

            if ( parentObjectApiName === 'Case' ) {
                expect(result.edits[0].insertedLines).toEqual([
                    '# Case (Added by the Recipe Cockpit as the parent of Contact.Case__c)',
                    '- object: Case',
                    '  nickname: Case_NickName',
                    '  count: 1',
                    ''
                ]);
                expect(loadedParent.fields).toBeUndefined();
            }

        });

        test('the new block reads before the comment lines that head the child\'s block', () => {

            const result = expectApplied(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('AccountId', template), CONTACT_CONTEXT));
            const lines = result.recipeText.split('\n');

            expect(lines.slice(0, 3)).toEqual(['# Relationship Tree: RelationshipTree_1', '', '# Account (Added by the Recipe Cockpit as the parent of Contact.AccountId)']);
            expect(lines[3]).toBe('- object: Account');
            expect(lines.indexOf('# Contact (Parents: Account)')).toBe(lines.indexOf('- object: Contact') - 1);

        });

    });

    describe.each(GENERATED_LAYOUTS)('against the generated %s recipe', (_layoutName, fixtureFileName) => {

        const generatedRecipe = fs.readFileSync(path.join(RECIPE_WRITER_MOCKS_PATH, fixtureFileName), 'utf-8');
        const campaignTemplate = { Campaign: { Name: '${{ fake.bs }}' } };
        const generatedContext = buildContext({
            Opportunity: [
                { fieldApiName: 'AccountId', parentObjectApiName: 'Account' },
                { fieldApiName: 'CampaignId', parentObjectApiName: 'Campaign' },
                { fieldApiName: 'ContractId', parentObjectApiName: 'Contract' }
            ]
        }, { Account: 0, Campaign: 0, Contract: 0, Opportunity: 1 });

        test('lists Opportunity.CampaignId only when Campaign has a template', () => {

            expect(RecipeCockpitRecipeWriter.listAddableParentObjects(generatedRecipe, generatedContext, new Set(['Campaign', 'Account'])))
                .toEqual([{ objectApiName: 'Opportunity', fieldApiName: 'CampaignId', parentObjectApiName: 'Campaign' }]);

        });

        test.each(LINE_ENDING_VARIANTS)('adds Campaign, changing only the new lines and the lookup\'s line (%s)', (_variantName, lineEnding, hasFinalNewline) => {

            const recipeText = toVariant(generatedRecipe, lineEnding, hasFinalNewline);
            const result = expectApplied(RecipeCockpitRecipeWriter.addParentObject(recipeText, request('CampaignId', campaignTemplate, 'Opportunity'), generatedContext));
            const [blockEdit, wireEdit] = result.edits;

            expect(blockEdit.operation).toBe('add-parent-object');
            expect(blockEdit.removedLines).toEqual([]);
            expect(wireEdit.operation).toBe('wire-lookup');
            expect(wireEdit.removedLines).toEqual([expect.stringMatching(/^ +CampaignId: ### TODO -- REFERENCE ID REQUIRED$/)]);
            expect(wireEdit.insertedLines).toEqual([wireEdit.removedLines[0].replace(TODO, 'Campaign_NickName')]);

            // TAKING THE BLOCK OUT AND PUTTING THE TODO BACK GIVES THE ORIGINAL BYTES, LINE ENDINGS INCLUDED
            const patchedLines = result.recipeText.split(/(?<=\n)/);
            const blockStartIndex = blockEdit.startLineNumber - 1;
            const restoredLines = [...patchedLines.slice(0, blockStartIndex), ...patchedLines.slice(blockStartIndex + blockEdit.insertedLines.length)];
            const wiredIndex = wireEdit.startLineNumber - 1 - blockEdit.insertedLines.length;
            restoredLines[wiredIndex] = restoredLines[wiredIndex].replace('Campaign_NickName', TODO);
            expect(restoredLines.join('')).toBe(recipeText);
            patchedLines.slice(blockStartIndex, blockStartIndex + blockEdit.insertedLines.length).forEach(patchedLine => expect(patchedLine.endsWith(lineEnding)).toBeTrue());

            const loadedObjects = yaml.load(result.recipeText) as { object: string; nickname: string; count: number; fields?: Record<string, unknown>; friends?: unknown[] }[];
            const findOpportunity = (objects: { object: string; fields?: Record<string, unknown>; friends?: unknown[] }[]): { fields?: Record<string, unknown> } | undefined => {
                for ( const loadedObject of objects ) {
                    if ( loadedObject.object === 'Opportunity' ) {
                        return loadedObject;
                    }
                    const nested = findOpportunity(( loadedObject.friends ?? [] ) as typeof objects);
                    if ( nested ) {
                        return nested;
                    }
                }
                return undefined;
            };

            const campaignIndex = loadedObjects.findIndex(loadedObject => loadedObject.object === 'Campaign');
            expect(loadedObjects[campaignIndex]).toEqual({ object: 'Campaign', nickname: 'Campaign_NickName', count: 1, fields: { Name: '${{ fake.bs }}' } });
            expect(findOpportunity(loadedObjects).fields.CampaignId).toBe('Campaign_NickName');

            // THE PARENT SITS AT THE TOP LEVEL AHEAD OF THE BLOCK HOLDING ITS CHILD
            const opportunityRootIndex = loadedObjects.findIndex(loadedObject => !!findOpportunity([loadedObject]));
            expect(campaignIndex).toBeLessThan(opportunityRootIndex);

            // THE BLOCK GOES ABOVE THE GENERATED COMMENT THAT NAMES THE TOP-LEVEL OBJECT, EVEN WITH A BLANK LINE BEFORE ITS HEADER, AND BELOW ANY BANNER
            const resultLines = result.recipeText.replace(/\r\n/g, '\n').split('\n');
            const lineAfterBlock = resultLines[blockStartIndex + blockEdit.insertedLines.length];
            const rootObjectApiName = loadedObjects[opportunityRootIndex].object;
            expect(lineAfterBlock).toStartWith(`# ${rootObjectApiName} (`);
            expect(resultLines[blockStartIndex - 1]).not.toStartWith(`# ${rootObjectApiName} (`);

            // ONCE ADDED IT IS NOT OFFERED AGAIN, AND THE RECIPE IS STILL WIRABLE THE #151 WAY FOR WHAT IT WAS BEFORE
            expect(RecipeCockpitRecipeWriter.listAddableParentObjects(result.recipeText, generatedContext, new Set(['Campaign']))).toEqual([]);

        });

    });

    describe('refusals', () => {

        const templates = BACKEND_TEMPLATES[0][1];

        test('a parent with no template, custom objects included', () => {

            expectRefused(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('Owner__c', templates), CONTACT_CONTEXT), 'no-parent-template');
            expectRefused(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('Custom__c', templates), CONTACT_CONTEXT), 'no-parent-template');

        });

        test('a parent the recipe already writes', () => {

            const recipeWithAccount = `- object: Account\n  nickname: Account_NickName\n  count: 1\n  fields:\n    Name: x\n\n${CONTACT_RECIPE}`;
            expectRefused(RecipeCockpitRecipeWriter.addParentObject(recipeWithAccount, request('AccountId', templates), CONTACT_CONTEXT), 'parent-object-already-exists');

        });

        test('a polymorphic lookup', () => {

            const refusal = expectRefused(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('WhatId__c', templates), CONTACT_CONTEXT), 'polymorphic-lookup');
            expect(refusal.message).toContain('Account or Opportunity');

        });

        test('a lookup changed on disk since it was listed', () => {

            const filledRecipe = CONTACT_RECIPE.replace(`AccountId: ${TODO}`, 'AccountId: Someone_Else');
            expectRefused(RecipeCockpitRecipeWriter.addParentObject(filledRecipe, request('AccountId', templates), CONTACT_CONTEXT), 'lookup-not-wireable');

            const continuedRecipe = CONTACT_RECIPE.replace(`AccountId: ${TODO}`, `AccountId: ${TODO}\n      continued`);
            expectRefused(RecipeCockpitRecipeWriter.addParentObject(continuedRecipe, request('AccountId', templates), CONTACT_CONTEXT), 'lookup-not-wireable');

            const goneRecipe = CONTACT_RECIPE.replace(`    AccountId: ${TODO}\n`, '');
            expectRefused(RecipeCockpitRecipeWriter.addParentObject(goneRecipe, request('AccountId', templates), CONTACT_CONTEXT), 'lookup-not-wireable');

        });

        test('a lookup the card does not name', () => {

            expectRefused(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('LastName', templates), CONTACT_CONTEXT), 'lookup-not-wireable');

        });

        test('an object written more than once whose occurrences cannot be told apart', () => {

            const twiceRecipe = `${CONTACT_RECIPE}\n${CONTACT_RECIPE.split('\n').slice(3).join('\n')}`;
            expectRefused(RecipeCockpitRecipeWriter.addParentObject(twiceRecipe, request('AccountId', templates), CONTACT_CONTEXT), 'duplicate-object');
            expectRefused(RecipeCockpitRecipeWriter.addParentObject(twiceRecipe, request('AccountId', templates, 'Contact', 'Contact_NickName'), CONTACT_CONTEXT), 'duplicate-object');

        });

        test('a parent not at a lower level', () => {

            const sameLevelContext = buildContext({ Contact: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }] }, { Account: 1, Contact: 1 });
            expectRefused(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('AccountId', templates), sameLevelContext), 'parent-not-inserted-first');

        });

        test('names that are not api names, an unknown object or nickname, and a template value that breaks the layout', () => {

            expectRefused(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('AccountId', templates, 'Con tact'), CONTACT_CONTEXT), 'invalid-object-api-name');
            expectRefused(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('AccountId', templates, 'Contact', 'bad nick'), CONTACT_CONTEXT), 'invalid-object-nickname');
            expectRefused(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('Account Id', templates), CONTACT_CONTEXT), 'invalid-field-api-name');
            expectRefused(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('AccountId', templates, 'Lead'), CONTACT_CONTEXT), 'object-not-found');
            expectRefused(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('AccountId', templates, 'Contact', 'Other_NickName'), CONTACT_CONTEXT), 'object-not-found');
            expectRefused(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('AccountId', { Account: { Name: 'x\n- object: Evil' } }), CONTACT_CONTEXT), 'invalid-value');
            expectRefused(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('AccountId', { Account: { Name: 'x y' } }), CONTACT_CONTEXT), 'invalid-value');
            expectRefused(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('AccountId', { Account: { 'Bad Name': 'x' } }), CONTACT_CONTEXT), 'invalid-value');

        });

        test('an object the card names no lookups for', () => {

            expectRefused(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('AccountId', templates), buildContext({})), 'lookup-not-wireable');

        });

        test('a result that does not read back as the same objects plus the parent', () => {

            const scanRecipeObjects = RecipeCockpitRecipeWriter.scanRecipeObjects.bind(RecipeCockpitRecipeWriter);
            jest.spyOn(RecipeCockpitRecipeWriter, 'scanRecipeObjects')
                .mockImplementationOnce(scanRecipeObjects)
                .mockImplementationOnce(() => []);

            expectRefused(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('AccountId', templates), CONTACT_CONTEXT), 'unsupported-field-layout');

        });

        test('a nickname another object already holds gets a suffix', () => {

            const clashingRecipe = CONTACT_RECIPE.replace('nickname: Contact_NickName', 'nickname: Account_NickName');
            const result = expectApplied(RecipeCockpitRecipeWriter.addParentObject(clashingRecipe, request('AccountId', templates), CONTACT_CONTEXT));

            expect(result.parentNickname).toBe('Account_NickName_2');
            expect((yaml.load(result.recipeText) as { fields?: Record<string, unknown> }[])[1].fields.AccountId).toBe('Account_NickName_2');

        });

    });

    describe('placement and occurrences', () => {

        const templates = BACKEND_TEMPLATES[0][1];

        test('a block for an object on the file\'s first line goes on the first line', () => {

            const bareRecipe = CONTACT_RECIPE.split('\n').slice(3).join('\n');
            const result = expectApplied(RecipeCockpitRecipeWriter.addParentObject(bareRecipe, request('AccountId', templates), CONTACT_CONTEXT));

            expect(result.edits[0].startLineNumber).toBe(1);
            expect(result.recipeText.startsWith('# Account (Added by the Recipe Cockpit as the parent of Contact.AccountId)\n- object: Account\n')).toBeTrue();
            expect(result.recipeText.endsWith(bareRecipe.replace(`AccountId: ${TODO}`, 'AccountId: Account_NickName'))).toBeTrue();

        });

        test('a comment that does not name the object stays above the block, and a heading separated by blank lines stays with its object', () => {

            const recipeWithBanner = [
                '# Level 1 - Contact',
                '# a reader\'s own note',
                '',
                '- object: Contact',
                '  nickname: Contact_NickName',
                '  count: 1',
                '  fields:',
                `    AccountId: ${TODO}`,
                ''
            ].join('\n');

            const bannerResult = expectApplied(RecipeCockpitRecipeWriter.addParentObject(recipeWithBanner, request('AccountId', templates), CONTACT_CONTEXT));
            expect(bannerResult.recipeText.split('\n').slice(0, 5)).toEqual([
                '# Level 1 - Contact',
                '# a reader\'s own note',
                '',
                '# Account (Added by the Recipe Cockpit as the parent of Contact.AccountId)',
                '- object: Account'
            ]);

            const recipeWithHeading = recipeWithBanner.replace('# a reader\'s own note', '# Contact (Parents: Account)');
            const headingResult = expectApplied(RecipeCockpitRecipeWriter.addParentObject(recipeWithHeading, request('AccountId', templates), CONTACT_CONTEXT));
            const headingLines = headingResult.recipeText.split('\n');
            expect(headingLines.slice(0, 2)).toEqual(['# Level 1 - Contact', '# Account (Added by the Recipe Cockpit as the parent of Contact.AccountId)']);
            expect(headingLines.slice(headingLines.indexOf('# Contact (Parents: Account)'), headingLines.indexOf('- object: Contact') + 1)).toEqual(['# Contact (Parents: Account)', '', '- object: Contact']);

        });

        test('an object whose name is not an api name is never offered and is refused', () => {

            const hostileRecipe = CONTACT_RECIPE.replace('- object: Contact', '- object: Evil[x](command:workbench.action.terminal.new)');
            const hostileContext = buildContext({
                'Evil[x](command:workbench.action.terminal.new)': [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }]
            }, { Account: 0, 'Evil[x](command:workbench.action.terminal.new)': 1 });

            expect(RecipeCockpitRecipeWriter.listAddableParentObjects(hostileRecipe, hostileContext, new Set(['Account']))).toEqual([]);
            expectRefused(RecipeCockpitRecipeWriter.addParentObject(hostileRecipe, request('AccountId', templates, 'Evil[x](command:workbench.action.terminal.new)'), hostileContext), 'invalid-object-api-name');

        });

        test('an object written twice is wired on the occurrence its nickname names, ahead of that occurrence\'s top-level block', () => {

            const twiceRecipe = [
                '- object: Contact',
                '  nickname: Contact_NickName',
                '  count: 1',
                '  fields:',
                `    AccountId: ${TODO}`,
                '',
                '- object: Contact',
                '  nickname: Contact_Other_NickName',
                '  count: 1',
                '  fields:',
                `    AccountId: ${TODO}`,
                ''
            ].join('\n');

            const result = expectApplied(RecipeCockpitRecipeWriter.addParentObject(twiceRecipe, request('AccountId', templates, 'Contact', 'Contact_Other_NickName'), CONTACT_CONTEXT));
            const loadedObjects = yaml.load(result.recipeText) as { object: string; nickname: string; fields?: Record<string, unknown> }[];

            expect(loadedObjects.map(loadedObject => loadedObject.nickname)).toEqual(['Contact_NickName', 'Account_NickName', 'Contact_Other_NickName']);
            expect(loadedObjects[0].fields.AccountId).toBeNull();
            expect(loadedObjects[2].fields.AccountId).toBe('Account_NickName');
            result.edits.forEach(edit => expect(edit.objectNickname).toBe('Contact_Other_NickName'));

        });

    });

    describe('end to end with faker-js and the insert\'s nickname swap', () => {

        test('the added Account is generated and the Contact lookups resolve to the Id the insert gives it', async () => {

            const template = new FakerJSRecipeFakerService().getMinimumRequiredFieldsTemplate();
            const result = expectApplied(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('AccountId', template), CONTACT_CONTEXT));

            const temporaryFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'add-parent-object-'));
            try {

                const recipeFilePath = path.join(temporaryFolderPath, 'recipe.yml');
                fs.writeFileSync(recipeFilePath, result.recipeText);

                const fakerJSRecipeProcessor = new FakerJSRecipeProcessor();
                const generatedJson = await fakerJSRecipeProcessor.generateFakeDataBySelectedRecipeFile(recipeFilePath);
                const collectionsApiFilesByObject = fakerJSRecipeProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(generatedJson);

                const accountRecords = collectionsApiFilesByObject.get('Account').records as { attributes: { referenceId: string }; Name: string }[];
                expect(accountRecords).toHaveLength(1);
                expect(accountRecords[0].Name).toBeString();

                const contactJson = JSON.stringify(collectionsApiFilesByObject.get('Contact'));
                const swappedContacts = JSON.parse(CollectionsApiService.updateLookupReferencesInCollectionApiJson(contactJson, { [accountRecords[0].attributes.referenceId]: '001000000000001AAA' })).records as { AccountId: string }[];

                expect(swappedContacts).toHaveLength(2);
                swappedContacts.forEach(contact => expect(contact.AccountId).toBe('001000000000001AAA'));

            } finally {
                fs.rmSync(temporaryFolderPath, { recursive: true, force: true });
            }

        });

    });

    describe('nest the tree under the added parent (#405)', () => {

        const accountTemplate = { Account: { Name: '${{ faker.company.name() }}' } };
        const nest = (recipeText: string, fieldApiName: string, context: ILookupWiringContext, objectApiName = 'Contact', objectNickname?: string, templates: Record<string, Record<string, string>> = accountTemplate) => (
            RecipeCockpitRecipeWriter.addParentObject(recipeText, { ...request(fieldApiName, templates, objectApiName, objectNickname), nestTreeUnderParent: true }, context)
        );

        test('moves the block, its heading included, one level deeper under the parent\'s friends: and wires the lookup', () => {

            const result = expectApplied(nest(CONTACT_RECIPE, 'AccountId', CONTACT_CONTEXT));

            expect(result.recipeText).toBe([
                '# Relationship Tree: RelationshipTree_1',
                '',
                '# Account (Added by the Recipe Cockpit as the parent of Contact, nested under it as friends)',
                '- object: Account',
                '  nickname: Account_NickName',
                '  count: 1',
                '  fields:',
                '    Name: ${{ faker.company.name() }}',
                '  friends:',
                '    # Contact (Parents: Account)',
                '    - object: Contact',
                '      nickname: Contact_NickName',
                '      count: 2',
                '      fields:',
                '        LastName: ${{ faker.person.lastName() }}',
                '        AccountId: Account_NickName',
                `        Opportunity__c: ${TODO}`,
                `        Lead__c: ${TODO}`,
                `        Case__c: ${TODO}`,
                `        Owner__c: ${TODO}`,
                `        WhatId__c: ${TODO}`,
                `        Custom__c: ${TODO}`,
                ''
            ].join('\n'));
            expect(result.nestedObjectApiNames).toEqual(['Contact']);
            expect(result.wiredLookups).toEqual([{ objectApiName: 'Contact', fieldApiName: 'AccountId' }]);
            expect(result.edits).toHaveLength(1);
            expect(result.edits[0].operation).toBe('add-parent-object');

            const [loadedAccount] = yaml.load(result.recipeText) as { object: string; friends: { object: string; count: number; fields: Record<string, unknown> }[] }[];
            expect(loadedAccount.object).toBe('Account');
            expect(loadedAccount.friends.map(friend => friend.object)).toEqual(['Contact']);
            expect(loadedAccount.friends[0].count).toBe(2);
            expect(loadedAccount.friends[0].fields.AccountId).toBe('Account_NickName');

        });

        test('without the flag the addition is #294\'s top-level block, byte for byte', () => {

            const flat = expectApplied(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, request('AccountId', accountTemplate), CONTACT_CONTEXT));
            const flagOff = expectApplied(RecipeCockpitRecipeWriter.addParentObject(CONTACT_RECIPE, { ...request('AccountId', accountTemplate), nestTreeUnderParent: false }, CONTACT_CONTEXT));

            expect(flagOff).toEqual(flat);
            expect(flat.nestedObjectApiNames).toBeUndefined();
            expect(flat.wiredLookups).toBeUndefined();

        });

        const FRIENDS_RECIPE = [
            '# Contact (Parents: Account)',
            '- object: Contact',
            '  nickname: Contact_NickName',
            '  count: 1',
            '  fields:',
            `    AccountId: ${TODO}`,
            '    Bio__c: |',
            '        line one',
            '',
            '          indented line',
            '  friends:',
            '    # Case (Parents: Account, Contact)',
            '    - object: Case',
            '      nickname: Case_NickName',
            '      count: 3',
            '      fields:',
            `        AccountId: ${TODO} -- Account`,
            '        ContactId: Contact_NickName',
            `        WhatId__c: ${TODO} -- Account, Opportunity`,
            '    - object: Peer__c',
            '      nickname: Peer_NickName',
            '      count: 1',
            '      fields:',
            `        Account__c: ${TODO}`,
            '',
            '# Lead (Parents: Account)',
            '- object: Lead',
            '  nickname: Lead_NickName',
            '  count: 1',
            '  fields:',
            `    Account__c: ${TODO}`,
            ''
        ].join('\n');

        const FRIENDS_CONTEXT = buildContext({
            Contact: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }],
            Case: [
                { fieldApiName: 'AccountId', parentObjectApiName: 'Account' },
                { fieldApiName: 'ContactId', parentObjectApiName: 'Contact' },
                { fieldApiName: 'WhatId__c', parentObjectApiName: 'Account' },
                { fieldApiName: 'WhatId__c', parentObjectApiName: 'Opportunity' }
            ],
            Peer__c: [{ fieldApiName: 'Account__c', parentObjectApiName: 'Account' }],
            Lead: [{ fieldApiName: 'Account__c', parentObjectApiName: 'Account' }]
        }, { Account: 0, Peer__c: 0, Contact: 1, Lead: 1, Case: 2 });

        test('moves a block with friends, wires every TODO lookup to the parent alone from a higher level, and leaves every other block as it was', () => {

            const result = expectApplied(nest(FRIENDS_RECIPE, 'AccountId', FRIENDS_CONTEXT));
            const resultLines = result.recipeText.split('\n');

            expect(result.wiredLookups).toEqual([
                { objectApiName: 'Contact', fieldApiName: 'AccountId' },
                { objectApiName: 'Case', fieldApiName: 'AccountId' }
            ]);
            expect(result.nestedObjectApiNames).toEqual(['Contact', 'Case', 'Peer__c']);
            expect(resultLines).toContain('        AccountId: Account_NickName');
            expect(resultLines).toContain('            AccountId: Account_NickName');
            // POLYMORPHIC, AND A FRIEND NOT AT A HIGHER LEVEL THAN THE PARENT, STAY TODOs
            expect(resultLines).toContain(`            WhatId__c: ${TODO} -- Account, Opportunity`);
            expect(resultLines).toContain(`            Account__c: ${TODO}`);
            // THE BLOCK SCALAR KEEPS ITS CONTENT AND ITS BLANK LINE
            expect(resultLines.slice(resultLines.indexOf('        Bio__c: |'), resultLines.indexOf('        Bio__c: |') + 4)).toEqual(['        Bio__c: |', '            line one', '', '              indented line']);
            // THE LEAD BLOCK AFTER IT IS UNTOUCHED
            expect(result.recipeText.endsWith(FRIENDS_RECIPE.slice(FRIENDS_RECIPE.indexOf('\n# Lead')))).toBeTrue();

            const [loadedAccount, loadedLead] = yaml.load(result.recipeText) as { object: string; fields: Record<string, unknown>; friends?: { object: string; fields: Record<string, unknown>; friends?: { object: string; count: number; fields: Record<string, unknown> }[] }[] }[];
            expect(loadedAccount.object).toBe('Account');
            const [loadedContact] = loadedAccount.friends;
            expect(loadedContact.fields.Bio__c).toBe('line one\n\n  indented line\n');
            expect(loadedContact.friends.map(friend => friend.object)).toEqual(['Case', 'Peer__c']);
            expect(loadedContact.friends[0].count).toBe(3);
            expect(loadedContact.friends[0].fields.AccountId).toBe('Account_NickName');
            expect(loadedLead.object).toBe('Lead');
            expect(loadedLead.fields.Account__c).toBeNull();

        });

        test('a self-lookup iteration moves with its block and both occurrences are wired', () => {

            const selfLookupRecipe = [
                '- object: Contact',
                '  nickname: Contact_NickName',
                '  count: 1',
                '  fields:',
                `    AccountId: ${TODO}`,
                `    ReportsToId: ${TODO} -- Contact`,
                '  friends:',
                '    # Contact (Child iteration of the Contact above, through ReportsToId)',
                '    - object: Contact',
                '      nickname: Contact_child_NickName',
                '      count: 1',
                '      fields:',
                `        AccountId: ${TODO} -- Account`,
                '        ReportsToId: Contact_NickName',
                ''
            ].join('\n');
            const selfLookupContext = buildContext({
                Contact: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }, { fieldApiName: 'ReportsToId', parentObjectApiName: 'Contact' }]
            }, { Account: 0, Contact: 1 });

            const result = expectApplied(nest(selfLookupRecipe, 'AccountId', selfLookupContext, 'Contact', 'Contact_child_NickName'));

            expect(result.wiredLookups).toEqual([
                { objectApiName: 'Contact', objectNickname: 'Contact_NickName', fieldApiName: 'AccountId' },
                { objectApiName: 'Contact', objectNickname: 'Contact_child_NickName', fieldApiName: 'AccountId' }
            ]);
            const scanned = RecipeCockpitRecipeWriter.scanRecipeObjects(result.recipeText.split('\n'));
            expect(scanned.map(scannedObject => [scannedObject.objectApiName, scannedObject.objectIndent, scannedObject.nicknames[0]])).toEqual([
                ['Account', 0, 'Account_NickName'],
                ['Contact', 4, 'Contact_NickName'],
                ['Contact', 8, 'Contact_child_NickName']
            ]);
            expect(result.recipeText).toContain(`        ReportsToId: ${TODO} -- Contact\n`);
            expect(result.recipeText).toContain('            ReportsToId: Contact_NickName\n');

        });

        describe.each(LINE_ENDING_VARIANTS)('against the generated nested faker-js recipe (%s)', (_variantName, lineEnding, hasFinalNewline) => {

            const generatedRecipe = toVariant(fs.readFileSync(path.join(RECIPE_WRITER_MOCKS_PATH, 'recipe-fakerjs-nested--RelationshipTree_1.yml'), 'utf-8'), lineEnding, hasFinalNewline);
            const generatedContext = buildContext({
                Opportunity: [{ fieldApiName: 'CampaignId', parentObjectApiName: 'Campaign' }]
            }, { Campaign: 0, Opportunity: 1 });

            test('adds Campaign above Account, every moved line four spaces deeper with its line ending, every other line as it was', () => {

                const result = expectApplied(nest(generatedRecipe, 'CampaignId', generatedContext, 'Opportunity', undefined, { Campaign: { Name: '${{ fake.bs }}' } }));
                const [edit] = result.edits;
                const parentLineCount = edit.insertedLines.length - edit.removedLines.length;
                const patchedLines = result.recipeText.split(/(?<=\n)/);
                const startIndex = edit.startLineNumber - 1;

                patchedLines.slice(startIndex, startIndex + parentLineCount).forEach(patchedLine => expect(patchedLine.endsWith(lineEnding)).toBeTrue());

                // TAKING THE PARENT'S LINES OUT, MOVING THE BLOCK BACK AND PUTTING THE TODO BACK GIVES THE ORIGINAL BYTES
                const restoredLines = [...patchedLines.slice(0, startIndex), ...patchedLines.slice(startIndex + parentLineCount)].map((restoredLine, lineIndex) => {
                    if ( lineIndex < startIndex || lineIndex >= startIndex + edit.removedLines.length ) {
                        return restoredLine;
                    }
                    const unindented = /^\s*$/.test(restoredLine) ? restoredLine : restoredLine.slice(4);
                    return unindented.replace(/^( +CampaignId: )Campaign_NickName/, `$1${TODO}`);
                });
                expect(restoredLines.join('')).toBe(generatedRecipe);

                const loadedObjects = yaml.load(result.recipeText) as { object: string; friends?: { object: string }[] }[];
                expect(loadedObjects[0].object).toBe('Campaign');
                expect(loadedObjects[0].friends.map(friend => friend.object)).toEqual(['Account']);
                expect(loadedObjects.slice(1).map(loadedObject => loadedObject.object)).toEqual(['Product_Family__c', 'MegaMapMadness__c']);
                expect(result.wiredLookups).toEqual([{ objectApiName: 'Opportunity', fieldApiName: 'CampaignId' }]);
                expect(RecipeCockpitRecipeWriter.listAddableParentObjects(result.recipeText, generatedContext, new Set(['Campaign']))).toEqual([]);

            });

        });

        test('refuses a moved block with a line break inside a line', () => {

            ['\r', '\u0085', '\u2028', '\u2029'].forEach(lineBreak => {
                const brokenRecipe = CONTACT_RECIPE.replace(`    Custom__c: ${TODO}\n`, `    Custom__c: ${TODO}\n    Note__c: a${lineBreak}b\n`);
                expectRefused(nest(brokenRecipe, 'AccountId', CONTACT_CONTEXT), 'unsupported-friend-layout');
            });

        });

        test('refuses a block that continues after a column-0 comment, and keeps a column-0 comment that heads the next block', () => {

            const contactBlock = ['- object: Contact', '  nickname: Contact_NickName', '  count: 1', '  fields:', `    AccountId: ${TODO}`];
            const context = buildContext({ Contact: [{ fieldApiName: 'AccountId', parentObjectApiName: 'Account' }] }, { Account: 0, Contact: 1, Case: 2 });

            // YAML READS EACH AS ONE CONTACT BLOCK, SO MOVING ONLY THE LINES ABOVE THE COMMENT WOULD LEAVE A RECIPE THAT DOES NOT LOAD
            [
                [...contactBlock, '# a note', '  friends:', '    - object: Case', '      nickname: Case_NickName', '      count: 1', ''],
                [...contactBlock, '# a note', '    LastName: x', '', '- object: Lead', '  nickname: Lead_NickName', '  count: 1', '']
            ].forEach(recipeLines => {
                const recipeText = recipeLines.join('\n');
                expect(() => yaml.load(recipeText)).not.toThrow();
                expect(expectRefused(nest(recipeText, 'AccountId', context), 'unsupported-friend-layout').message).toContain('continues after a line at column 0');
            });

            const headedNextBlock = [...contactBlock, '', '# Lead (a reader\'s note)', '# Level 2', '- object: Lead', '  nickname: Lead_NickName', '  count: 1', ''].join('\n');
            const result = expectApplied(nest(headedNextBlock, 'AccountId', context));
            expect(result.recipeText.endsWith('\n\n# Lead (a reader\'s note)\n# Level 2\n- object: Lead\n  nickname: Lead_NickName\n  count: 1\n')).toBeTrue();
            expect((yaml.load(result.recipeText) as { object: string }[]).map(loadedObject => loadedObject.object)).toEqual(['Account', 'Lead']);

        });

        test('refuses what #294 refuses, and a result that does not read back', () => {

            expectRefused(nest(CONTACT_RECIPE, 'WhatId__c', CONTACT_CONTEXT), 'polymorphic-lookup');
            const indistinctRecipe = `${CONTACT_RECIPE}\n${CONTACT_RECIPE.split('\n').slice(3).join('\n')}`;
            expectRefused(nest(indistinctRecipe, 'AccountId', CONTACT_CONTEXT, 'Contact', 'Contact_NickName'), 'duplicate-object');
            expectRefused(nest(CONTACT_RECIPE.replace(`AccountId: ${TODO}`, 'AccountId: x'), 'AccountId', CONTACT_CONTEXT), 'lookup-not-wireable');

            // THE REQUESTED LOOKUP MUST BE AMONG THE MOVED BLOCK'S WIRINGS
            const listNestedParentWirings = jest.spyOn(RecipeCockpitRecipeWriter as any, 'listNestedParentWirings').mockReturnValueOnce([]);
            expectRefused(nest(CONTACT_RECIPE, 'AccountId', CONTACT_CONTEXT), 'lookup-not-wireable');
            listNestedParentWirings.mockRestore();

            const scanRecipeObjects = RecipeCockpitRecipeWriter.scanRecipeObjects.bind(RecipeCockpitRecipeWriter);
            jest.spyOn(RecipeCockpitRecipeWriter, 'scanRecipeObjects')
                .mockImplementationOnce(scanRecipeObjects)
                .mockImplementationOnce(() => []);

            expectRefused(nest(CONTACT_RECIPE, 'AccountId', CONTACT_CONTEXT), 'unsupported-friend-layout');

        });

        test('the nested recipe generates one Account, and every lookup the insert swaps names its Id', async () => {

            const result = expectApplied(nest(FRIENDS_RECIPE.slice(0, FRIENDS_RECIPE.indexOf('\n# Lead') + 1), 'AccountId', FRIENDS_CONTEXT, 'Contact', undefined, new FakerJSRecipeFakerService().getMinimumRequiredFieldsTemplate()));

            const temporaryFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-parent-object-'));
            try {

                const recipeFilePath = path.join(temporaryFolderPath, 'recipe.yml');
                fs.writeFileSync(recipeFilePath, result.recipeText);

                const fakerJSRecipeProcessor = new FakerJSRecipeProcessor();
                const generatedJson = await fakerJSRecipeProcessor.generateFakeDataBySelectedRecipeFile(recipeFilePath);
                const collectionsApiFilesByObject = fakerJSRecipeProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(generatedJson);

                const accountRecords = collectionsApiFilesByObject.get('Account').records as { attributes: { referenceId: string } }[];
                expect(accountRecords).toHaveLength(1);
                const idsByReference = { [accountRecords[0].attributes.referenceId]: '001000000000001AAA' };

                const swap = (objectApiName: string) => JSON.parse(CollectionsApiService.updateLookupReferencesInCollectionApiJson(JSON.stringify(collectionsApiFilesByObject.get(objectApiName)), idsByReference)).records as Record<string, unknown>[];
                const contacts = swap('Contact');
                const cases = swap('Case');

                expect(contacts).toHaveLength(1);
                expect(cases).toHaveLength(3);
                [...contacts, ...cases].forEach(record => expect(record.AccountId).toBe('001000000000001AAA'));

            } finally {
                fs.rmSync(temporaryFolderPath, { recursive: true, force: true });
            }

        });

    });

});
