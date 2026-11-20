import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

jest.mock('vscode', () => {
    const realFs = jest.requireActual('fs');
    const realPath = jest.requireActual('path');
    const toUri = (fsPath: string) => ({ fsPath: fsPath, path: fsPath });
    return {
        workspace: {
            workspaceFolders: undefined,
            fs: {
                readDirectory: async (directoryUri: { fsPath: string }) => {
                    try {
                        return realFs.readdirSync(directoryUri.fsPath, { withFileTypes: true })
                            .map((entry: { name: string; isDirectory: () => boolean }) => [entry.name, entry.isDirectory() ? 2 : 1])
                            .sort(([first]: [string], [second]: [string]) => ( first < second ? -1 : ( first > second ? 1 : 0 ) ));
                    } catch {
                        return [];
                    }
                },
                readFile: async (fileUri: { fsPath: string }) => realFs.readFileSync(fileUri.fsPath)
            }
        },
        Uri: {
            file: toUri,
            joinPath: (baseUri: { fsPath: string }, ...segments: string[]) => toUri(realPath.join(baseUri.fsPath, ...segments))
        },
        window: { showWarningMessage: jest.fn(), showInformationMessage: jest.fn(), showErrorMessage: jest.fn() },
        FileType: { Directory: 2, File: 1, SymbolicLink: 64 },
        ThemeIcon: jest.fn()
    };
}, { virtual: true });

import * as vscode from 'vscode';
import { ConfigurationService } from '../../ConfigurationService/ConfigurationService';
import { RecipeFakerServiceFactory } from '../../FakerRecipeProcessor/RecipeFakerServiceFactory';
import { DirectoryProcessor } from '../DirectoryProcessor';
import { IRecipeFakerService } from '../../RecipeFakerService.ts/IRecipeFakerService';
import { FakerJSRecipeFakerService } from '../../RecipeFakerService.ts/FakerJSRecipeFakerService/FakerJSRecipeFakerService';
import { SnowfakeryRecipeFakerService } from '../../RecipeFakerService.ts/SnowfakeryRecipeFakerService/SnowfakeryRecipeFakerService';
import { RelationshipService } from '../../RelationshipService/RelationshipService';
import { RecipeFileOutput } from '../../ObjectInfoWrapper/RelationshipTypes';
import { FakerJSRecipeProcessor } from '../../FakerRecipeProcessor/FakerJSRecipeProcessor/FakerJSRecipeProcessor';

/*
    #680: Quote.OpportunityId is a standard MasterDetail field with no <referenceTo> in source format, as
    are Quote's ContactId and ContractId lookups. StandardFieldParentReferenceMap names their parents,
    so Generate Treecipe puts Quote in Opportunity's tree, inserted after it, with each field written
    as any lookup with that <referenceTo> is written. Quote.AccountId is set by Salesforce from the
    quote's Opportunity (StandardDerivedFields), so it is written as Opportunity_NickName.AccountId.
*/

const QUOTE_PARENT_OBJECTS_PATH = path.join(__dirname, 'mocks', 'QuoteParentSalesforceMetadataDirectory', 'objects');
const QUOTE_WITHOUT_PARENTS_OBJECTS_PATH = path.join(__dirname, 'mocks', 'QuoteWithoutParentsSalesforceMetadataDirectory', 'objects');
const QUOTE_PARENT_FIELDS = [
    ['OpportunityId', 'MasterDetail', 'Opportunity'],
    ['AccountId', 'Lookup', 'Account'],
    ['ContactId', 'Lookup', 'Contact'],
    ['ContractId', 'Lookup', 'Contract']
] as const;
const QUOTE_WIRED_PARENT_FIELDS = QUOTE_PARENT_FIELDS.filter(([fieldApiName]) => fieldApiName !== 'AccountId');
const QUOTE_DERIVED_ACCOUNT_ID_VALUE = 'Opportunity_NickName.AccountId';

type LoadedObjectRecipe = { object: string; nickname: string; fields: Record<string, unknown> | null; friends?: LoadedObjectRecipe[] };

const flattenObjectRecipes = (objectRecipes: LoadedObjectRecipe[]): LoadedObjectRecipe[] =>
    objectRecipes.flatMap(objectRecipe => [objectRecipe, ...flattenObjectRecipes(objectRecipe.friends ?? [])]);

const buildFieldXml = (fieldApiName: string, fieldType: string, extraMarkup = '') => `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>${fieldApiName}</fullName>
    ${extraMarkup}
    <type>${fieldType}</type>
</CustomField>`;

describe.each([
    ['faker-js', () => new FakerJSRecipeFakerService(), true],
    ['snowfakery', () => new SnowfakeryRecipeFakerService(), false]
] as const)('Quote and its standard parents (#680) with the %s backend', (unusedBackend, createFakerService: () => IRecipeFakerService, isNestingBackend) => {

    beforeEach(() => {
        jest.spyOn(RecipeFakerServiceFactory, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(createFakerService);
        jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
        jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);
    });

    const generate = (objectsPath: string) => new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(objectsPath));

    const findQuoteRecipeFile = (recipeFiles: RecipeFileOutput[]) => recipeFiles.find(recipeFile => recipeFile.objects.includes('Quote'));

    const loadQuoteRecipes = (recipeFile: RecipeFileOutput) =>
        flattenObjectRecipes(yaml.load(recipeFile.content) as LoadedObjectRecipe[]).filter(objectRecipe => objectRecipe.object === 'Quote');

    test.each(QUOTE_PARENT_FIELDS)('Quote.%s (%s) with no <referenceTo> is written exactly as one whose <referenceTo> is %s', async (fieldApiName, fieldType, parentObjectApiName) => {

        const directoryProcessor = new DirectoryProcessor();
        const mappedFieldInfo = await directoryProcessor.buildFieldInfoByXMLContent(buildFieldXml(fieldApiName, fieldType), 'Quote', {}, `${fieldApiName}.field-meta.xml`);
        const explicitFieldInfo = await directoryProcessor.buildFieldInfoByXMLContent(buildFieldXml(fieldApiName, fieldType, `<referenceTo>${parentObjectApiName}</referenceTo>`), 'Quote', {}, `${fieldApiName}.field-meta.xml`);

        expect(mappedFieldInfo.referenceTo).toBe(parentObjectApiName);
        expect(mappedFieldInfo.recipeValue).toBe(explicitFieldInfo.recipeValue);

    });

    test('Quote is in Opportunity\'s tree, a level below every parent, so it is inserted after them', async () => {

        const objectInfoWrapper = await generate(QUOTE_PARENT_OBJECTS_PATH);
        const quoteRecipeFile = findQuoteRecipeFile(objectInfoWrapper.RecipeFiles);
        const levelOf = (objectApiName: string) => objectInfoWrapper.ObjectToObjectInfoMap[objectApiName].RelationshipDetail.level;

        expect(objectInfoWrapper.RecipeFiles).toHaveLength(1);
        expect(quoteRecipeFile.objects).toEqual(expect.arrayContaining(['Account', 'Contact', 'Contract', 'Opportunity', 'Quote']));
        QUOTE_PARENT_FIELDS.forEach(([unusedField, unusedType, parentObjectApiName]) => {
            expect(levelOf('Quote')).toBeGreaterThan(levelOf(parentObjectApiName));
        });
        expect(quoteRecipeFile.content).toContain('# Quote (Parents: Account, Contact, Contract, Opportunity)');

    });

    test(isNestingBackend
        ? 'every Quote lookup Salesforce lets a recipe set is written as its parent\'s nickname, with no REFERENCE ID TODO'
        : 'every Quote lookup Salesforce lets a recipe set is the REFERENCE ID TODO the Recipe Cockpit\'s Wire lookup fills, as for Contact.AccountId', async () => {

        const objectInfoWrapper = await generate(QUOTE_PARENT_OBJECTS_PATH);
        const [quoteRecipe] = loadQuoteRecipes(findQuoteRecipeFile(objectInfoWrapper.RecipeFiles));

        QUOTE_WIRED_PARENT_FIELDS.forEach(([fieldApiName, unusedType, parentObjectApiName]) => {
            expect(quoteRecipe.fields[fieldApiName]).toBe(isNestingBackend ? `${parentObjectApiName}_NickName` : null);
        });
        expect(Object.keys(objectInfoWrapper.ObjectToObjectInfoMap.Quote.RelationshipDetail.parentObjectToFieldReferences).sort())
            .toEqual(['Account', 'Contact', 'Contract', 'Opportunity']);

    });

    test('Quote.AccountId, which Salesforce sets from the quote\'s Opportunity, is written as Opportunity_NickName.AccountId', async () => {

        const objectInfoWrapper = await generate(QUOTE_PARENT_OBJECTS_PATH);
        const quoteRecipeFile = findQuoteRecipeFile(objectInfoWrapper.RecipeFiles);
        const [quoteRecipe] = loadQuoteRecipes(quoteRecipeFile);

        expect(quoteRecipe.fields.AccountId).toBe(QUOTE_DERIVED_ACCOUNT_ID_VALUE);
        // THE OPPORTUNITY IT NAMES IS WRITTEN IN THE SAME TREE
        expect(quoteRecipeFile.content).toMatch(/^ +nickname: Opportunity_NickName$/m);

    });

    test('with none of its parents in the project, Quote is still written, each lookup a REFERENCE ID TODO, and generation does not fail', async () => {

        const objectInfoWrapper = await generate(QUOTE_WITHOUT_PARENTS_OBJECTS_PATH);
        const quoteRecipeFile = findQuoteRecipeFile(objectInfoWrapper.RecipeFiles);
        const writtenObjectApiNames = flattenObjectRecipes(yaml.load(quoteRecipeFile.content) as LoadedObjectRecipe[]).map(objectRecipe => objectRecipe.object);

        expect(writtenObjectApiNames).toEqual(['Quote']);
        QUOTE_WIRED_PARENT_FIELDS.forEach(([fieldApiName]) => {
            expect(quoteRecipeFile.content).toMatch(new RegExp(`^ +${fieldApiName}: ${RelationshipService.referenceIdRequiredTodo}$`, 'm'));
        });
        // NO OPPORTUNITY IN THE TREE: THE DEFAULT NICKNAME IS NAMED, AND THE INSERT DROPS THE FIELD ANYWAY
        expect(quoteRecipeFile.content).toMatch(new RegExp(`^ +AccountId: ${QUOTE_DERIVED_ACCOUNT_ID_VALUE}$`, 'm'));

    });

});

// RUN FAKER OVER THE GENERATED RECIPE: THE QUOTE SENT TO SALESFORCE CARRIES ITS OPPORTUNITY AND NO AccountId
describe('Run Faker by Recipe over the generated faker-js Quote recipe (#680)', () => {

    let recipeDirectoryPath: string;

    beforeEach(() => {
        jest.spyOn(RecipeFakerServiceFactory, 'getFakerImplementationByExtensionConfigSelection').mockImplementation(() => new FakerJSRecipeFakerService());
        jest.spyOn(ConfigurationService, 'getCustomRelationshipMappings').mockReturnValue({});
        jest.spyOn(ConfigurationService, 'getCustomCompoundAddressFields').mockReturnValue([]);
        recipeDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), 'treecipe-quote-'));
    });

    afterEach(() => {
        fs.rmSync(recipeDirectoryPath, { recursive: true, force: true });
    });

    test('the Quote record references the generated Opportunity and holds no AccountId', async () => {

        const objectInfoWrapper = await new DirectoryProcessor().processAllObjectsAndRelationships(vscode.Uri.file(QUOTE_PARENT_OBJECTS_PATH));
        const recipeFilePath = path.join(recipeDirectoryPath, 'recipe.yml');
        fs.writeFileSync(recipeFilePath, objectInfoWrapper.RecipeFiles.find(recipeFile => recipeFile.objects.includes('Quote')).content);

        const fakerRecipeProcessor = new FakerJSRecipeProcessor();
        const recordsByObjectApiName = fakerRecipeProcessor.transformFakerJsonDataToCollectionApiFormattedFilesBySObject(await fakerRecipeProcessor.generateFakeDataBySelectedRecipeFile(recipeFilePath));
        const [quoteRecord] = recordsByObjectApiName.get('Quote').records as Record<string, unknown>[];
        const opportunityReferenceIds = (recordsByObjectApiName.get('Opportunity').records as Array<{ attributes: { referenceId: string } }>).map(opportunityRecord => opportunityRecord.attributes.referenceId);

        expect(quoteRecord).not.toHaveProperty('AccountId');
        // A LOOKUP HOLDS ITS PARENT RECORD'S NICKNAME, WHICH THE INSERT RESOLVES THROUGH THE "__<nickname>" END OF THAT RECORD'S referenceId
        expect(opportunityReferenceIds.filter(referenceId => referenceId.endsWith(`__${quoteRecord.OpportunityId}`))).toHaveLength(1);

    });

});
