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

/*
    #680: Quote.OpportunityId is a standard MasterDetail field with no <referenceTo> in source format, as
    are Quote's ContactId and ContractId lookups. StandardFieldParentReferenceMap names their parents,
    so Generate Treecipe puts Quote in Opportunity's tree, inserted after it, with each field written
    as any lookup with that <referenceTo> is written.
*/

const QUOTE_PARENT_OBJECTS_PATH = path.join(__dirname, 'mocks', 'QuoteParentSalesforceMetadataDirectory', 'objects');
const QUOTE_WITHOUT_PARENTS_OBJECTS_PATH = path.join(__dirname, 'mocks', 'QuoteWithoutParentsSalesforceMetadataDirectory', 'objects');
const QUOTE_PARENT_FIELDS = [
    ['OpportunityId', 'MasterDetail', 'Opportunity'],
    ['AccountId', 'Lookup', 'Account'],
    ['ContactId', 'Lookup', 'Contact'],
    ['ContractId', 'Lookup', 'Contract']
] as const;

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
        ? 'every Quote parent field is written as its parent\'s nickname, with no REFERENCE ID TODO'
        : 'every Quote parent field is the REFERENCE ID TODO the Recipe Cockpit\'s Wire lookup fills, as for Contact.AccountId', async () => {

        const objectInfoWrapper = await generate(QUOTE_PARENT_OBJECTS_PATH);
        const [quoteRecipe] = loadQuoteRecipes(findQuoteRecipeFile(objectInfoWrapper.RecipeFiles));

        QUOTE_PARENT_FIELDS.forEach(([fieldApiName, unusedType, parentObjectApiName]) => {
            expect(quoteRecipe.fields[fieldApiName]).toBe(isNestingBackend ? `${parentObjectApiName}_NickName` : null);
        });
        expect(Object.keys(objectInfoWrapper.ObjectToObjectInfoMap.Quote.RelationshipDetail.parentObjectToFieldReferences).sort())
            .toEqual(['Account', 'Contact', 'Contract', 'Opportunity']);

    });

    test('with none of its parents in the project, Quote is still written, each parent field a REFERENCE ID TODO, and generation does not fail', async () => {

        const objectInfoWrapper = await generate(QUOTE_WITHOUT_PARENTS_OBJECTS_PATH);
        const quoteRecipeFile = findQuoteRecipeFile(objectInfoWrapper.RecipeFiles);
        const writtenObjectApiNames = flattenObjectRecipes(yaml.load(quoteRecipeFile.content) as LoadedObjectRecipe[]).map(objectRecipe => objectRecipe.object);

        expect(writtenObjectApiNames).toEqual(['Quote']);
        QUOTE_PARENT_FIELDS.forEach(([fieldApiName]) => {
            expect(quoteRecipeFile.content).toMatch(new RegExp(`^ +${fieldApiName}: ${RelationshipService.referenceIdRequiredTodo}$`, 'm'));
        });

    });

});
