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

});
